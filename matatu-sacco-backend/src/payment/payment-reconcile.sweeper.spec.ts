// src/payment/payment-reconcile.sweeper.spec.ts
//
// The sweeper exists because the ladder's guarantee — "nothing stays
// PROCESSING forever" — quietly depended on Redis having received the job that
// enforces it. When a Redis outage swallowed one enqueue, the payment had no
// ladder, no force-expiry, and no way back: restarting the app changed
// nothing, because nothing in the app ever consulted the database to find such
// rows. Seventeen had accumulated, the oldest PROCESSING for over two weeks.
//
// These tests pin the two halves that make the sweeper trustworthy: it puts
// payments back on the ladder at the RIGHT rung, and it never concludes
// "expired" from an answer it did not actually get.
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PaymentReconcileSweeper } from './payment-reconcile.sweeper';
import { PaymentService } from './payment.service';
import { PaymentModule } from './payment.module';
import { Payment, PaymentStatus } from './entities/payment.entity';
import {
    RECONCILE_DELAYS_MS,
    SWEEP_BATCH_LIMIT,
    SWEEP_INTERVAL_MS,
    SWEEP_QUERY_MAX_AGE_MS,
    SEAT_HOLD_MS,
} from './payment-reconcile.constants';

const QUEUE_NAME = 'payment-reconcile';
const NOW = new Date('2026-09-01T23:30:00.000Z').getTime();

describe('PaymentReconcileSweeper', () => {
    let sweeper: PaymentReconcileSweeper;
    let paymentService: {
        findProcessingPayments: jest.Mock;
        settleFromStatusQuery: jest.Mock;
        forceExpireIfStillProcessing: jest.Mock;
    };
    let reconcileQueue: { add: jest.Mock };

    // A payment that went out `ageMs` ago and is still PROCESSING.
    const stuck = (id: string, ageMs: number): Payment =>
        ({
            id,
            status: PaymentStatus.PROCESSING,
            initiatedAt: new Date(NOW - ageMs),
            createdAt: new Date(NOW - ageMs - 2_000),
        }) as Payment;

    const answered = (status: PaymentStatus) => ({
        payment: { id: 'payment-1', status } as Payment,
        answered: true,
    });

    // What a 429 or an unreachable Daraja looks like coming back.
    const unanswered = () => ({
        payment: { id: 'payment-1', status: PaymentStatus.PROCESSING } as Payment,
        answered: false,
    });

    beforeEach(async () => {
        jest.spyOn(Date, 'now').mockReturnValue(NOW);

        paymentService = {
            findProcessingPayments: jest.fn().mockResolvedValue([]),
            settleFromStatusQuery: jest.fn().mockResolvedValue(answered(PaymentStatus.PROCESSING)),
            forceExpireIfStillProcessing: jest.fn().mockResolvedValue(undefined),
        };
        reconcileQueue = { add: jest.fn().mockResolvedValue(undefined) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentReconcileSweeper,
                { provide: PaymentService, useValue: paymentService },
                { provide: getQueueToken(QUEUE_NAME), useValue: reconcileQueue },
            ],
        }).compile();

        sweeper = module.get(PaymentReconcileSweeper);
    });

    afterEach(() => jest.restoreAllMocks());

    // ─── Wiring ───────────────────────────────────────────────────────────
    describe('module wiring', () => {
        it('REGRESSION: is listed in PaymentModule providers, so it actually runs', () => {
            // Same failure mode that once left the processor unregistered: a
            // reconcile component Nest never instantiates has no boot hook and
            // no interval, and reports nothing while doing nothing.
            const providers = Reflect.getMetadata('providers', PaymentModule) ?? [];
            expect(providers).toContain(PaymentReconcileSweeper);
        });

        it('sweeps on application bootstrap — restart is the recovery path', async () => {
            await sweeper.onApplicationBootstrap();
            expect(paymentService.findProcessingPayments).toHaveBeenCalledWith(SWEEP_BATCH_LIMIT);
        });

        it('keeps the periodic tick far coarser than the ladder, to protect the Daraja budget', () => {
            // A sweep that ran at ladder speed would re-ask Safaricom about
            // payments the ladder is already handling, and spend the rate-limit
            // headroom the terminal branch needs.
            // An order of magnitude past the full ladder, so every payment gets
            // its own 3-minute schedule before a sweep ever considers it.
            expect(SWEEP_INTERVAL_MS).toBeGreaterThanOrEqual(SEAT_HOLD_MS * 10);
        });
    });

    // ─── Putting payments back on the ladder ──────────────────────────────
    describe('re-arming the ladder', () => {
        it('schedules rung 1 for a payment still inside the first window', async () => {
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', 10_000)]);

            await sweeper.sweep('boot');

            expect(reconcileQueue.add).toHaveBeenCalledWith(
                'check',
                { paymentId: 'payment-1', attempt: 1 },
                expect.objectContaining({
                    jobId: 'reconcile:payment-1:1',
                    delay: RECONCILE_DELAYS_MS[0] - 10_000,
                }),
            );
            expect(paymentService.forceExpireIfStillProcessing).not.toHaveBeenCalled();
        });

        it('resumes on the ORIGINAL clock rather than restarting it', async () => {
            // A recovered payment must still expire at its own 3-minute mark.
            // Re-arming at the full delay would extend the seat hold past
            // SEAT_HOLD_MS and leave a dead seat blocked.
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', 100_000)]);

            await sweeper.sweep('boot');

            const { delay } = reconcileQueue.add.mock.calls[0][2];
            expect(delay).toBe(RECONCILE_DELAYS_MS[0] - 100_000);
            expect(100_000 + delay).toBe(RECONCILE_DELAYS_MS[0]);
        });

        it('skips straight to rung 2 when the first rung is already overdue', async () => {
            const past1 = RECONCILE_DELAYS_MS[0] + 5_000;
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', past1)]);

            await sweeper.sweep('boot');

            expect(reconcileQueue.add).toHaveBeenCalledWith(
                'check',
                { paymentId: 'payment-1', attempt: 2 },
                expect.objectContaining({
                    jobId: 'reconcile:payment-1:2',
                    delay: SEAT_HOLD_MS - past1,
                }),
            );
        });

        it('uses the producer/processor jobId, so a job that DOES exist is a no-op', async () => {
            // BullMQ drops an add() whose jobId is already present. That is what
            // makes sweeping safe to run every 30 minutes: it fills holes and
            // cannot double-schedule a rung the ladder already owns.
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', 1_000)]);

            await sweeper.sweep('boot');
            await sweeper.sweep('scheduled');

            const [first, second] = reconcileQueue.add.mock.calls;
            expect(first[2].jobId).toBe(second[2].jobId);
        });

        it('does not query M-Pesa at all while the ladder can still handle it', async () => {
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', 1_000)]);

            await sweeper.sweep('boot');

            expect(paymentService.settleFromStatusQuery).not.toHaveBeenCalled();
        });
    });

    // ─── Past the ladder ──────────────────────────────────────────────────
    describe('settling payments past the ladder', () => {
        const EXHAUSTED = SEAT_HOLD_MS + 60_000;

        it('asks Safaricom before concluding anything', async () => {
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', EXHAUSTED)]);

            await sweeper.sweep('boot');

            expect(paymentService.settleFromStatusQuery).toHaveBeenCalledWith('payment-1');
            expect(reconcileQueue.add).not.toHaveBeenCalled();
        });

        it('force-expires when Safaricom answers and the payment is still in flight', async () => {
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', EXHAUSTED)]);
            paymentService.settleFromStatusQuery.mockResolvedValue(answered(PaymentStatus.PROCESSING));

            await sweeper.sweep('boot');

            expect(paymentService.forceExpireIfStillProcessing).toHaveBeenCalledWith('payment-1');
        });

        it('leaves a resolved payment alone — the query already settled it', async () => {
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', EXHAUSTED)]);
            paymentService.settleFromStatusQuery.mockResolvedValue(answered(PaymentStatus.SUCCESS));

            await sweeper.sweep('boot');

            expect(paymentService.forceExpireIfStillProcessing).not.toHaveBeenCalled();
        });

        it('REGRESSION: never force-expires on a 429 — no answer is not a verdict', async () => {
            // The whole reason settleFromStatusQuery reports `answered`. Daraja
            // rate-limits, and reading "we could not ask" as "it expired" would
            // cancel a booking whose money may well have landed, on the
            // strength of a check that never happened.
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', EXHAUSTED)]);
            paymentService.settleFromStatusQuery.mockResolvedValue(unanswered());

            await sweeper.sweep('boot');

            expect(paymentService.forceExpireIfStillProcessing).not.toHaveBeenCalled();
        });

        it('retries an unanswered payment on the next sweep, since it stays PROCESSING', async () => {
            paymentService.findProcessingPayments.mockResolvedValue([stuck('payment-1', EXHAUSTED)]);
            paymentService.settleFromStatusQuery.mockResolvedValue(unanswered());

            await sweeper.sweep('boot');
            await sweeper.sweep('scheduled');

            expect(paymentService.settleFromStatusQuery).toHaveBeenCalledTimes(2);
        });

        it('force-expires an ancient payment WITHOUT spending a query on it', async () => {
            // Daraja will not answer usefully for a fortnight-old checkout, and
            // the attempt costs budget that fresher payments need. This is the
            // branch that drains the existing backlog.
            paymentService.findProcessingPayments.mockResolvedValue([
                stuck('payment-1', SWEEP_QUERY_MAX_AGE_MS + 60_000),
            ]);

            await sweeper.sweep('boot');

            expect(paymentService.settleFromStatusQuery).not.toHaveBeenCalled();
            expect(paymentService.forceExpireIfStillProcessing).toHaveBeenCalledWith('payment-1');
        });
    });

    // ─── Rate and robustness ──────────────────────────────────────────────
    describe('protecting the sweep itself', () => {
        it('caps how many payments one tick examines', async () => {
            await sweeper.sweep('scheduled');
            expect(paymentService.findProcessingPayments).toHaveBeenCalledWith(SWEEP_BATCH_LIMIT);
        });

        it('queries one payment at a time rather than firing the batch at once', async () => {
            const EXHAUSTED = SEAT_HOLD_MS + 60_000;
            paymentService.findProcessingPayments.mockResolvedValue([
                stuck('payment-1', EXHAUSTED),
                stuck('payment-2', EXHAUSTED),
                stuck('payment-3', EXHAUSTED),
            ]);

            let inFlight = 0;
            let maxInFlight = 0;
            paymentService.settleFromStatusQuery.mockImplementation(async () => {
                maxInFlight = Math.max(maxInFlight, ++inFlight);
                await Promise.resolve();
                inFlight--;
                return answered(PaymentStatus.PROCESSING);
            });

            await sweeper.sweep('boot');

            // Parallel queries are how a backlog becomes a 429 and every
            // payment in it comes back unanswered.
            expect(maxInFlight).toBe(1);
            expect(paymentService.settleFromStatusQuery).toHaveBeenCalledTimes(3);
        });

        it('does not let two ticks overlap', async () => {
            let release: () => void = () => { };
            paymentService.findProcessingPayments.mockImplementation(
                () => new Promise((resolve) => { release = () => resolve([]); }),
            );

            const first = sweeper.sweep('boot');
            await sweeper.sweep('scheduled'); // must return immediately, not queue up

            expect(paymentService.findProcessingPayments).toHaveBeenCalledTimes(1);

            release();
            await first;
        });

        it('releases the overlap guard even when a sweep throws', async () => {
            paymentService.findProcessingPayments.mockRejectedValueOnce(new Error('db down'));

            await expect(sweeper.sweep('boot')).resolves.toBeUndefined();

            await sweeper.sweep('scheduled');
            expect(paymentService.findProcessingPayments).toHaveBeenCalledTimes(2);
        });

        it('carries on with the batch when one payment cannot be settled', async () => {
            const EXHAUSTED = SEAT_HOLD_MS + 60_000;
            paymentService.findProcessingPayments.mockResolvedValue([
                stuck('payment-1', EXHAUSTED),
                stuck('payment-2', EXHAUSTED),
            ]);
            paymentService.settleFromStatusQuery
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValueOnce(answered(PaymentStatus.SUCCESS));

            await sweeper.sweep('boot');

            expect(paymentService.settleFromStatusQuery).toHaveBeenCalledTimes(2);
        });

        it('falls back to createdAt when initiatedAt is missing, erring early not late', async () => {
            const payment = {
                id: 'payment-1',
                status: PaymentStatus.PROCESSING,
                initiatedAt: null,
                createdAt: new Date(NOW - 10_000),
            } as unknown as Payment;
            paymentService.findProcessingPayments.mockResolvedValue([payment]);

            await sweeper.sweep('boot');

            expect(reconcileQueue.add).toHaveBeenCalledWith(
                'check',
                { paymentId: 'payment-1', attempt: 1 },
                expect.objectContaining({ delay: RECONCILE_DELAYS_MS[0] - 10_000 }),
            );
        });
    });
});
