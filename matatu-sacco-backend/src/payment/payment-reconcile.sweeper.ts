// src/payment/payment-reconcile.sweeper.ts
//
// The backstop behind the backstop.
//
// PaymentReconcileProcessor settles payments that have a delayed job in Redis.
// This settles the ones that DON'T — because the enqueue in
// initiateMpesaPayment never reached Redis, or the job was lost with the
// Redis data, or the process died in the gap between saving PROCESSING and
// adding the job. Those payments have no ladder at all, so no amount of
// restarting brings them back: nothing in the app looked at the database to
// find them. Seventeen of them had piled up, the oldest sitting PROCESSING for
// over two weeks.
//
// The fix is to stop treating Redis as the record of what needs reconciling.
// Postgres already holds that record — the PROCESSING rows themselves — so the
// sweeper re-derives the work list from there and rebuilds whatever Redis is
// missing.
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PaymentService } from './payment.service';
import { Payment, PaymentStatus } from './entities/payment.entity';
import {
    RECONCILE_DELAYS_MS,
    SWEEP_BATCH_LIMIT,
    SWEEP_INTERVAL_MS,
    SWEEP_QUERY_MAX_AGE_MS,
} from './payment-reconcile.constants';

export type SweepTrigger = 'boot' | 'scheduled';

/** Which rung of the ladder a payment of a given age is still owed. */
interface LadderRung {
    attempt: number;
    delay: number;
}

@Injectable()
export class PaymentReconcileSweeper implements OnApplicationBootstrap {
    private readonly logger = new Logger(PaymentReconcileSweeper.name);

    // A sweep is sequential and can run for a while when the backlog is deep
    // and Daraja is slow. Ticks must not overlap: two sweeps would double the
    // query rate, which is the one thing the 30-minute cadence exists to avoid.
    private sweeping = false;

    constructor(
        private readonly paymentService: PaymentService,
        @InjectQueue('payment-reconcile') private readonly reconcileQueue: Queue,
    ) { }

    // On restart. This is the tick that matters most: a restart is exactly when
    // in-flight enqueues are lost, and it is also the moment an operator
    // expects recovery to happen — the intuition that "restarting should pick
    // the reconciliation back up" was correct, there was simply nothing
    // implementing it.
    async onApplicationBootstrap(): Promise<void> {
        await this.sweep('boot');
    }

    // ...and every 30 minutes thereafter. A boot-only sweep would have missed
    // the failure that prompted this: the process never crashed. Nest stayed
    // up while a single queue.add() sat parked in ioredis' offline queue
    // forever, and without a periodic tick nothing would have noticed until
    // somebody happened to restart.
    @Interval('payment-reconcile-sweep', SWEEP_INTERVAL_MS)
    async scheduledSweep(): Promise<void> {
        await this.sweep('scheduled');
    }

    async sweep(trigger: SweepTrigger): Promise<void> {
        if (this.sweeping) {
            this.logger.warn(`Reconcile sweep (${trigger}) skipped — previous sweep still running`);
            return;
        }

        this.sweeping = true;
        try {
            const stuck = await this.paymentService.findProcessingPayments(SWEEP_BATCH_LIMIT);

            if (stuck.length === 0) {
                this.logger.log(`Reconcile sweep (${trigger}): nothing left PROCESSING`);
                return;
            }

            this.logger.log(
                `Reconcile sweep (${trigger}): ${stuck.length} payment(s) PROCESSING — settling oldest first`,
            );

            // Sequential, deliberately. Promise.all here would fire the whole
            // batch at Daraja at once, which is how a backlog turns into a 429
            // and every payment in it comes back unanswered.
            for (const payment of stuck) {
                await this.sweepOne(payment);
            }
        } catch (err: any) {
            // A sweep that throws must not kill the interval — the next tick is
            // the recovery path for whatever went wrong here.
            this.logger.error(`Reconcile sweep (${trigger}) failed: ${err.message}`);
        } finally {
            this.sweeping = false;
        }
    }

    private async sweepOne(payment: Payment): Promise<void> {
        // initiatedAt is set the moment the STK push succeeds, so it is the
        // true zero of the ladder. createdAt is a fallback for a row that
        // somehow reached PROCESSING without it — a few seconds early, never
        // late, which is the safe direction to be wrong in.
        const age = Date.now() - (payment.initiatedAt ?? payment.createdAt).getTime();

        try {
            const rung = this.nextRung(age);

            if (rung) {
                // Still inside the ladder's window: hand it back to the normal
                // path rather than reconciling here. The jobId is the same one
                // the producer and processor use, so if the job DOES exist this
                // is a no-op inside BullMQ — the sweeper only fills real holes,
                // and never double-schedules a rung.
                await this.reconcileQueue.add(
                    'check',
                    { paymentId: payment.id, attempt: rung.attempt },
                    {
                        jobId: `reconcile:${payment.id}:${rung.attempt}`,
                        delay: rung.delay,
                        removeOnComplete: true,
                        removeOnFail: true,
                    },
                );
                this.logger.log(
                    `Sweep re-armed payment ${payment.id} at attempt ${rung.attempt} (fires in ${rung.delay}ms)`,
                );
                return;
            }

            // Past the ladder. Safaricom is the source of truth, so ask before
            // concluding anything — unless the checkout is so old that asking
            // is pointless. Daraja will not give a useful answer for a
            // fortnight-old CheckoutRequestID, and the attempt spends
            // rate-limit budget that payments which can still resolve need.
            if (age > SWEEP_QUERY_MAX_AGE_MS) {
                this.logger.warn(
                    `Sweep force-expiring payment ${payment.id} unqueried — ${Math.floor(age / 3_600_000)}h old`,
                );
                await this.paymentService.forceExpireIfStillProcessing(payment.id);
                return;
            }

            const { payment: checked, answered } =
                await this.paymentService.settleFromStatusQuery(payment.id);

            if (!answered) {
                // Daraja never gave a verdict — unreachable, or a 429. That is
                // "we don't know", and force-expiring on it would cancel a
                // booking we never actually checked. Leave it PROCESSING; the
                // next sweep asks again, and the row stays in the work list
                // precisely because it is still PROCESSING.
                this.logger.warn(
                    `Sweep left payment ${payment.id} PROCESSING — M-Pesa gave no answer; retrying next sweep`,
                );
                return;
            }

            if (checked.status === PaymentStatus.PROCESSING) {
                // Daraja answered, and the answer was "still in flight" on a
                // checkout that is already past its ceiling. That is as
                // resolved as this payment is ever going to get on its own.
                await this.paymentService.forceExpireIfStillProcessing(payment.id);
            }
        } catch (err: any) {
            // One unsettleable payment must not abort the rest of the batch.
            this.logger.error(`Sweep could not settle payment ${payment.id}: ${err.message}`);
        }
    }

    /**
     * The rung a payment of this age is still owed, or null once the ladder is
     * exhausted.
     *
     * Derived from RECONCILE_DELAYS_MS rather than restated, so the sweeper
     * cannot drift out of step with the processor or with SEAT_HOLD_MS: adding
     * a rung to that array extends all three at once. `delay` is the remainder
     * until the rung was due, so a payment recovered mid-ladder resumes on the
     * original clock instead of restarting it.
     */
    private nextRung(age: number): LadderRung | null {
        let dueAt = 0;

        for (let i = 0; i < RECONCILE_DELAYS_MS.length; i++) {
            dueAt += RECONCILE_DELAYS_MS[i];
            if (age < dueAt) {
                return { attempt: i + 1, delay: dueAt - age };
            }
        }

        return null;
    }
}
