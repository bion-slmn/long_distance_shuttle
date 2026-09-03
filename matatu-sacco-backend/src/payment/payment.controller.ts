// src/payment/payment.controller.ts
import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    UseGuards,
    ForbiddenException,
    NotFoundException,
    Logger,
    HttpCode,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Payment, PaymentReferenceType, PaymentStatus } from './entities/payment.entity';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../auth/entities/user.entity';
import { Public } from 'src/decorators/public.decorator';
import { MpesaService } from './mpesa/mpesa.service';
import { clerkStage } from '../common/utils/clerk-stage.util';
import { MpesaC2bCallbackGuard } from './mpesa/callback-token.guard';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@Controller('payment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentController {
    private readonly logger = new Logger(PaymentController.name);

    constructor(
        private readonly paymentService: PaymentService,
        private readonly mpesaService: MpesaService,
    ) { }

    // ── Public: "Check M-Pesa" for a stuck payment ───────────────────────────
    // Local by default: re-reads the payment and applies any receipt we
    // already hold, so a clerk can press it freely. Daraja is asked only for
    // a payment the automatic ladder has given up on, and at most once a
    // minute per payment across every caller — see
    // PaymentService.reconcileByBookingId.
    @Public()
    @Post('booking/:bookingId/reconcile')
    async reconcile(@Param('bookingId') bookingId: string) {
        const { payment, checkedWith, mpesaCheckAvailableInSeconds } =
            await this.paymentService.reconcileByBookingId(bookingId);
        return {
            paymentId: payment.id,
            status: payment.status,
            method: payment.method,
            errorMessage:
                payment.status === PaymentStatus.FAILED
                    ? payment.resultDesc ?? payment.initiationErrorMessage ?? 'Payment failed.'
                    : null,
            mpesaReceiptNumber: payment.mpesaReceiptNumber,
            checkedWith,
            mpesaCheckAvailableInSeconds,
        };
    }

    // ── Public: minimal payment status + error for a booking ────────────────
    // Used by the passenger-facing polling loop to show *why* a payment
    // failed, not just that it did. Slim response, same trust model as
    // bookings/:id/status — knowledge of the booking UUID is the "auth".
    @Public()
    @Get('booking/:bookingId/status')
    async getStatusForBooking(@Param('bookingId') bookingId: string) {
        return this.paymentService.getStatusByBookingId(bookingId);
    }

    // ── Public: Safaricom C2B validation (paybill hit directly, pre-check) ──
    // Lives here rather than on MpesaController because Daraja rejects
    // callback URLs containing "mpesa". Only invoked if validation is
    // enabled on the shortcode; otherwise Safaricom goes straight to
    // confirmation. Must return Safaricom's exact ack/reject shape quickly
    // and never throw. Keep it side-effect-free: persistence happens in the
    // confirmation step once the payment is final.
    // Gated by the sacco's own HMAC token in the path (see callback-token.ts);
    // the URL registered with Daraja for that sacco carries it.
    @Public()
    @SkipThrottle()
    @UseGuards(MpesaC2bCallbackGuard)
    @Post('c2b/validation/:saccoId/:token')
    @HttpCode(200)
    async handleC2BValidation(@Body() body: any) {
        try {
            this.logger.log(
                `C2B validation received: TransID=${body?.TransID} BillRefNumber=${body?.BillRefNumber} MSISDN=${body?.MSISDN}`,
            );
            // Accept-all for now. To reject, return a non-zero ResultCode,
            // e.g. { ResultCode: 'C2B00016', ResultDesc: 'Rejected' }.
        } catch (err: any) {
            this.logger.error(`Failed to process M-Pesa C2B validation: ${err.message}`, err.stack);
        }

        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // ── Public: Safaricom C2B confirmation (payment already completed) ─────
    // Called AFTER the customer's paybill payment has gone through. This is
    // the one that persists the transaction (as UNMATCHED, for a clerk to
    // attach to a booking). Must always return 200 quickly or Daraja retries
    // the same payload — so never throw here, log and swallow instead.
    // Gated by the sacco's own HMAC token in the path — without it anyone
    // could POST a made-up receipt and settle a booking for free. The path's
    // saccoId is proven by that token and wins over the body for attribution.
    @Public()
    @SkipThrottle()
    @UseGuards(MpesaC2bCallbackGuard)
    @Post('c2b/confirmation/:saccoId/:token')
    @HttpCode(200)
    async handleC2BConfirmation(@Body() body: any, @Param('saccoId') saccoId: string) {
        try {
            this.logger.log(
                `C2B confirmation received: TransID=${body?.TransID} BillRefNumber=${body?.BillRefNumber} MSISDN=${body?.MSISDN} Amount=${body?.TransAmount}`,
            );

            const stored = await this.mpesaService.handleC2BConfirmation(body, saccoId);

            // Try to settle what this money is for right now — the STK push
            // whose callback was lost, or the pending booking the passenger
            // paid by hand — so it never waits on a clerk unless it must.
            if (stored) {
                await this.paymentService.handleC2BReceipt(stored);
            }
        } catch (err: any) {
            this.logger.error(`Failed to process M-Pesa C2B confirmation: ${err.message}`, err.stack);
        }

        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // ── STAFF ONLY below this line ────────────────────────────────────────

    // NOTE: there is deliberately no standalone "record cash" endpoint. Cash
    // is recorded inside BookingService's booking transaction, where the
    // booking, its sacco and its fare are all known. A free-standing ledger
    // write let any clerk post SUCCESS rows against any sacco.

    // ── All payments for a sacco, optionally filtered by date/status/method ──
    // e.g. GET /payment/sacco?saccoId=...&from=2026-08-01&to=2026-08-14&status=SUCCESS
    // saccoId derived from the authenticated user for SACCO_ADMIN/CLERK —
    // SUPER_ADMIN may pass ?saccoId= to scope, or omit it for all saccos.
    @Get('sacco')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    findForSacco(
        @Query('saccoId') saccoId: string | undefined,
        @Query() query: PaymentQueryDto,
        @CurrentUser() user: any,
    ) {
        const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;

        if (!isSuperAdmin && !user.saccoId) {
            throw new ForbiddenException('You are not assigned to a sacco.');
        }

        return this.paymentService.findBySacco(
            isSuperAdmin ? saccoId : user.saccoId,
            { ...query, assignedStage: clerkStage(user) },
        );
    }

    // ── Get the latest payment for a given booking ──────────────────────
    @Get('booking/:bookingId')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    async findForBooking(@Param('bookingId') bookingId: string, @CurrentUser() user: any) {
        const payment = await this.paymentService.findByReference(
            PaymentReferenceType.BOOKING,
            bookingId,
        );
        if (!payment) {
            throw new NotFoundException(`No payment found for booking "${bookingId}".`);
        }
        if (user.role !== UserRole.SUPER_ADMIN && payment.saccoId !== user.saccoId) {
            throw new ForbiddenException('Access denied to this payment.');
        }
        await this.assertStageAccess(payment, user);
        return payment;
    }

    // ── Get a single payment by its own id ──────────────────────────────
    // NOTE: registered last since ':id' would otherwise swallow 'sacco' and
    // 'booking' as if they were payment ids — Nest/Express matches routes
    // top-to-bottom.
    @Get(':id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    async findOne(@Param('id') id: string, @CurrentUser() user: any) {
        const payment = await this.paymentService.findById(id);
        if (user.role !== UserRole.SUPER_ADMIN && payment.saccoId !== user.saccoId) {
            throw new ForbiddenException('Access denied to this payment.');
        }
        await this.assertStageAccess(payment, user);
        return payment;
    }

    // A clerk only sees payments for their own stage in the list, so they must
    // not be able to reach another stage's payment straight by id either.
    private async assertStageAccess(payment: Payment, user: any): Promise<void> {
        const stage = clerkStage(user);
        if (!stage) return;

        if (!(await this.paymentService.isForStage(payment, stage))) {
            throw new ForbiddenException(
                `This payment is not for your assigned stage ("${stage}").`,
            );
        }
    }
}