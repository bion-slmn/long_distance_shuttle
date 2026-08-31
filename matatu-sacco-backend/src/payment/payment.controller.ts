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
import { RecordCashPaymentDto } from './dto/record-cash-payment.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../auth/entities/user.entity';
import { Public } from 'src/decorators/public.decorator';
import { MpesaService } from './mpesa/mpesa.service';
import { clerkStage } from '../common/utils/clerk-stage.util';

@Controller('payment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentController {
    private readonly logger = new Logger(PaymentController.name);

    constructor(
        private readonly paymentService: PaymentService,
        private readonly mpesaService: MpesaService,
    ) { }

    // ── Public: actively re-check a stuck payment against Daraja ────────────
    // Called by the frontend as a last-resort check right before it would
    // otherwise give up and show "payment failed" — Safaricom's callback
    // isn't 100% reliable, so this queries the transaction status directly
    // instead of only waiting on the webhook.
    @Public()
    @Post('booking/:bookingId/reconcile')
    async reconcile(@Param('bookingId') bookingId: string) {
        const payment = await this.paymentService.reconcileByBookingId(bookingId);
        return {
            paymentId: payment.id,
            status: payment.status,
            errorMessage:
                payment.status === PaymentStatus.FAILED
                    ? payment.resultDesc ?? payment.initiationErrorMessage ?? 'Payment failed.'
                    : null,
            mpesaReceiptNumber: payment.mpesaReceiptNumber,
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

    // ── STAFF ONLY below this line ────────────────────────────────────────

    // ── Record a cash payment (conductor confirms cash received) ────────
    @Post('cash')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    async recordCash(@Body() dto: RecordCashPaymentDto) {
        return this.paymentService.recordCashPayment(dto);
    }

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