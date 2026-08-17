// src/payment/payment.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    Payment,
    PaymentMethod,
    PaymentStatus,
    PaymentReferenceType,
} from './entities/payment.entity';
import { MpesaService } from './mpesa/mpesa.service';

// ─── Event payload contracts ────────────────────────────────────────────
// BookingService (or anything else) subscribes to these via @OnEvent.
// Kept as plain interfaces here rather than importing from BookingModule,
// to avoid a circular dependency between Payment and Booking.

export interface PaymentSucceededEvent {
    paymentId: string;
    referenceType: PaymentReferenceType;
    referenceId: string;
    saccoId: string;
    amount: number;
    mpesaReceiptNumber?: string;
}

export interface PaymentFailedEvent {
    paymentId: string;
    referenceType: PaymentReferenceType;
    referenceId: string;
    saccoId: string;
    reason: string;
}

interface CreatePaymentInput {
    referenceType: PaymentReferenceType;
    referenceId: string;
    saccoId: string;
    amount: number;

}

interface MarkProcessingInput {
    saccoId: string;
    checkoutRequestId: string;
    merchantRequestId: string;
    payerPhone: string;
    accountReference: string; // used to look the pending payment back up
}

interface ParsedCallback {
    checkoutRequestId: string;
    resultCode: number;
    resultDesc: string;
    success: boolean;
    amount?: number;
    mpesaReceiptNumber?: string;
    transactionDate?: string;
    payerPhone?: string;
}

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(
        @InjectRepository(Payment)
        private readonly paymentRepository: Repository<Payment>,
        private readonly mpesaService: MpesaService,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    // ── Create a PENDING payment row + kick off STK push ────────────────
    // This is what BookingService actually calls — it never talks to
    // MpesaService directly.
    async initiateMpesaPayment(
        input: CreatePaymentInput & { payerPhone: string; accountReference: string },
    ): Promise<{ paymentId: string; checkoutRequestId: string }> {
        const payment = this.paymentRepository.create({
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            saccoId: input.saccoId,
            amount: input.amount,
            method: PaymentMethod.MPESA,
            status: PaymentStatus.PENDING,
            payerPhone: input.payerPhone,
        });
        const saved = await this.paymentRepository.save(payment);

        try {
            const result = await this.mpesaService.initiateStkPush(input.saccoId, {
                payerPhone: input.payerPhone,
                amount: input.amount,
                accountReference: input.accountReference,
            });

            saved.status = PaymentStatus.PROCESSING;
            saved.checkoutRequestId = result.checkoutRequestId;
            saved.merchantRequestId = result.merchantRequestId;
            saved.initiatedAt = new Date();
            await this.paymentRepository.save(saved);

            this.logger.log(
                `Payment ${saved.id} moved to PROCESSING (checkoutRequestId=${result.checkoutRequestId})`,
            );

            return { paymentId: saved.id, checkoutRequestId: result.checkoutRequestId };
        } catch (err: any) {
            saved.status = PaymentStatus.FAILED;
            saved.initiationErrorMessage = err.message; // now the real Daraja message, not "Request failed with status code 400"
            saved.initiationErrorCode = (err.cause as any)?.errorCode ?? null;
            await this.paymentRepository.save(saved);
            throw err;
        }
    }

    // ── Called by MpesaController right after a successful push response ─
    // (Kept separate from initiateMpesaPayment in case the controller is the
    // one calling MpesaService directly — use whichever entry point fits
    // your controller; this one just persists the processing state.)
    async markProcessing(input: MarkProcessingInput): Promise<void> {
        const payment = await this.paymentRepository.findOne({
            where: {
                saccoId: input.saccoId,
                payerPhone: input.payerPhone,
                status: PaymentStatus.PENDING,
            },
            order: { createdAt: 'DESC' },
        });

        if (!payment) {
            this.logger.warn(
                `markProcessing: no PENDING payment found for sacco ${input.saccoId}, phone ${input.payerPhone}`,
            );
            return;
        }

        payment.status = PaymentStatus.PROCESSING;
        payment.checkoutRequestId = input.checkoutRequestId;
        payment.merchantRequestId = input.merchantRequestId;
        payment.initiatedAt = new Date();
        await this.paymentRepository.save(payment);
    }

    // ── Handle Safaricom's async callback ────────────────────────────────
    async handleMpesaCallback(parsed: ParsedCallback, rawBody: unknown): Promise<void> {
        const payment = await this.paymentRepository.findOne({
            where: { checkoutRequestId: parsed.checkoutRequestId },
        });

        if (!payment) {
            this.logger.error(
                `Callback for unknown checkoutRequestId=${parsed.checkoutRequestId} — no matching payment.`,
            );
            return;
        }

        // Idempotency guard — Safaricom can retry callbacks.
        if (payment.status === PaymentStatus.SUCCESS || payment.status === PaymentStatus.FAILED) {
            this.logger.log(
                `Callback for payment ${payment.id} ignored — already ${payment.status}.`,
            );
            return;
        }

        payment.resultCode = String(parsed.resultCode);
        payment.resultDesc = parsed.resultDesc;
        payment.rawCallbackPayload = rawBody as Record<string, any>;
        payment.completedAt = new Date();

        if (parsed.success) {
            payment.status = PaymentStatus.SUCCESS;
            payment.mpesaReceiptNumber = parsed.mpesaReceiptNumber!;
            await this.paymentRepository.save(payment);

            this.logger.log(
                `Payment ${payment.id} SUCCESS (receipt=${parsed.mpesaReceiptNumber})`,
            );

            this.eventEmitter.emit('payment.succeeded', {
                paymentId: payment.id,
                referenceType: payment.referenceType,
                referenceId: payment.referenceId,
                saccoId: payment.saccoId,
                amount: payment.amount,
                mpesaReceiptNumber: parsed.mpesaReceiptNumber,
            } satisfies PaymentSucceededEvent);
        } else {
            payment.status = PaymentStatus.FAILED;
            await this.paymentRepository.save(payment);

            this.logger.log(`Payment ${payment.id} FAILED (${parsed.resultDesc})`);

            this.eventEmitter.emit('payment.failed', {
                paymentId: payment.id,
                referenceType: payment.referenceType,
                referenceId: payment.referenceId,
                saccoId: payment.saccoId,
                reason: parsed.resultDesc,
            } satisfies PaymentFailedEvent);
        }
    }

    // ── Record a cash payment (synchronous, no external call) ───────────
    async recordCashPayment(input: CreatePaymentInput): Promise<Payment> {
        const payment = this.paymentRepository.create({
            ...input,
            method: PaymentMethod.CASH,
            status: PaymentStatus.SUCCESS,
            completedAt: new Date(),
        });
        return this.paymentRepository.save(payment);
    }

    // ── Lookups ───────────────────────────────────────────────────────────
    async findById(id: string): Promise<Payment> {
        const payment = await this.paymentRepository.findOne({ where: { id } });
        if (!payment) throw new NotFoundException(`Payment "${id}" not found.`);
        return payment;
    }

    async findByReference(
        referenceType: PaymentReferenceType,
        referenceId: string,
    ): Promise<Payment | null> {
        return this.paymentRepository.findOne({
            where: { referenceType, referenceId },
            order: { createdAt: 'DESC' },
        });
    }


    async getStatusByBookingId(bookingId: string): Promise<{
        paymentId: string;
        status: PaymentStatus;
        method: PaymentMethod;
        errorMessage: string | null;
        mpesaReceiptNumber: string | null;
    }> {
        const payment = await this.paymentRepository.findOne({
            where: { referenceType: PaymentReferenceType.BOOKING, referenceId: bookingId },
            order: { createdAt: 'DESC' },
        });

        if (!payment) {
            throw new NotFoundException(`No payment found for booking "${bookingId}".`);
        }

        const errorMessage =
            payment.status === PaymentStatus.FAILED
                ? payment.resultDesc ?? payment.initiationErrorMessage ?? 'Payment failed.'
                : null;

        return {
            paymentId: payment.id,
            status: payment.status,
            method: payment.method,
            errorMessage,
            mpesaReceiptNumber: payment.mpesaReceiptNumber,
        };
    }


    async findBySacco(
        saccoId: string | undefined,
        filters: { from?: string; to?: string; status?: PaymentStatus; method?: PaymentMethod },
    ): Promise<Payment[]> {
        const qb = this.paymentRepository.createQueryBuilder('payment');

        if (saccoId) {
            qb.andWhere('payment.saccoId = :saccoId', { saccoId });
        }

        if (filters.from) {
            qb.andWhere('payment.createdAt >= :from', { from: new Date(filters.from) });
        }
        if (filters.to) {
            const to = new Date(filters.to);
            to.setHours(23, 59, 59, 999);
            qb.andWhere('payment.createdAt <= :to', { to });
        }
        if (filters.status) {
            qb.andWhere('payment.status = :status', { status: filters.status });
        }
        if (filters.method) {
            qb.andWhere('payment.method = :method', { method: filters.method });
        }

        return qb.orderBy('payment.createdAt', 'DESC').getMany();
    }

    // src/payment/payment.service.ts

    async reconcileStuckPayment(paymentId: string): Promise<Payment> {
        const payment = await this.findById(paymentId);

        if (payment.status !== PaymentStatus.PROCESSING || !payment.checkoutRequestId) {
            return payment; // nothing to reconcile — already resolved, or no STK push was ever sent
        }

        const result = await this.mpesaService.queryStkStatus(payment.saccoId, payment.checkoutRequestId);

        if (result.resultCode === 0) {
            payment.status = PaymentStatus.SUCCESS;
        } else if (result.resultCode === 1037 || result.resultDesc?.toLowerCase().includes('being processed')) {
            return payment; // genuinely still pending — don't mark failed prematurely
        } else {
            payment.status = PaymentStatus.FAILED;
            payment.resultCode = String(result.resultCode);
            payment.resultDesc = result.resultDesc;
        }

        payment.completedAt = new Date();
        const saved = await this.paymentRepository.save(payment);

        if (saved.status === PaymentStatus.SUCCESS) {
            this.eventEmitter.emit('payment.succeeded', {
                paymentId: saved.id,
                referenceType: saved.referenceType,
                referenceId: saved.referenceId,
                saccoId: saved.saccoId,
                amount: saved.amount,
                mpesaReceiptNumber: saved.mpesaReceiptNumber,
            } satisfies PaymentSucceededEvent);
        } else if (saved.status === PaymentStatus.FAILED) {
            this.eventEmitter.emit('payment.failed', {
                paymentId: saved.id,
                referenceType: saved.referenceType,
                referenceId: saved.referenceId,
                saccoId: saved.saccoId,
                reason: saved.resultDesc ?? 'Payment failed.',
            } satisfies PaymentFailedEvent);
        }

        return saved;
    }

    async reconcileByBookingId(bookingId: string): Promise<Payment> {
        const payment = await this.paymentRepository.findOne({
            where: { referenceType: PaymentReferenceType.BOOKING, referenceId: bookingId },
            order: { createdAt: 'DESC' },
        });

        if (!payment) {
            throw new NotFoundException(`No payment found for booking "${bookingId}".`);
        }

        return this.reconcileStuckPayment(payment.id);
    }
}