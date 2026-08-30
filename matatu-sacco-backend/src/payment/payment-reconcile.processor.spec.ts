// src/payment/payment-reconcile.processor.spec.ts
//
// The reconcile ladder is the guarantee every comment in payment.service.ts
// leans on: "nothing stays PROCESSING forever". These tests pin both halves
// of that guarantee — the ladder's own logic, and the module wiring that
// decides whether the ladder runs at all.
//
// The wiring half is not theoretical. `PaymentReconcileProcessor` was written,
// compiled and deployed while missing from PaymentModule's `providers`, so no
// worker was ever created for the queue. The producer kept working, jobs piled
// up in `delayed`, nothing threw, and real payments sat PROCESSING for hours
// with their seats held. A unit test of process() would not have caught it.
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PaymentReconcileProcessor } from './payment-reconcile.processor';
import { PaymentService } from './payment.service';
import { PaymentModule } from './payment.module';
import { Payment, PaymentStatus } from './entities/payment.entity';
import {
    RECONCILE_DELAYS_MS,
    SEAT_HOLD_MS,
} from './payment-reconcile.constants';

const QUEUE_NAME = 'payment-reconcile';

// @nestjs/bullmq keeps this key internal (bull.constants.ts), but the whole
// point of these tests is to assert against what the library actually reads,
// so we use its real key rather than a stand-in. The first test fails loudly
// if a future version renames it, which is the outcome we want — a vacuous
// pass here is exactly how the original bug survived.
const PROCESSOR_METADATA = 'bullmq:processor_metadata';

describe('PaymentReconcileProcessor', () => {
    let processor: PaymentReconcileProcessor;
    let paymentService: {
        reconcileStuckPayment: jest.Mock;
        forceExpireIfStillProcessing: jest.Mock;
    };
    let reconcileQueue: { add: jest.Mock };

    const job = (paymentId: string, attempt: number) =>
        ({ data: { paymentId, attempt } }) as Job<{
            paymentId: string;
            attempt: number;
        }>;

    const payment = (status: PaymentStatus): Payment =>
        ({ id: 'payment-1', status }) as Payment;

    beforeEach(async () => {
        paymentService = {
            reconcileStuckPayment: jest.fn(),
            forceExpireIfStillProcessing: jest.fn().mockResolvedValue(undefined),
        };
        reconcileQueue = { add: jest.fn().mockResolvedValue(undefined) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentReconcileProcessor,
                { provide: PaymentService, useValue: paymentService },
                { provide: getQueueToken(QUEUE_NAME), useValue: reconcileQueue },
            ],
        }).compile();

        processor = module.get(PaymentReconcileProcessor);
    });

    afterEach(() => jest.clearAllMocks());

    // ─── Wiring: does the ladder exist at runtime at all? ─────────────────
    describe('module wiring', () => {
        it('carries @Processor metadata naming the payment-reconcile queue', () => {
            const metadata = Reflect.getMetadata(
                PROCESSOR_METADATA,
                PaymentReconcileProcessor,
            );

            // If this is undefined the metadata key changed upstream and every
            // other assertion in this describe block is worthless — fix the key.
            expect(metadata).toBeDefined();
            expect(metadata.name).toBe(QUEUE_NAME);
        });

        it('extends WorkerHost, which BullExplorer requires of a processor', () => {
            // BullExplorer throws InvalidProcessorClassError otherwise — but
            // only for classes it can see, i.e. registered providers.
            expect(processor).toBeInstanceOf(WorkerHost);
        });

        it('REGRESSION: is listed in PaymentModule providers, so a worker is created', () => {
            const providers = Reflect.getMetadata('providers', PaymentModule) ?? [];

            // Nest instantiates only what a module declares, and BullExplorer
            // discovers processors by walking instantiated providers
            // (discoveryService.getProviders()). A @Processor class absent from
            // this array is invisible: no worker, no consumer, no error.
            expect(providers).toContain(PaymentReconcileProcessor);
        });

        it('REGRESSION: the queue it consumes is the queue PaymentService produces to', () => {
            const imports = Reflect.getMetadata('imports', PaymentModule) ?? [];

            // registerQueue() contributes a provider under the queue's
            // injection token; PaymentService injects that same token to call
            // .add(). A mismatch between the two names would leave jobs on a
            // queue nobody consumes — the same outage, different cause.
            const registeredTokens = imports.flatMap((imported: any) =>
                (imported?.providers ?? []).map((p: any) => p?.provide),
            );

            expect(registeredTokens).toContain(getQueueToken(QUEUE_NAME));
        });
    });

    // ─── The ladder's schedule ────────────────────────────────────────────
    describe('schedule', () => {
        it('stops as soon as the payment has resolved, without rescheduling', async () => {
            paymentService.reconcileStuckPayment.mockResolvedValue(
                payment(PaymentStatus.SUCCESS),
            );

            await processor.process(job('payment-1', 1));

            expect(reconcileQueue.add).not.toHaveBeenCalled();
            expect(paymentService.forceExpireIfStillProcessing).not.toHaveBeenCalled();
        });

        it('stops on a resolved FAILED payment too — the callback already won', async () => {
            paymentService.reconcileStuckPayment.mockResolvedValue(
                payment(PaymentStatus.FAILED),
            );

            await processor.process(job('payment-1', 2));

            expect(reconcileQueue.add).not.toHaveBeenCalled();
            expect(paymentService.forceExpireIfStillProcessing).not.toHaveBeenCalled();
        });

        it('schedules the next rung with the next delay while still PROCESSING', async () => {
            paymentService.reconcileStuckPayment.mockResolvedValue(
                payment(PaymentStatus.PROCESSING),
            );

            await processor.process(job('payment-1', 1));

            expect(paymentService.forceExpireIfStillProcessing).not.toHaveBeenCalled();
            expect(reconcileQueue.add).toHaveBeenCalledWith(
                'check',
                { paymentId: 'payment-1', attempt: 2 },
                expect.objectContaining({
                    jobId: 'reconcile:payment-1:2',
                    delay: RECONCILE_DELAYS_MS[1],
                }),
            );
        });

        it('uses a deterministic jobId per attempt, so a redelivery cannot double-book a rung', async () => {
            paymentService.reconcileStuckPayment.mockResolvedValue(
                payment(PaymentStatus.PROCESSING),
            );

            await processor.process(job('payment-1', 1));
            await processor.process(job('payment-1', 1));

            const [firstCall, secondCall] = reconcileQueue.add.mock.calls;
            expect(firstCall[2].jobId).toBe(secondCall[2].jobId);
        });

        it('force-expires once the schedule is exhausted, so nothing stays PROCESSING forever', async () => {
            paymentService.reconcileStuckPayment.mockResolvedValue(
                payment(PaymentStatus.PROCESSING),
            );

            // The last rung: RECONCILE_DELAYS_MS[attempt] is undefined here.
            await processor.process(job('payment-1', RECONCILE_DELAYS_MS.length));

            expect(reconcileQueue.add).not.toHaveBeenCalled();
            expect(paymentService.forceExpireIfStillProcessing).toHaveBeenCalledWith(
                'payment-1',
            );
        });

        it('walks the whole ladder and force-expires exactly once', async () => {
            paymentService.reconcileStuckPayment.mockResolvedValue(
                payment(PaymentStatus.PROCESSING),
            );

            // Drive every rung the way the queue would, following the attempt
            // number the processor itself asks for next.
            let attempt = 1;
            for (let rung = 0; rung < RECONCILE_DELAYS_MS.length; rung++) {
                await processor.process(job('payment-1', attempt));
                const lastAdd = reconcileQueue.add.mock.calls.at(-1);
                if (lastAdd) attempt = lastAdd[1].attempt;
            }

            expect(reconcileQueue.add).toHaveBeenCalledTimes(
                RECONCILE_DELAYS_MS.length - 1,
            );
            expect(paymentService.forceExpireIfStillProcessing).toHaveBeenCalledTimes(1);
        });
    });

    // ─── The deadline shared with the seat hold ───────────────────────────
    describe('deadlines', () => {
        it('holds a seat for exactly as long as the ladder can still resolve the payment', () => {
            // SEAT_HOLD_MS is derived from the ladder rather than hand-picked:
            // releasing sooner double-sells a seat someone is paying for,
            // releasing later strands a dead seat. One deadline, one source.
            const ladderTotal = RECONCILE_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
            expect(SEAT_HOLD_MS).toBe(ladderTotal);
        });

        it('gives the passenger a realistic first window before the first check', () => {
            // Below ~2 minutes the first check races normal PIN-entry time and
            // Daraja's callback latency, which is what the grace window in
            // isTerminalQueryResult exists to compensate for.
            expect(RECONCILE_DELAYS_MS[0]).toBeGreaterThanOrEqual(120_000);
        });
    });
});
