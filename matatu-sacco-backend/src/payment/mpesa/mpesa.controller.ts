// src/payment/mpesa/mpesa.controller.ts
import {
    Body,
    Controller,
    Get,
    HttpCode,
    Logger,
    Param,
    Post,
    Query,
} from '@nestjs/common';
import { MpesaService } from './mpesa.service';
import { InitiateStkPushDto } from '../dto/initiate-stk-push.dto';
import { MpesaCallbackDto } from '../dto/mpesa-callback.dto';
import { Public } from 'src/decorators/public.decorator';
import { PaymentService } from '../payment.service';
import { GetTransactionsByPhoneDto } from '../dto/get-transactions-by-phone.dto';

// ─── Controller ─────────────────────────────────────────────────────────
// Endpoints living here:
//  - POST /payment/mpesa/stk-push/:saccoId       → called by our own frontend,
//    protected, validated via InitiateStkPushDto.
//  - POST /payment/mpesa/callback                → STK callback, called by
//    Safaricom, public, unauthenticated, must always return 200 quickly.
//  - POST /payment/mpesa/c2b/validation           → C2B pre-check, called by
//    Safaricom only if validation is enabled on the shortcode. Must return
//    Safaricom's exact ack/reject shape, quickly, never throw.
//  - POST /payment/mpesa/c2b/confirmation         → C2B post-payment
//    confirmation, called by Safaricom, public, unauthenticated, must
//    always return 200 quickly or Daraja retries.
//  - GET  /payment/mpesa/transactions             → internal lookup, protected,
//    filter by payer phone and an optional date range.

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
    @Get('transactions')
    async getTransactionsByPhone(@Query() query: GetTransactionsByPhoneDto) {
        const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
        const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;

        return this.mpesaService.getTransactionsByPhone(query.phone, dateFrom, dateTo);
    }

    // ── Safaricom's async STK callback ──────────────────────────────────
    // Public, unauthenticated (Safaricom doesn't sign these). Must always
    // return 200 with ResultCode 0 quickly, or Daraja will retry the callback.
    // Never throw here — log and swallow instead.
    @Public()
    @Post('callback')
    @HttpCode(200)
    async handleCallback(@Body() body: MpesaCallbackDto) {
        try {
            // handleStkCallback parses AND persists the transaction (when
            // successful) before we hand it off to matching logic below.
            const parsed = await this.mpesaService.handleStkCallback(body);

            this.logger.log(
                `Callback received: checkoutRequestId=${parsed.checkoutRequestId} success=${parsed.success} resultCode=${parsed.resultCode}`,
            );

            await this.paymentService.handleMpesaCallback(parsed, body);
        } catch (err: any) {
            // Never let this bubble into a non-200 response — Safaricom will just
            // retry the same callback repeatedly if we do. Log loudly instead.
            this.logger.error(`Failed to process M-Pesa callback: ${err.message}`, err.stack);
        }

        // Daraja expects this exact shape acknowledging receipt.
        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // ── C2B validation (optional, only hit if enabled on the shortcode) ──
    // Public, unauthenticated. Safaricom calls this BEFORE completing the
    // transaction and expects a synchronous accept/reject. Only relevant if
    // ResponseType was registered such that validation is actually invoked —
    // if it's off, Safaricom skips straight to /c2b/confirmation.
    // Keep this fast and side-effect-free: no persistence here, that
    // happens in the confirmation step once the payment is final.
    @Public()
    @Post('c2b/validation')
    @HttpCode(200)
    async handleC2BValidation(@Body() body: any) {
        try {
            this.logger.log(
                `C2B validation received: TransID=${body?.TransID} BillRefNumber=${body?.BillRefNumber} MSISDN=${body?.MSISDN}`,
            );

            // Add any accept/reject logic here (e.g. does BillRefNumber match
            // a known booking/account?). Defaulting to accept-all for now,
            // matching ResponseType: "Completed" behavior on registration.
        } catch (err: any) {
            this.logger.error(`Failed to process M-Pesa C2B validation: ${err.message}`, err.stack);
        }

        // Daraja expects this exact shape to accept the transaction.
        // To reject, respond with a non-zero ResultCode, e.g.
        // { ResultCode: 'C2B00016', ResultDesc: 'Rejected' }
        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // ── C2B confirmation (payment already completed) ─────────────────────
    // Public, unauthenticated. Called AFTER the customer's payment has gone
    // through — this is the one that should actually persist the transaction.
    // Must always return 200 quickly or Daraja will retry the same payload.
    // Never throw here — log and swallow instead.
    @Public()
    @Post('c2b/confirmation')
    @HttpCode(200)
    async handleC2BConfirmation(@Body() body: any) {
        try {
            this.logger.log(
                `C2B confirmation received: TransID=${body?.TransID} BillRefNumber=${body?.BillRefNumber} MSISDN=${body?.MSISDN} Amount=${body?.TransAmount}`,
            );

            await this.mpesaService.handleC2BConfirmation(body);

            // Hook into the same downstream matching logic as STK if C2B
            // payments should also settle bookings/invoices automatically.
            // await this.paymentService.handleMpesaC2BConfirmation(body);
        } catch (err: any) {
            this.logger.error(`Failed to process M-Pesa C2B confirmation: ${err.message}`, err.stack);
        }

        // Daraja expects this exact shape acknowledging receipt.
        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // ── One-time C2B URL registration for a sacco's shortcode ──────────────
    // Protected — an admin/setup action you trigger yourself, not a
    // Safaricom-facing webhook. Import Param from @nestjs/common.
    @Post(':saccoId/c2b/register')
    async registerC2BUrls(@Param('saccoId') saccoId: string) {
        return this.mpesaService.registerC2BUrls(saccoId);
    }
}