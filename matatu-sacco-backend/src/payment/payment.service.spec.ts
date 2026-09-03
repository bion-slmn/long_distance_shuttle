// src/payment/payment.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { PaymentService } from './payment.service';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
  PaymentReferenceType,
} from './entities/payment.entity';
import { MpesaService } from './mpesa/mpesa.service';
import { getQueueToken } from '@nestjs/bullmq';
import { MpesaTransactionMatchStatus, MpesaTransactionSource } from './entities/mpesa.entity';

type MockRepo<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const createMockRepo = (): MockRepo<Payment> => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  createQueryBuilder: jest.fn(),
  // Raw-SQL escape hatch used by isForStage()
  manager: { query: jest.fn().mockResolvedValue([]) } as any,
});

describe('PaymentService', () => {
  let service: PaymentService;
  let paymentRepository: MockRepo<Payment>;
  let mpesaService: Partial<Record<keyof MpesaService, jest.Mock>>;
  let eventEmitter: Partial<Record<keyof EventEmitter2, jest.Mock>>;
  let reconcileQueue: { add: jest.Mock };

  const basePayment = (overrides: Partial<Payment> = {}): Payment =>
    ({
      id: 'payment-1',
      referenceType: PaymentReferenceType.BOOKING,
      referenceId: 'booking-1',
      saccoId: 'sacco-1',
      amount: 500,
      method: PaymentMethod.MPESA,
      status: PaymentStatus.PENDING,
      payerPhone: '0712345678',
      checkoutRequestId: null,
      merchantRequestId: null,
      callbackNonce: 'nonce-1',
      mpesaReceiptNumber: null,
      resultCode: null,
      resultDesc: null,
      initiationErrorMessage: null,
      initiationErrorCode: null,
      initiatedAt: null,
      completedAt: null,
      rawCallbackPayload: null,
      createdAt: new Date(),
      ...overrides,
    }) as Payment;

  beforeEach(async () => {
    paymentRepository = createMockRepo();
    mpesaService = {
      initiateStkPush: jest.fn(),
      queryStkStatus: jest.fn(),
      // Receipt recovery for a reconcile-confirmed success — nothing stored
      // by default, so tests opt in.
      findTransactionByCheckoutRequestId: jest.fn().mockResolvedValue(null),
      findTransactionByReceiptNumber: jest.fn().mockResolvedValue(null),
      findUnmatchedReceiptForPayment: jest.fn().mockResolvedValue(null),
      matchTransaction: jest.fn(),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    reconcileQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: MpesaService, useValue: mpesaService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: getQueueToken('payment-reconcile'), useValue: reconcileQueue },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── initiateMpesaPayment ────────────────────────────────────────────
  describe('initiateMpesaPayment', () => {
    const input = {
      referenceType: PaymentReferenceType.BOOKING,
      referenceId: 'booking-1',
      saccoId: 'sacco-1',
      amount: 500,
      payerPhone: '0712345678',
      accountReference: 'ABC12345',
    };

    it('creates a PENDING payment, pushes STK, and moves it to PROCESSING on success', async () => {
      const created = basePayment({ status: PaymentStatus.PENDING });
      paymentRepository.create!.mockReturnValue(created);
      paymentRepository.save!
        .mockResolvedValueOnce(created) // initial save (PENDING)
        .mockResolvedValueOnce({ ...created, status: PaymentStatus.PROCESSING }); // after STK

      mpesaService.initiateStkPush!.mockResolvedValue({
        checkoutRequestId: 'ws_CO_123',
        merchantRequestId: 'mr_123',
      });

      const result = await service.initiateMpesaPayment(input);

      expect(paymentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          method: PaymentMethod.MPESA,
          status: PaymentStatus.PENDING,
          payerPhone: input.payerPhone,
        }),
      );
      expect(mpesaService.initiateStkPush).toHaveBeenCalledWith('sacco-1', {
        payerPhone: input.payerPhone,
        amount: input.amount,
        accountReference: input.accountReference,
      });
      expect(paymentRepository.save).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ paymentId: created.id, checkoutRequestId: 'ws_CO_123' });
    });

    it('marks the payment FAILED and rethrows if the STK push fails', async () => {
      const created = basePayment({ status: PaymentStatus.PENDING });
      paymentRepository.create!.mockReturnValue(created);
      paymentRepository.save!.mockResolvedValueOnce(created).mockResolvedValueOnce({
        ...created,
        status: PaymentStatus.FAILED,
      });

      const error: any = new Error('Daraja timeout');
      error.cause = { errorCode: '500.001.1001' };
      mpesaService.initiateStkPush!.mockRejectedValue(error);

      await expect(service.initiateMpesaPayment(input)).rejects.toThrow('Daraja timeout');

      expect(paymentRepository.save).toHaveBeenCalledTimes(2);
      const secondSaveArg = (paymentRepository.save as jest.Mock).mock.calls[1][0];
      expect(secondSaveArg.status).toBe(PaymentStatus.FAILED);
      expect(secondSaveArg.initiationErrorMessage).toBe('Daraja timeout');
      expect(secondSaveArg.initiationErrorCode).toBe('500.001.1001');
    });
  });

  // ─── markProcessing ──────────────────────────────────────────────────
  describe('markProcessing', () => {
    const input = {
      saccoId: 'sacco-1',
      checkoutRequestId: 'ws_CO_123',
      merchantRequestId: 'mr_123',
      payerPhone: '0712345678',
      accountReference: 'ABC12345',
    };

    it('updates the most recent PENDING payment for that sacco/phone', async () => {
      const pending = basePayment({ status: PaymentStatus.PENDING });
      paymentRepository.findOne!.mockResolvedValue(pending);
      paymentRepository.save!.mockResolvedValue({ ...pending, status: PaymentStatus.PROCESSING });

      await service.markProcessing(input);

      expect(paymentRepository.findOne).toHaveBeenCalledWith({
        where: {
          saccoId: input.saccoId,
          payerPhone: input.payerPhone,
          status: PaymentStatus.PENDING,
        },
        order: { createdAt: 'DESC' },
      });
      expect(paymentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.PROCESSING,
          checkoutRequestId: input.checkoutRequestId,
          merchantRequestId: input.merchantRequestId,
        }),
      );
    });

    it('does nothing (no throw) if no PENDING payment is found', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await expect(service.markProcessing(input)).resolves.toBeUndefined();
      expect(paymentRepository.save).not.toHaveBeenCalled();
    });
  });

  // ─── handleMpesaCallback ─────────────────────────────────────────────
  describe('handleMpesaCallback', () => {
    const rawBody = { some: 'raw payload' };

    it('SECURITY: ignores a callback whose nonce does not match the push', async () => {
      const payment = basePayment({ status: PaymentStatus.PROCESSING, callbackNonce: 'nonce-1' });
      paymentRepository.findOne!.mockResolvedValue(payment);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'ws_CO_123', resultCode: 0, resultDesc: 'ok', success: true, amount: 500, mpesaReceiptNumber: 'R1' },
        rawBody,
        'wrong-nonce',
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(payment.status).toBe(PaymentStatus.PROCESSING);
    });

    it('SECURITY: ignores a callback for a payment that never received a nonce', async () => {
      const payment = basePayment({ status: PaymentStatus.PROCESSING, callbackNonce: null });
      paymentRepository.findOne!.mockResolvedValue(payment);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'ws_CO_123', resultCode: 0, resultDesc: 'ok', success: true, amount: 500 },
        rawBody,
        'nonce-1',
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
    });

    it('SECURITY: ignores a "successful" callback whose amount is below what was requested', async () => {
      const payment = basePayment({ status: PaymentStatus.PROCESSING, amount: 500 });
      paymentRepository.findOne!.mockResolvedValue(payment);

      await service.handleMpesaCallback(
        {
          checkoutRequestId: 'ws_CO_123',
          resultCode: 0,
          resultDesc: 'ok',
          success: true,
          amount: 1,
          mpesaReceiptNumber: 'FAKE1',
        },
        rawBody, 'nonce-1',
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(payment.status).toBe(PaymentStatus.PROCESSING);
    });

    it('logs and returns early if no payment matches the checkoutRequestId', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'unknown', resultCode: 0, resultDesc: 'ok', success: true },
        rawBody, 'nonce-1',
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('is idempotent — ignores callbacks for already-SUCCESS payments', async () => {
      const payment = basePayment({ status: PaymentStatus.SUCCESS });
      paymentRepository.findOne!.mockResolvedValue(payment);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'ws_CO_123', resultCode: 0, resultDesc: 'ok', success: true },
        rawBody, 'nonce-1',
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('is idempotent — ignores callbacks for already-FAILED payments', async () => {
      const payment = basePayment({ status: PaymentStatus.FAILED });
      paymentRepository.findOne!.mockResolvedValue(payment);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'ws_CO_123', resultCode: 1, resultDesc: 'cancelled', success: false },
        rawBody, 'nonce-1',
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('marks a PROCESSING payment SUCCESS and emits payment.succeeded', async () => {
      const payment = basePayment({ status: PaymentStatus.PROCESSING });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);

      await service.handleMpesaCallback(
        {
          checkoutRequestId: 'ws_CO_123',
          resultCode: 0,
          resultDesc: 'The service request is processed successfully.',
          success: true,
          mpesaReceiptNumber: 'NLJ7RT61SV',
        },
        rawBody, 'nonce-1',
      );

      expect(paymentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.SUCCESS,
          mpesaReceiptNumber: 'NLJ7RT61SV',
          rawCallbackPayload: rawBody,
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({
          paymentId: payment.id,
          referenceId: payment.referenceId,
          mpesaReceiptNumber: 'NLJ7RT61SV',
        }),
      );
    });

    it('marks the stored STK receipt MATCHED against the booking it confirmed', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.findTransactionByCheckoutRequestId!.mockResolvedValue({
        id: 'tx-1',
        mpesaReceiptNumber: 'NLJ7RT61SV',
        matchStatus: 'UNMATCHED',
      });

      await service.handleMpesaCallback(
        {
          checkoutRequestId: 'ws_CO_123',
          resultCode: 0,
          resultDesc: 'ok',
          success: true,
          mpesaReceiptNumber: 'NLJ7RT61SV',
        },
        rawBody, 'nonce-1',
      );

      expect(mpesaService.findTransactionByCheckoutRequestId).toHaveBeenCalledWith('ws_CO_123');
      expect(mpesaService.matchTransaction).toHaveBeenCalledWith(
        'tx-1',
        payment.referenceId,
        payment.id,
        'STK_CALLBACK',
      );
    });

    it('leaves a transaction another claim already matched alone', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.findTransactionByCheckoutRequestId!.mockResolvedValue({
        id: 'tx-1',
        mpesaReceiptNumber: 'NLJ7RT61SV',
        matchStatus: 'MATCHED',
      });

      await service.handleMpesaCallback(
        {
          checkoutRequestId: 'ws_CO_123',
          resultCode: 0,
          resultDesc: 'ok',
          success: true,
          mpesaReceiptNumber: 'NLJ7RT61SV',
        },
        rawBody, 'nonce-1',
      );

      expect(mpesaService.matchTransaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({ paymentId: payment.id }),
      );
    });

    it('still confirms the booking when the receipt cannot be matched', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.findTransactionByCheckoutRequestId!.mockRejectedValue(
        new Error('database is on fire'),
      );

      await service.handleMpesaCallback(
        {
          checkoutRequestId: 'ws_CO_123',
          resultCode: 0,
          resultDesc: 'ok',
          success: true,
          mpesaReceiptNumber: 'NLJ7RT61SV',
        },
        rawBody, 'nonce-1',
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({
          paymentId: payment.id,
          mpesaReceiptNumber: 'NLJ7RT61SV',
        }),
      );
    });

    it('marks a PROCESSING payment FAILED and emits payment.failed', async () => {
      const payment = basePayment({ status: PaymentStatus.PROCESSING });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);

      await service.handleMpesaCallback(
        {
          checkoutRequestId: 'ws_CO_123',
          resultCode: 1032,
          resultDesc: 'Request cancelled by user.',
          success: false,
        },
        rawBody, 'nonce-1',
      );

      expect(paymentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.FAILED }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.failed',
        expect.objectContaining({
          paymentId: payment.id,
          reason: 'Request cancelled by user.',
        }),
      );
    });
  });

  // ─── recordCashPayment ───────────────────────────────────────────────
  describe('recordCashPayment', () => {
    it('creates a SUCCESS cash payment synchronously', async () => {
      const input = {
        referenceType: PaymentReferenceType.BOOKING,
        referenceId: 'booking-1',
        saccoId: 'sacco-1',
        amount: 500,
      };
      const created = basePayment({ method: PaymentMethod.CASH, status: PaymentStatus.SUCCESS });
      paymentRepository.create!.mockReturnValue(created);
      paymentRepository.save!.mockResolvedValue(created);

      const result = await service.recordCashPayment(input);

      expect(paymentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ...input,
          method: PaymentMethod.CASH,
          status: PaymentStatus.SUCCESS,
        }),
      );
      expect(result).toEqual(created);
    });
  });

  // ─── findById / findByReference ──────────────────────────────────────
  describe('findById', () => {
    it('returns the payment when found', async () => {
      const payment = basePayment();
      paymentRepository.findOne!.mockResolvedValue(payment);

      await expect(service.findById('payment-1')).resolves.toEqual(payment);
    });

    it('throws NotFoundException when not found', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByReference', () => {
    it('returns null when nothing matches (no throw)', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await expect(
        service.findByReference(PaymentReferenceType.BOOKING, 'booking-x'),
      ).resolves.toBeNull();
    });
  });

  // ─── getStatusByBookingId ────────────────────────────────────────────
  describe('getStatusByBookingId', () => {
    it('throws NotFoundException if no payment exists for the booking', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await expect(service.getStatusByBookingId('booking-1')).rejects.toThrow(NotFoundException);
    });

    it('returns errorMessage from resultDesc when FAILED', async () => {
      const payment = basePayment({
        status: PaymentStatus.FAILED,
        resultDesc: 'Insufficient funds',
        initiationErrorMessage: null,
      });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.getStatusByBookingId('booking-1');

      expect(result).toEqual({
        paymentId: payment.id,
        status: PaymentStatus.FAILED,
        method: payment.method,
        errorMessage: 'Insufficient funds',
        mpesaReceiptNumber: null,
      });
    });

    it('falls back to initiationErrorMessage when resultDesc is absent', async () => {
      const payment = basePayment({
        status: PaymentStatus.FAILED,
        resultDesc: null,
        initiationErrorMessage: 'STK push failed to dispatch',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.getStatusByBookingId('booking-1');

      expect(result.errorMessage).toBe('STK push failed to dispatch');
    });

    it('returns null errorMessage when payment is not FAILED', async () => {
      const payment = basePayment({ status: PaymentStatus.SUCCESS });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.getStatusByBookingId('booking-1');

      expect(result.errorMessage).toBeNull();
    });
  });

  // ─── reconcileStuckPayment ───────────────────────────────────────────
  describe('reconcileStuckPayment', () => {
    // Comfortably past RECONCILE_GRACE_MS, so a query result is allowed to be
    // read as conclusive.
    const staleInitiatedAt = () => new Date(Date.now() - 10 * 60_000);

    it('returns early for a payment Safaricom already settled', async () => {
      const payment = basePayment({ status: PaymentStatus.SUCCESS });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.reconcileStuckPayment('payment-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result).toEqual(payment);
    });

    // EXPIRED is our own guess after a missing callback, never Safaricom's
    // word — so it stays open to correction.
    it('still queries Daraja for a payment we force-expired', async () => {
      const payment = basePayment({
        status: PaymentStatus.EXPIRED,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: staleInitiatedAt(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(mpesaService.queryStkStatus).toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({ paymentId: payment.id }),
      );
    });

    it('leaves an expired payment expired when Daraja is still inconclusive', async () => {
      const payment = basePayment({
        status: PaymentStatus.EXPIRED,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: staleInitiatedAt(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: null,
        resultDesc: 'still processing',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.EXPIRED);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not re-fire the booking side when the verdict is unchanged', async () => {
      const payment = basePayment({
        status: PaymentStatus.EXPIRED,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: staleInitiatedAt(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      // 1032 = cancelled by user, a terminal failure
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1032,
        resultDesc: 'Request cancelled by user',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.FAILED);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    });

    // Regression: a cancellation reported 14s after the push used to be read as
    // "still in flight" and held the seat for the full 3-minute ladder.
    it('fails immediately when the passenger cancelled, however young the push is', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(Date.now() - 14_000), // 14 seconds ago
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1032,
        resultDesc: 'Request Cancelled by user.',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.FAILED);
      expect(result.resultDesc).toBe('Request Cancelled by user.');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.failed',
        expect.objectContaining({ paymentId: payment.id }),
      );
    });

    it.each([
      [2001, 'Wrong PIN'],
      [1, 'Insufficient balance'],
    ])('also acts immediately on resultCode %i', async (resultCode, resultDesc) => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(Date.now() - 5_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode, resultDesc });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.FAILED);
    });

    // The other half of the split: system-condition codes still wait, because a
    // query fired while the prompt is live can surface one before it settles.
    it('still waits out the grace period for a system-condition code', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(Date.now() - 14_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1019,
        resultDesc: 'Transaction expired',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.PROCESSING);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('concludes a system-condition code once the push is old enough', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: staleInitiatedAt(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1019,
        resultDesc: 'Transaction expired',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.FAILED);
    });

    it('recovers the receipt number from a stored M-Pesa transaction on success', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        mpesaReceiptNumber: null,
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      mpesaService.findTransactionByCheckoutRequestId!.mockResolvedValue({
        id: 'tx-1',
        mpesaReceiptNumber: 'NLJ7RT61SV',
        matchStatus: 'UNMATCHED',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      // The stored receipt IS the answer — Daraja is never asked.
      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.mpesaReceiptNumber).toBe('NLJ7RT61SV');
      expect(mpesaService.matchTransaction).toHaveBeenCalledWith(
        'tx-1',
        payment.referenceId,
        payment.id,
        'reconcile:stored-receipt',
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({ mpesaReceiptNumber: 'NLJ7RT61SV' }),
      );
    });

    it('still confirms the success when no stored transaction carries the receipt', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        mpesaReceiptNumber: null,
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' });
      mpesaService.findTransactionByCheckoutRequestId!.mockResolvedValue(null);

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.mpesaReceiptNumber).toBeNull();
      expect(mpesaService.matchTransaction).not.toHaveBeenCalled();
    });

    it('does not overwrite a receipt number it already has', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        mpesaReceiptNumber: 'ALREADYHERE',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.mpesaReceiptNumber).toBe('ALREADYHERE');
      expect(mpesaService.findTransactionByCheckoutRequestId).not.toHaveBeenCalled();
    });

    it('returns early if PROCESSING but has no checkoutRequestId', async () => {
      const payment = basePayment({ status: PaymentStatus.PROCESSING, checkoutRequestId: null });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.reconcileStuckPayment('payment-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result).toEqual(payment);
    });

    it('marks SUCCESS and emits payment.succeeded when Daraja resultCode is 0', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({ paymentId: payment.id }),
      );
    });

    it('leaves payment PROCESSING (no save/emit) when Daraja says still being processed (1037)', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1037,
        resultDesc: 'Transaction is being processed',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PROCESSING);
    });

    it('leaves payment PROCESSING for an unrecognised code even after the grace window', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: staleInitiatedAt(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 9999,
        resultDesc: 'Request is still being processed by the system',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PROCESSING);
    });

    // Daraja's in-flight answer carries no ResultCode at all. This is the
    // exact shape that used to be read as a failure and cancel the booking.
    it('leaves payment PROCESSING when Daraja returns no usable ResultCode', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: staleInitiatedAt(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: null,
        resultDesc: 'The transaction is being processed',
        errorCode: '500.001.1001',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PROCESSING);
    });

    it('marks FAILED and emits payment.failed for a terminal code after the grace window', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: staleInitiatedAt(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1032,
        resultDesc: 'Request cancelled by user',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.FAILED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.failed',
        expect.objectContaining({ paymentId: payment.id, reason: 'Request cancelled by user' }),
      );
    });

    // A clerk pressing "check now" seconds after the push must never be able
    // to cancel a booking the passenger is still paying for. A real
    // cancellation reaches us on the callback, which is authoritative.
    it('does NOT mark FAILED for a system-condition code inside the grace window', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(), // pushed just now
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1019,
        resultDesc: 'Transaction expired',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.PROCESSING);
    });

    it('falls back to createdAt for the grace window when initiatedAt is null', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: null,
        createdAt: new Date(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({
        resultCode: 1019,
        resultDesc: 'Transaction expired',
      });

      const result = await service.reconcileStuckPayment('payment-1');

      expect(result.status).toBe(PaymentStatus.PROCESSING);
    });
  });

  // ─── reconcileByBookingId ────────────────────────────────────────────
  // ─── forceExpireIfStillProcessing ────────────────────────────────────
  // The last rung of the reconcile ladder, and the only thing standing
  // between a silent M-Pesa timeout and a booking that holds its seat
  // forever. It has to be a conditional transition: by the time it fires,
  // the real callback may already have landed.
  describe('forceExpireIfStillProcessing', () => {
    it('expires a still-PROCESSING payment and emits payment.failed', async () => {
      const expired = basePayment({
        status: PaymentStatus.EXPIRED,
        resultDesc: 'No confirmation received from M-Pesa within the expected window.',
      });
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      paymentRepository.findOne!.mockResolvedValue(expired);

      const result = await service.forceExpireIfStillProcessing('payment-1');

      expect(result.status).toBe(PaymentStatus.EXPIRED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.failed',
        expect.objectContaining({
          paymentId: 'payment-1',
          referenceType: PaymentReferenceType.BOOKING,
          referenceId: 'booking-1',
        }),
      );
    });

    it('only transitions out of PROCESSING, never stomping a resolved status', async () => {
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      paymentRepository.findOne!.mockResolvedValue(
        basePayment({ status: PaymentStatus.EXPIRED }),
      );

      await service.forceExpireIfStillProcessing('payment-1');

      // The PROCESSING guard lives in the WHERE clause, not in a read-then-write
      // — two workers racing here must not both expire the same payment.
      expect(paymentRepository.update).toHaveBeenCalledWith(
        { id: 'payment-1', status: PaymentStatus.PROCESSING },
        expect.objectContaining({ status: PaymentStatus.EXPIRED }),
      );
    });

    it('stays silent when the callback won the race (affected = 0)', async () => {
      const succeeded = basePayment({
        status: PaymentStatus.SUCCESS,
        mpesaReceiptNumber: 'NLJ7RT61SV',
      });
      paymentRepository.update!.mockResolvedValue({ affected: 0 });
      paymentRepository.findOne!.mockResolvedValue(succeeded);

      const result = await service.forceExpireIfStillProcessing('payment-1');

      // Emitting here would cancel a booking the passenger actually paid for.
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });

    it('stamps completedAt so the payment is not re-swept forever', async () => {
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      paymentRepository.findOne!.mockResolvedValue(
        basePayment({ status: PaymentStatus.EXPIRED }),
      );

      await service.forceExpireIfStillProcessing('payment-1');

      expect(paymentRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ completedAt: expect.any(Date) }),
      );
    });

    it('carries a human-readable reason through to the failure event', async () => {
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      paymentRepository.findOne!.mockResolvedValue(
        basePayment({
          status: PaymentStatus.EXPIRED,
          resultDesc: 'No confirmation received from M-Pesa within the expected window.',
        }),
      );

      await service.forceExpireIfStillProcessing('payment-1');

      const [, event] = (eventEmitter.emit as jest.Mock).mock.calls[0];
      expect(event.reason).toMatch(/no confirmation received/i);
    });
  });

  describe('reconcileByBookingId — the manual "Check M-Pesa" press', () => {
    // Older than the whole ladder: the automatic checks are done with it.
    const ladderDone = () => new Date(Date.now() - 10 * 60_000);

    it('throws NotFoundException if no payment exists for the booking', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await expect(service.reconcileByBookingId('booking-1')).rejects.toThrow(NotFoundException);
    });

    it('checks records only while the ladder is still running — never Daraja', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(Date.now() - 30_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.reconcileByBookingId('booking-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result.checkedWith).toBe('records');
      expect(result.mpesaCheckAvailableInSeconds).toBeNull();
      expect(result.payment.status).toBe(PaymentStatus.PROCESSING);
    });

    it('settles from a stored receipt without Daraja, whatever the age', async () => {
      const payment = basePayment({
        status: PaymentStatus.EXPIRED,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: ladderDone(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      mpesaService.findUnmatchedReceiptForPayment!.mockResolvedValue({
        id: 'tx-1',
        mpesaReceiptNumber: 'RKT1TEST001',
        matchStatus: 'UNMATCHED',
      });

      const result = await service.reconcileByBookingId('booking-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result.checkedWith).toBe('records');
      expect(result.payment.status).toBe(PaymentStatus.SUCCESS);
      expect(result.payment.mpesaReceiptNumber).toBe('RKT1TEST001');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({ paymentId: 'payment-1' }),
      );
    });

    it('asks Daraja for an EXPIRED payment nobody has asked about lately', async () => {
      const payment = basePayment({
        status: PaymentStatus.EXPIRED,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: ladderDone(),
        lastStatusQueryAt: new Date(Date.now() - 5 * 60_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode: 0, resultDesc: 'Success' });

      const result = await service.reconcileByBookingId('booking-1');

      expect(mpesaService.queryStkStatus).toHaveBeenCalledTimes(1);
      expect(result.checkedWith).toBe('mpesa');
      expect(result.payment.status).toBe(PaymentStatus.SUCCESS);
      // The ask was stamped so the next press within a minute is refused.
      expect(paymentRepository.update).toHaveBeenCalledWith(
        { id: 'payment-1' },
        expect.objectContaining({ lastStatusQueryAt: expect.any(Date) }),
      );
    });

    it('refuses to repeat a Daraja query asked within the last minute, and says when it can', async () => {
      const payment = basePayment({
        status: PaymentStatus.EXPIRED,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: ladderDone(),
        lastStatusQueryAt: new Date(Date.now() - 20_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.reconcileByBookingId('booking-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result.checkedWith).toBe('records');
      expect(result.mpesaCheckAvailableInSeconds).toBeGreaterThanOrEqual(39);
      expect(result.mpesaCheckAvailableInSeconds).toBeLessThanOrEqual(40);
    });

    it('treats a PROCESSING payment the ladder never finished like an expired one', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: ladderDone(),
        lastStatusQueryAt: null,
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode: null, resultDesc: 'processing', errorCode: '500.001.1001' });

      const result = await service.reconcileByBookingId('booking-1');

      expect(mpesaService.queryStkStatus).toHaveBeenCalledTimes(1);
      expect(result.checkedWith).toBe('mpesa');
    });

    it('never asks Daraja about a payment Safaricom already settled', async () => {
      paymentRepository.findOne!.mockResolvedValue(
        basePayment({ status: PaymentStatus.FAILED, checkoutRequestId: 'ws_CO_123', initiatedAt: ladderDone() }),
      );

      const result = await service.reconcileByBookingId('booking-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result.payment.status).toBe(PaymentStatus.FAILED);
    });
  });

  // ── Clerk stage scoping ─────────────────────────────────────────────────
  describe('findBySacco — clerk stage scoping', () => {
    const mockQb = () => {
      const qb: any = {};
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.orderBy = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      return qb;
    };

    it('restricts results to bookings departing from the assigned stage', async () => {
      const qb = mockQb();
      (paymentRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await service.findBySacco('sacco-1', { assignedStage: 'Kencom' });

      const stageCall = qb.andWhere.mock.calls.find((c: any[]) =>
        String(c[0]).includes('r.origin = :assignedStage'),
      );
      expect(stageCall).toBeDefined();
      expect(stageCall[1]).toMatchObject({
        assignedStage: 'Kencom',
        bookingRef: PaymentReferenceType.BOOKING,
      });
    });

    it('adds no stage filter for an admin', async () => {
      const qb = mockQb();
      (paymentRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await service.findBySacco('sacco-1', {});

      const stageCalls = qb.andWhere.mock.calls.filter((c: any[]) =>
        String(c[0]).includes('r.origin'),
      );
      expect(stageCalls).toHaveLength(0);
    });
  });

  describe('isForStage', () => {
    it('is true when the payment\'s booking departs from that stage', async () => {
      (paymentRepository.manager as any).query.mockResolvedValueOnce([{ '?column?': 1 }]);

      const result = await service.isForStage(basePayment(), 'Kencom');

      expect(result).toBe(true);
      expect((paymentRepository.manager as any).query).toHaveBeenCalledWith(
        expect.stringContaining('r.origin'),
        ['booking-1', 'Kencom'],
      );
    });

    it('is false when the booking belongs to another stage', async () => {
      (paymentRepository.manager as any).query.mockResolvedValueOnce([]);

      expect(await service.isForStage(basePayment(), 'Kencom')).toBe(false);
    });

    it('is false for a payment that is not tied to a booking at all', async () => {
      const nonBooking = basePayment({ referenceType: 'SACCO_SUBSCRIPTION' as any });

      expect(await service.isForStage(nonBooking, 'Kencom')).toBe(false);
      expect((paymentRepository.manager as any).query).not.toHaveBeenCalled();
    });
  });

  // ─── Paybill (C2B) receipts settle payments without Daraja ──────────────
  const c2bReceipt = (overrides: any = {}) => ({
    id: 'tx-1',
    source: MpesaTransactionSource.C2B,
    saccoId: 'sacco-1',
    mpesaReceiptNumber: 'RKT1TEST001',
    checkoutRequestId: null,
    amount: '500.00',
    payerPhone: '254712345678',
    billRefNumber: 'NRB-MSA',
    businessShortCode: '600984',
    transactionTime: new Date(),
    matchStatus: MpesaTransactionMatchStatus.UNMATCHED,
    ...overrides,
  });

  describe('handleC2BReceipt', () => {
    it('settles the in-flight STK payment from the same phone for the same amount', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        payerPhone: '0712345678',
        initiatedAt: new Date(Date.now() - 60_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      const receipt = c2bReceipt();

      const settled = await service.handleC2BReceipt(receipt as any);

      expect(settled).toBe(true);
      expect(paymentRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'payment-1' }),
        expect.objectContaining({ status: PaymentStatus.SUCCESS, mpesaReceiptNumber: 'RKT1TEST001' }),
      );
      expect(mpesaService.matchTransaction).toHaveBeenCalledWith('tx-1', 'booking-1', 'payment-1', 'C2B_CONFIRMATION');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({ paymentId: 'payment-1', mpesaReceiptNumber: 'RKT1TEST001' }),
      );
      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
    });

    it('offers the receipt to bookings when no payment row claims it', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);
      const receipt = c2bReceipt();

      const settled = await service.handleC2BReceipt(receipt as any);

      expect(settled).toBe(false);
      expect(paymentRepository.update).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'mpesa.c2b.unmatched',
        expect.objectContaining({
          transactionId: 'tx-1',
          saccoId: 'sacco-1',
          amount: 500,
          payerPhone: '254712345678',
          billRefNumber: 'NRB-MSA',
          mpesaReceiptNumber: 'RKT1TEST001',
        }),
      );
    });

    it('does nothing with a receipt no sacco owns', async () => {
      const settled = await service.handleC2BReceipt(c2bReceipt({ saccoId: null }) as any);

      expect(settled).toBe(false);
      expect(paymentRepository.findOne).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does nothing with a receipt that is already matched', async () => {
      const settled = await service.handleC2BReceipt(
        c2bReceipt({ matchStatus: MpesaTransactionMatchStatus.MATCHED }) as any,
      );

      expect(settled).toBe(false);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('yields when the STK callback settled the payment first', async () => {
      paymentRepository.findOne!.mockResolvedValue(
        basePayment({ status: PaymentStatus.PROCESSING, initiatedAt: new Date() }),
      );
      paymentRepository.update!.mockResolvedValue({ affected: 0 });

      const settled = await service.handleC2BReceipt(c2bReceipt() as any);

      expect(settled).toBe(false);
      expect(mpesaService.matchTransaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('settleFromStatusQuery — stored receipt before Daraja', () => {
    it('settles from a stored paybill receipt and never queries Daraja', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(Date.now() - 5 * 60_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      mpesaService.findUnmatchedReceiptForPayment!.mockResolvedValue(c2bReceipt());

      const outcome = await service.settleFromStatusQuery('payment-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(mpesaService.findUnmatchedReceiptForPayment).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1', payerPhone: '0712345678', amount: 500 }),
      );
      expect(outcome.answered).toBe(true);
      expect(outcome.payment.status).toBe(PaymentStatus.SUCCESS);
      expect(outcome.payment.mpesaReceiptNumber).toBe('RKT1TEST001');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'payment.succeeded',
        expect.objectContaining({ paymentId: 'payment-1', mpesaReceiptNumber: 'RKT1TEST001' }),
      );
    });

    it('prefers the receipt stored under its own checkout id', async () => {
      const payment = basePayment({
        status: PaymentStatus.EXPIRED,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(Date.now() - 5 * 60_000),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.update!.mockResolvedValue({ affected: 1 });
      mpesaService.findTransactionByCheckoutRequestId!.mockResolvedValue(
        c2bReceipt({ source: MpesaTransactionSource.STK_PUSH, checkoutRequestId: 'ws_CO_123' }),
      );

      const outcome = await service.settleFromStatusQuery('payment-1');

      expect(mpesaService.findUnmatchedReceiptForPayment).not.toHaveBeenCalled();
      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(outcome.payment.status).toBe(PaymentStatus.SUCCESS);
    });

    it('falls through to Daraja when nothing is stored', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
        initiatedAt: new Date(),
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      mpesaService.queryStkStatus!.mockResolvedValue({ resultCode: null, resultDesc: 'processing', errorCode: '500.001.1001' });

      await service.settleFromStatusQuery('payment-1');

      expect(mpesaService.queryStkStatus).toHaveBeenCalled();
    });
  });

  describe('recordC2BPayment', () => {
    const input = {
      bookingId: 'booking-1',
      saccoId: 'sacco-1',
      amount: 500,
      payerPhone: '254712345678',
      mpesaReceiptNumber: 'RKT1TEST001',
      transactionId: 'tx-1',
    };

    it('creates a SUCCESS M-Pesa payment and claims the receipt', async () => {
      paymentRepository.create!.mockImplementation((d) => d);
      paymentRepository.save!.mockImplementation(async (p) => ({ id: 'payment-9', ...p }));
      mpesaService.matchTransaction!.mockResolvedValue({});

      const result = await service.recordC2BPayment(input);

      expect(result).toEqual({ paymentId: 'payment-9' });
      expect(paymentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceId: 'booking-1',
          method: PaymentMethod.MPESA,
          status: PaymentStatus.SUCCESS,
          mpesaReceiptNumber: 'RKT1TEST001',
        }),
      );
      expect(mpesaService.matchTransaction).toHaveBeenCalledWith('tx-1', 'booking-1', 'payment-9', 'C2B_AUTO_MATCH');
    });

    it('rolls the payment row back when the receipt was already claimed', async () => {
      paymentRepository.create!.mockImplementation((d) => d);
      paymentRepository.save!.mockImplementation(async (p) => ({ id: 'payment-9', ...p }));
      paymentRepository.delete = jest.fn().mockResolvedValue({ affected: 1 });
      mpesaService.matchTransaction!.mockRejectedValue(new Error('already matched'));

      await expect(service.recordC2BPayment(input)).rejects.toThrow('already matched');
      expect(paymentRepository.delete).toHaveBeenCalledWith({ id: 'payment-9' });
    });
  });

  describe('handleMpesaCallback — receipt stored by the paybill path first', () => {
    it('matches the stored row by receipt number when the checkout id finds nothing', async () => {
      const payment = basePayment({ status: PaymentStatus.PROCESSING, checkoutRequestId: 'ws_CO_123' });
      paymentRepository.findOne!.mockResolvedValue(payment);
      paymentRepository.save!.mockImplementation(async (p) => p);
      mpesaService.findTransactionByCheckoutRequestId!.mockResolvedValue(null);
      mpesaService.findTransactionByReceiptNumber!.mockResolvedValue(c2bReceipt());

      await service.handleMpesaCallback(
        {
          checkoutRequestId: 'ws_CO_123',
          resultCode: 0,
          resultDesc: 'Success',
          success: true,
          amount: 500,
          mpesaReceiptNumber: 'RKT1TEST001',
          payerPhone: '254712345678',
        },
        {},
        'nonce-1',
      );

      expect(mpesaService.findTransactionByReceiptNumber).toHaveBeenCalledWith('RKT1TEST001');
      expect(mpesaService.matchTransaction).toHaveBeenCalledWith('tx-1', 'booking-1', 'payment-1', 'STK_CALLBACK');
    });
  });
});
