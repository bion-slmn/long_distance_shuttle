// src/payment/payment.controller.spec.ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { MpesaService } from './mpesa/mpesa.service';
import { PaymentReferenceType, PaymentStatus } from './entities/payment.entity';
import { UserRole } from '../auth/entities/user.entity';

describe('PaymentController', () => {
  let controller: PaymentController;
  let paymentService: jest.Mocked<PaymentService>;
  let mpesaService: jest.Mocked<MpesaService>;

  beforeEach(() => {
    paymentService = {
      reconcileByBookingId: jest.fn(),
      getStatusByBookingId: jest.fn(),
      recordCashPayment: jest.fn(),
      findBySacco: jest.fn(),
      findByReference: jest.fn(),
      findById: jest.fn(),
      isForStage: jest.fn(),
    } as unknown as jest.Mocked<PaymentService>;

    mpesaService = {} as jest.Mocked<MpesaService>;

    controller = new PaymentController(paymentService, mpesaService);
  });

  // ── reconcile ────────────────────────────────────────────────────────
  describe('reconcile', () => {
    it('returns errorMessage from resultDesc when status is FAILED', async () => {
      paymentService.reconcileByBookingId.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.FAILED,
        resultDesc: 'Request Cancelled by user.',
        initiationErrorMessage: null,
        mpesaReceiptNumber: null,
      } as any);

      const result = await controller.reconcile('booking-1');

      expect(paymentService.reconcileByBookingId).toHaveBeenCalledWith('booking-1');
      expect(result).toEqual({
        paymentId: 'pay-1',
        status: PaymentStatus.FAILED,
        errorMessage: 'Request Cancelled by user.',
        mpesaReceiptNumber: null,
      });
    });

    it('falls back to initiationErrorMessage when resultDesc is missing', async () => {
      paymentService.reconcileByBookingId.mockResolvedValue({
        id: 'pay-2',
        status: PaymentStatus.FAILED,
        resultDesc: null,
        initiationErrorMessage: 'Timeout awaiting response.',
        mpesaReceiptNumber: null,
      } as any);

      const result = await controller.reconcile('booking-2');

      expect(result.errorMessage).toBe('Timeout awaiting response.');
    });

    it('falls back to a generic message when neither error field is set', async () => {
      paymentService.reconcileByBookingId.mockResolvedValue({
        id: 'pay-3',
        status: PaymentStatus.FAILED,
        resultDesc: null,
        initiationErrorMessage: null,
        mpesaReceiptNumber: null,
      } as any);

      const result = await controller.reconcile('booking-3');

      expect(result.errorMessage).toBe('Payment failed.');
    });

    it('returns null errorMessage when status is not FAILED', async () => {
      paymentService.reconcileByBookingId.mockResolvedValue({
        id: 'pay-4',
        status: PaymentStatus.SUCCESS,
        resultDesc: null,
        initiationErrorMessage: null,
        mpesaReceiptNumber: 'ABC123',
      } as any);

      const result = await controller.reconcile('booking-4');

      expect(result).toEqual({
        paymentId: 'pay-4',
        status: PaymentStatus.SUCCESS,
        errorMessage: null,
        mpesaReceiptNumber: 'ABC123',
      });
    });
  });

  // ── getStatusForBooking ──────────────────────────────────────────────
  describe('getStatusForBooking', () => {
    it('delegates straight to the service', async () => {
      const status = { status: PaymentStatus.PENDING };
      paymentService.getStatusByBookingId.mockResolvedValue(status as any);

      const result = await controller.getStatusForBooking('booking-1');

      expect(paymentService.getStatusByBookingId).toHaveBeenCalledWith('booking-1');
      expect(result).toBe(status);
    });
  });

  // ── recordCash ───────────────────────────────────────────────────────
  describe('recordCash', () => {
    it('delegates the dto to the service', async () => {
      const dto = { bookingId: 'booking-1', amount: 500 } as any;
      const payment = { id: 'pay-1' };
      paymentService.recordCashPayment.mockResolvedValue(payment as any);

      const result = await controller.recordCash(dto);

      expect(paymentService.recordCashPayment).toHaveBeenCalledWith(dto);
      expect(result).toBe(payment);
    });
  });

  // ── findForSacco ─────────────────────────────────────────────────────
  describe('findForSacco', () => {
    it('SUPER_ADMIN can scope by an explicit query saccoId', () => {
      const user = { role: UserRole.SUPER_ADMIN, saccoId: undefined };
      controller.findForSacco('sacco-99', {} as any, user);

      expect(paymentService.findBySacco).toHaveBeenCalledWith('sacco-99', {});
    });

    it('SUPER_ADMIN with no query saccoId gets all saccos (undefined)', () => {
      const user = { role: UserRole.SUPER_ADMIN, saccoId: undefined };
      controller.findForSacco(undefined, {} as any, user);

      expect(paymentService.findBySacco).toHaveBeenCalledWith(undefined, {});
    });

    it('non-SUPER_ADMIN is scoped to their own saccoId, ignoring any query saccoId', () => {
      const user = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-5' };
      // Attempting to pass a different sacco via query should have no effect —
      // scoping must come from the JWT-derived user, not client input.
      controller.findForSacco('sacco-other', {} as any, user);

      expect(paymentService.findBySacco).toHaveBeenCalledWith('sacco-5', {});
    });

    it('CLERK is scoped to their own saccoId', () => {
      const user = { role: UserRole.CLERK, saccoId: 'sacco-7' };
      controller.findForSacco(undefined, {} as any, user);

      expect(paymentService.findBySacco).toHaveBeenCalledWith('sacco-7', {});
    });

    it('throws ForbiddenException for a non-SUPER_ADMIN with no assigned sacco', () => {
      const user = { role: UserRole.SACCO_ADMIN, saccoId: undefined };

      expect(() => controller.findForSacco(undefined, {} as any, user)).toThrow(
        ForbiddenException,
      );
      expect(paymentService.findBySacco).not.toHaveBeenCalled();
    });
  });

  // ── findForBooking ───────────────────────────────────────────────────
  describe('findForBooking', () => {
    it('returns the payment when it belongs to the caller\'s sacco', async () => {
      const payment = { id: 'pay-1', saccoId: 'sacco-5' };
      paymentService.findByReference.mockResolvedValue(payment as any);
      const user = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-5' };

      const result = await controller.findForBooking('booking-1', user);

      expect(paymentService.findByReference).toHaveBeenCalledWith(
        PaymentReferenceType.BOOKING,
        'booking-1',
      );
      expect(result).toBe(payment);
    });

    it('SUPER_ADMIN can access a payment regardless of sacco', async () => {
      const payment = { id: 'pay-1', saccoId: 'sacco-5' };
      paymentService.findByReference.mockResolvedValue(payment as any);
      const user = { role: UserRole.SUPER_ADMIN, saccoId: undefined };

      const result = await controller.findForBooking('booking-1', user);

      expect(result).toBe(payment);
    });

    it('throws ForbiddenException when the payment belongs to a different sacco', async () => {
      const payment = { id: 'pay-1', saccoId: 'sacco-5' };
      paymentService.findByReference.mockResolvedValue(payment as any);
      const user = { role: UserRole.CLERK, saccoId: 'sacco-6' };

      await expect(controller.findForBooking('booking-1', user)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when no payment exists for the booking', async () => {
      paymentService.findByReference.mockResolvedValue(null);
      const user = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-5' };

      await expect(controller.findForBooking('booking-404', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('returns the payment when it belongs to the caller\'s sacco', async () => {
      const payment = { id: 'pay-1', saccoId: 'sacco-5' };
      paymentService.findById.mockResolvedValue(payment as any);
      const user = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-5' };

      const result = await controller.findOne('pay-1', user);

      expect(paymentService.findById).toHaveBeenCalledWith('pay-1');
      expect(result).toBe(payment);
    });

    it('SUPER_ADMIN can access any payment', async () => {
      const payment = { id: 'pay-1', saccoId: 'sacco-5' };
      paymentService.findById.mockResolvedValue(payment as any);
      const user = { role: UserRole.SUPER_ADMIN, saccoId: undefined };

      const result = await controller.findOne('pay-1', user);

      expect(result).toBe(payment);
    });

    it('throws ForbiddenException when the payment belongs to a different sacco', async () => {
      const payment = { id: 'pay-1', saccoId: 'sacco-5' };
      paymentService.findById.mockResolvedValue(payment as any);
      const user = { role: UserRole.CLERK, saccoId: 'sacco-6' };

      await expect(controller.findOne('pay-1', user)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Clerk stage scoping ──────────────────────────────────────────────
  describe('clerk stage scoping', () => {
    const clerk = {
      role: UserRole.CLERK,
      saccoId: 'sacco-1',
      assignedStage: 'Kencom',
    };
    const admin = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
    const payment = { id: 'pay-1', saccoId: 'sacco-1' } as any;

    it('passes the clerk\'s stage into the sacco listing', () => {
      controller.findForSacco(undefined, {} as any, clerk);

      expect(paymentService.findBySacco).toHaveBeenCalledWith(
        'sacco-1',
        expect.objectContaining({ assignedStage: 'Kencom' }),
      );
    });

    it('leaves an admin listing unscoped by stage', () => {
      controller.findForSacco(undefined, {} as any, admin);

      expect(paymentService.findBySacco).toHaveBeenCalledWith(
        'sacco-1',
        expect.objectContaining({ assignedStage: undefined }),
      );
    });

    it('lets a clerk open a payment from their own stage', async () => {
      paymentService.findById.mockResolvedValue(payment);
      paymentService.isForStage.mockResolvedValue(true);

      await expect(controller.findOne('pay-1', clerk)).resolves.toBe(payment);
      expect(paymentService.isForStage).toHaveBeenCalledWith(payment, 'Kencom');
    });

    it('blocks a clerk from opening a payment from another stage by id', async () => {
      paymentService.findById.mockResolvedValue(payment);
      paymentService.isForStage.mockResolvedValue(false);

      await expect(controller.findOne('pay-1', clerk)).rejects.toThrow(ForbiddenException);
    });

    it('blocks a clerk reaching another stage\'s payment through its booking', async () => {
      paymentService.findByReference.mockResolvedValue(payment);
      paymentService.isForStage.mockResolvedValue(false);

      await expect(controller.findForBooking('booking-1', clerk)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not run the stage check at all for an admin', async () => {
      paymentService.findById.mockResolvedValue(payment);

      await controller.findOne('pay-1', admin);

      expect(paymentService.isForStage).not.toHaveBeenCalled();
    });
  });
});
