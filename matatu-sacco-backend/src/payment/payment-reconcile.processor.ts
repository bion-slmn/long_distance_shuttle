// src/payment/payment-reconcile.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PaymentService } from './payment.service';
import { PaymentStatus } from './entities/payment.entity';
import { RECONCILE_DELAYS_MS } from './payment-reconcile.constants';

interface ReconcileJobData {
    paymentId: string;
    attempt: number;
}

@Processor('payment-reconcile')
export class PaymentReconcileProcessor extends WorkerHost {
    private readonly logger = new Logger(PaymentReconcileProcessor.name);

    constructor(
        private readonly paymentService: PaymentService,
        @InjectQueue('payment-reconcile') private readonly reconcileQueue: Queue,
    ) {
        super();
    }

    async process(job: Job<ReconcileJobData>): Promise<void> {
        const { paymentId, attempt } = job.data;

        const payment = await this.paymentService.reconcileStuckPayment(paymentId);

        if (payment.status !== PaymentStatus.PROCESSING) {
            // reconcileStuckPayment already emitted payment.succeeded/failed —
            // the PaymentEventsListener has already reacted. Nothing left to do.
            this.logger.log(`Payment ${paymentId} resolved (${payment.status}) after attempt ${attempt}`);
            return;
        }

        const nextDelay = RECONCILE_DELAYS_MS[attempt]; // index by attempt, since attempt is 1-based and array is 0-based for the NEXT delay

        if (nextDelay === undefined) {
            // Exhausted the schedule — this is the guarantee: force a
            // terminal state so nothing stays PROCESSING forever.
            this.logger.warn(`Payment ${paymentId} still unresolved after ${attempt} attempts — forcing EXPIRED`);
            await this.paymentService.forceExpireIfStillProcessing(paymentId);
            return;
        }

        await this.reconcileQueue.add(
            'check',
            { paymentId, attempt: attempt + 1 },
            {
                jobId: `reconcile:${paymentId}:${attempt + 1}`,
                delay: nextDelay,
                removeOnComplete: true,
                removeOnFail: true,
            },
        );
    }
}