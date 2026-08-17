// src/payment/payment.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentMethod, PaymentReferenceType, PaymentStatus } from './entities/payment.entity';
import { UserRole } from '../auth/entities/user.entity';

describe('PaymentController', () => {
  let controller: PaymentController;
  let paymentService: Partial<Record<keyof PaymentService, jest.Mock>>;

  const basePayment = (overrides: Partial<any> = {}) => ({
    id: 'payment-1',
    referenceType: PaymentReferenceType.BOOKING,
    referenceId: 'booking-1',
    saccoId: 'sacco-1',
    amount: 500,
    method: PaymentMethod.MPESA,
    status: PaymentStatus.SUCCESS,
    mpesaReceiptNumber: 'NLJ7RT61SV',
    resultDesc: null,
    initiationErrorMessage: null,
    ...overrides,
  });

  const superAdmin = { role: UserRole.SUPER_ADMIN, saccoId: null };
  const saccoAdmin = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
  const otherSaccoAdmin = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-2' };
  const clerkNoSacco = { role: UserRole.CLERK, saccoId: null };

  beforeEach(async () => {
    paymentService = {
      reconcileByBookingId: jest.fn(),
      getStatusByBookingId: jest.fn(),
      recordCashPayment: jest.fn(),
      findBySacco: jest.fn(),
      findByReference: jest.fn(),
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [{ provide: PaymentService, useValue: paymentService }],
    }).compile();

    controller = module.get<PaymentController>(PaymentController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── reconcile ─────────────────────────────────────────────────────────
  describe('reconcile', () => {
    it('returns paymentId/status/mpesaReceiptNumber with null error when SUCCESS', async () => {
      const payment = basePayment({ status: PaymentStatus.SUCCESS });
      paymentService.reconcileByBookingId!.mockResolvedValue(payment);

      const result = await controller.reconcile('booking-1');

      expect(paymentService.reconcileByBookingId).toHaveBeenCalledWith('booking-1');
      expect(result).toEqual({
        paymentId: payment.id,
        status: PaymentStatus.SUCCESS,
        errorMessage: null,
        mpesaReceiptNumber: payment.mpesaReceiptNumber,
      });
    });

    it('surfaces resultDesc as errorMessage when FAILED', async () => {
      const payment = basePayment({
        status: PaymentStatus.FAILED,
        resultDesc: 'Insufficient funds',
        mpesaReceiptNumber: null,
      });
      paymentService.reconcileByBookingId!.mockResolvedValue(payment);

      const result = await controller.reconcile('booking-1');

      expect(result.errorMessage).toBe('Insufficient funds');
    });

    it('falls back to initiationErrorMessage, then a generic message, when FAILED', async () => {
      const payment = basePayment({
        status: PaymentStatus.FAILED,
        resultDesc: null,
        initiationErrorMessage: 'STK dispatch failed',
      });
      paymentService.reconcileByBookingId!.mockResolvedValue(payment);

      const result = await controller.reconcile('booking-1');
      expect(result.errorMessage).toBe('STK dispatch failed');

      const payment2 = basePayment({
        status: PaymentStatus.FAILED,
        resultDesc: null,
        initiationErrorMessage: null,
      });
      paymentService.reconcileByBookingId!.mockResolvedValue(payment2);

      const result2 = await controller.reconcile('booking-1');
      expect(result2.errorMessage).toBe('Payment failed.');
    });

    it('propagates NotFoundException from the service', async () => {
      paymentService.reconcileByBookingId!.mockRejectedValue(
        new NotFoundException('No payment found for booking "booking-1".'),
      );

      await expect(controller.reconcile('booking-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getStatusForBooking ───────────────────────────────────────────────
  describe('getStatusForBooking', () => {
    it('delegates directly to paymentService.getStatusByBookingId', async () => {
      const statusResponse = {
        paymentId: 'payment-1',
        status: PaymentStatus.PENDING,
        method: PaymentMethod.MPESA,
        errorMessage: null,
        mpesaReceiptNumber: null,
      };
      paymentService.getStatusByBookingId!.mockResolvedValue(statusResponse);

      const result = await controller.getStatusForBooking('booking-1');

      expect(paymentService.getStatusByBookingId).toHaveBeenCalledWith('booking-1');
      expect(result).toEqual(statusResponse);
    });

    it('propagates NotFoundException from the service', async () => {
      paymentService.getStatusByBookingId!.mockRejectedValue(
        new NotFoundException('No payment found for booking "booking-1".'),
      );

      await expect(controller.getStatusForBooking('booking-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── recordCash ─────────────────────────────────────────────────────────
  describe('recordCash', () => {
    it('delegates the dto straight to paymentService.recordCashPayment', async () => {
      const dto = {
        referenceType: PaymentReferenceType.BOOKING,
        referenceId: 'booking-1',
        saccoId: 'sacco-1',
        amount: 500,
      };
      const created = basePayment({ method: PaymentMethod.CASH, status: PaymentStatus.SUCCESS });
      paymentService.recordCashPayment!.mockResolvedValue(created);

      const result = await controller.recordCash(dto as any);

      expect(paymentService.recordCashPayment).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });
  });

  // ─── findForSacco ───────────────────────────────────────────────────────
  describe('findForSacco', () => {
    it('SUPER_ADMIN: uses the provided ?saccoId query param', () => {
      paymentService.findBySacco!.mockReturnValue([basePayment()]);

      controller.findForSacco('sacco-9', { from: '2026-08-01' } as any, superAdmin);

      expect(paymentService.findBySacco).toHaveBeenCalledWith('sacco-9', { from: '2026-08-01' });
    });

    it('SUPER_ADMIN: passes undefined saccoId through when omitted (all saccos)', () => {
      paymentService.findBySacco!.mockReturnValue([]);

      controller.findForSacco(undefined, {} as any, superAdmin);

      expect(paymentService.findBySacco).toHaveBeenCalledWith(undefined, {});
    });

    it('SACCO_ADMIN: ignores query saccoId and scopes to their own saccoId', () => {
      paymentService.findBySacco!.mockReturnValue([]);

      // Even if they try to pass a different sacco in the query, it's ignored
      controller.findForSacco('sacco-other', {} as any, saccoAdmin);

      expect(paymentService.findBySacco).toHaveBeenCalledWith('sacco-1', {});
    });

    it('throws ForbiddenException for a non-super-admin with no assigned saccoId', () => {
      expect(() => controller.findForSacco(undefined, {} as any, clerkNoSacco)).toThrow(
        ForbiddenException,
      );
      expect(paymentService.findBySacco).not.toHaveBeenCalled();
    });
  });

  // ─── findForBooking ─────────────────────────────────────────────────────
  describe('findForBooking', () => {
    it('returns the payment when found and user is SUPER_ADMIN', async () => {
      const payment = basePayment({ saccoId: 'sacco-1' });
      paymentService.findByReference!.mockResolvedValue(payment);

      const result = await controller.findForBooking('booking-1', superAdmin);

      expect(paymentService.findByReference).toHaveBeenCalledWith(
        PaymentReferenceType.BOOKING,
        'booking-1',
      );
      expect(result).toEqual(payment);
    });

    it('returns the payment when the sacco admin owns the payment saccoId', async () => {
      const payment = basePayment({ saccoId: 'sacco-1' });
      paymentService.findByReference!.mockResolvedValue(payment);

      const result = await controller.findForBooking('booking-1', saccoAdmin);

      expect(result).toEqual(payment);
    });

    it('throws NotFoundException when no payment exists for the booking', async () => {
      paymentService.findByReference!.mockResolvedValue(null);

      await expect(controller.findForBooking('booking-1', superAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when a non-super-admin requests a payment from another sacco', async () => {
      const payment = basePayment({ saccoId: 'sacco-1' });
      paymentService.findByReference!.mockResolvedValue(payment);

      await expect(controller.findForBooking('booking-1', otherSaccoAdmin)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('returns the payment when found and user is SUPER_ADMIN', async () => {
      const payment = basePayment({ saccoId: 'sacco-1' });
      paymentService.findById!.mockResolvedValue(payment);

      const result = await controller.findOne('payment-1', superAdmin);

      expect(paymentService.findById).toHaveBeenCalledWith('payment-1');
      expect(result).toEqual(payment);
    });

    it('returns the payment when the sacco admin owns it', async () => {
      const payment = basePayment({ saccoId: 'sacco-1' });
      paymentService.findById!.mockResolvedValue(payment);

      const result = await controller.findOne('payment-1', saccoAdmin);

      expect(result).toEqual(payment);
    });

    it('propagates NotFoundException from the service when the payment does not exist', async () => {
      paymentService.findById!.mockRejectedValue(new NotFoundException('Payment "x" not found.'));

      await expect(controller.findOne('x', superAdmin)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a non-super-admin requests a payment from another sacco', async () => {
      const payment = basePayment({ saccoId: 'sacco-1' });
      paymentService.findById!.mockResolvedValue(payment);

      await expect(controller.findOne('payment-1', otherSaccoAdmin)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});