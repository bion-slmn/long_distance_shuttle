// src/payment/mpesa/mpesa.controller.ts
import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    Logger,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { MpesaService } from './mpesa.service';
import { InitiateStkPushDto } from '../dto/initiate-stk-push.dto';
import { MpesaCallbackDto } from '../dto/mpesa-callback.dto';
import { Public } from 'src/decorators/public.decorator';
import { PaymentService } from '../payment.service';
import { GetTransactionsByPhoneDto } from '../dto/get-transactions-by-phone.dto';
import { SimulateC2BPaymentDto } from '../dto/simulate-c2b-payment.dto';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from 'src/auth/entities/user.entity';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { MpesaCallbackTokenGuard } from './callback-token.guard';
import { SkipThrottle } from '@nestjs/throttler';

// ─── Controller ─────────────────────────────────────────────────────────
// Endpoints living here:
//  - POST /payment/mpesa/stk-push/:saccoId       → called by our own frontend,
//    protected, validated via InitiateStkPushDto.
//  - POST /payment/mpesa/callback                → STK callback, called by
//    Safaricom, public, unauthenticated, must always return 200 quickly.
//  - C2B validation/confirmation are NOT here: Daraja rejects callback URLs
//    containing "mpesa", so they live on PaymentController as
//    /payment/c2b/validation and /payment/c2b/confirmation.
//  - GET  /payment/mpesa/transactions             → internal lookup, protected,
//    filter by payer phone and an optional date range.
//  - POST /payment/mpesa/:saccoId/c2b/register    → one-time URL registration.
//  - POST /payment/mpesa/:saccoId/c2b/simulate    → sandbox only, admin-only:
//    asks Daraja to fake a paybill payment so the confirmation round-trips
//    through /c2b/confirmation like a real one.

@Controller('payment/mpesa')
export class MpesaController {
    private readonly logger = new Logger(MpesaController.name);

    constructor(
        private readonly mpesaService: MpesaService,
        private readonly paymentService: PaymentService,
    ) { }

    // ── Look up stored transactions by payer phone ─────────────────────
    // Protected (no @Public()) — this is an internal/staff lookup, not a
    // Safaricom-facing endpoint. dateFrom/dateTo are optional ISO date
    // strings, e.g. ?phone=0712345678&dateFrom=2024-01-01&dateTo=2024-01-31
    //
    // Scoped: a SACCO_ADMIN or CLERK only ever sees money attributed to
    // their own sacco. SUPER_ADMIN sees everything, or one sacco via ?saccoId=.
    @Get('transactions')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    async getTransactionsByPhone(
        @Query() query: GetTransactionsByPhoneDto,
        @CurrentUser() user: any,
    ) {
        const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
        const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;

        return this.mpesaService.getTransactionsByPhone(
            query.phone,
            dateFrom,
            dateTo,
            this.saccoScope(user, query.saccoId),
        );
    }

    // ── How much C2B money is sitting unattached ───────────────────────
    // Staff-only (no @Public()). Registered before nothing else on this
    // path, but kept distinct from @Get('transactions') above so neither
    // shadows the other.
    @Get('transactions/unmatched-summary')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    getUnmatchedSummary(
        @Query('saccoId') saccoId: string | undefined,
        @CurrentUser() user: any,
    ) {
        return this.mpesaService.getUnmatchedSummary(this.saccoScope(user, saccoId));
    }

    // SUPER_ADMIN: the requested sacco, or undefined for all of them.
    // Anyone else: their own sacco, full stop.
    private saccoScope(user: any, requested?: string): string | undefined {
        if (user?.role === UserRole.SUPER_ADMIN) return requested || undefined;
        if (!user?.saccoId) {
            throw new ForbiddenException('You are not assigned to a sacco.');
        }
        return user.saccoId;
    }

    // ── Safaricom's async STK callback ──────────────────────────────────
    // Public in the JWT sense (Safaricom has no bearer token), but gated by
    // the shared callback secret in the path — the CallBackURL we send with
    // every STK push carries it. Must always return 200 with ResultCode 0
    // quickly, or Daraja will retry the callback. Never throw here — log and
    // swallow instead.
    @Public()
    @SkipThrottle()
    @UseGuards(MpesaCallbackTokenGuard)
    @Post('callback/:token/:nonce')
    @HttpCode(200)
    // `any`, not the DTO: the global ValidationPipe whitelists DTO classes
    // and would strip Safaricom's undecorated payload down to nothing.
    async handleCallback(@Body() rawBody: any, @Param('nonce') nonce: string) {
        const body = rawBody as MpesaCallbackDto;
        try {
            // handleStkCallback parses AND persists the transaction (when
            // successful) before we hand it off to matching logic below.
            const parsed = await this.mpesaService.handleStkCallback(body);

            this.logger.log(
                `Callback received: checkoutRequestId=${parsed.checkoutRequestId} success=${parsed.success} resultCode=${parsed.resultCode}`,
            );

            await this.paymentService.handleMpesaCallback(parsed, body, nonce);
        } catch (err: any) {
            // Never let this bubble into a non-200 response — Safaricom will just
            // retry the same callback repeatedly if we do. Log loudly instead.
            this.logger.error(`Failed to process M-Pesa callback: ${err.message}`, err.stack);
        }

        // Daraja expects this exact shape acknowledging receipt.
        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // ── One-time C2B URL registration for a sacco's shortcode ──────────────
    // Protected — an admin/setup action you trigger yourself, not a
    // Safaricom-facing webhook. Registers /payment/c2b/* (see MpesaService).
    @Post(':saccoId/c2b/register')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    async registerC2BUrls(@Param('saccoId') saccoId: string) {
        return this.mpesaService.registerC2BUrls(saccoId);
    }

    // ── Sandbox-only: simulate a direct paybill payment ───────────────────
    // Protected and admin-only. The service refuses this outright when
    // MPESA_ENV is production. Daraja replies "accepted" immediately and
    // then POSTs the confirmation to /payment/c2b/confirmation a few seconds later,
    // so check mpesa_transactions (or the unmatched summary) after calling.
    @Post(':saccoId/c2b/simulate')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    async simulateC2BPayment(
        @Param('saccoId') saccoId: string,
        @Body() dto: SimulateC2BPaymentDto,
    ) {
        return this.mpesaService.simulateC2BPayment(saccoId, dto);
    }
}