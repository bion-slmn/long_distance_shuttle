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

type MockRepo<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const createMockRepo = (): MockRepo<Payment> => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('PaymentService', () => {
  let service: PaymentService;
  let paymentRepository: MockRepo<Payment>;
  let mpesaService: Partial<Record<keyof MpesaService, jest.Mock>>;
  let eventEmitter: Partial<Record<keyof EventEmitter2, jest.Mock>>;

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
    };
    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: MpesaService, useValue: mpesaService },
        { provide: EventEmitter2, useValue: eventEmitter },
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

    it('logs and returns early if no payment matches the checkoutRequestId', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'unknown', resultCode: 0, resultDesc: 'ok', success: true },
        rawBody,
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('is idempotent — ignores callbacks for already-SUCCESS payments', async () => {
      const payment = basePayment({ status: PaymentStatus.SUCCESS });
      paymentRepository.findOne!.mockResolvedValue(payment);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'ws_CO_123', resultCode: 0, resultDesc: 'ok', success: true },
        rawBody,
      );

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('is idempotent — ignores callbacks for already-FAILED payments', async () => {
      const payment = basePayment({ status: PaymentStatus.FAILED });
      paymentRepository.findOne!.mockResolvedValue(payment);

      await service.handleMpesaCallback(
        { checkoutRequestId: 'ws_CO_123', resultCode: 1, resultDesc: 'cancelled', success: false },
        rawBody,
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
        rawBody,
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
        rawBody,
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
    it('returns early if payment is not PROCESSING', async () => {
      const payment = basePayment({ status: PaymentStatus.SUCCESS });
      paymentRepository.findOne!.mockResolvedValue(payment);

      const result = await service.reconcileStuckPayment('payment-1');

      expect(mpesaService.queryStkStatus).not.toHaveBeenCalled();
      expect(result).toEqual(payment);
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

    it('leaves payment PROCESSING when resultDesc text-matches "being processed" even with a different code', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
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

    it('marks FAILED and emits payment.failed for any other resultCode', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
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
  });

  // ─── reconcileByBookingId ────────────────────────────────────────────
  describe('reconcileByBookingId', () => {
    it('throws NotFoundException if no payment exists for the booking', async () => {
      paymentRepository.findOne!.mockResolvedValue(null);

      await expect(service.reconcileByBookingId('booking-1')).rejects.toThrow(NotFoundException);
    });

    it('delegates to reconcileStuckPayment using the found payment id', async () => {
      const payment = basePayment({
        status: PaymentStatus.PROCESSING,
        checkoutRequestId: 'ws_CO_123',
      });
      paymentRepository.findOne!.mockResolvedValue(payment);
      const spy = jest
        .spyOn(service, 'reconcileStuckPayment')
        .mockResolvedValue({ ...payment, status: PaymentStatus.SUCCESS });

      const result = await service.reconcileByBookingId('booking-1');

      expect(spy).toHaveBeenCalledWith(payment.id);
      expect(result.status).toBe(PaymentStatus.SUCCESS);
    });
  });
});