// src/booking/booking.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingStatus } from './entities/booking.entity';
import { UserRole } from 'src/auth/entities/user.entity';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { RolesGuard } from 'src/guards/roles.guard';

describe('BookingController', () => {
  let controller: BookingController;
  let bookingService: jest.Mocked<BookingService>;

  const saccoAdminUser = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
  const superAdminUser = { role: UserRole.SUPER_ADMIN, saccoId: null };
  const clerkUser = { role: UserRole.CLERK, saccoId: 'sacco-1' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [
        {
          provide: BookingService,
          useValue: {
            create: jest.fn(),
            getAvailability: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            cancel: jest.fn(),
            confirmPayment: jest.fn(),
            markPaymentFailed: jest.fn(),
            getUniquePassengerStats: jest.fn(),
            getTodayPassengerStats: jest.fn(),
            getTodayEarnings: jest.fn(),
            getRevenueTrend: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(BookingController);
    bookingService = module.get(BookingService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── public endpoints ─────────────────────────────────────────────────
  describe('create', () => {
    it('delegates straight to bookingService.create', async () => {
      const dto = { passengerName: 'Jane' } as any;
      bookingService.create.mockResolvedValue({ id: 'b1' } as any);

      const result = await controller.create(dto);

      expect(bookingService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'b1' });
    });
  });

  describe('getAvailability', () => {
    it('passes routeId and travelDate through', async () => {
      await controller.getAvailability('route-1', '2026-08-03');

      expect(bookingService.getAvailability).toHaveBeenCalledWith('route-1', '2026-08-03');
    });

    it('allows travelDate to be omitted', async () => {
      await controller.getAvailability('route-1');

      expect(bookingService.getAvailability).toHaveBeenCalledWith('route-1', undefined);
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('scopes to the caller sacco for a SACCO_ADMIN, ignoring nothing from query', async () => {
      await controller.findAll(saccoAdminUser, 'route-1', '2026-08-03', BookingStatus.CONFIRMED, 'trip-1');

      expect(bookingService.findAll).toHaveBeenCalledWith({
        saccoId: 'sacco-1',
        routeId: 'route-1',
        travelDate: '2026-08-03',
        status: BookingStatus.CONFIRMED,
        tripId: 'trip-1',
      });
    });

    it('scopes to the caller sacco for a CLERK too', async () => {
      await controller.findAll(clerkUser);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('leaves saccoId undefined for a SUPER_ADMIN (platform-wide)', async () => {
      await controller.findAll(superAdminUser);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined }),
      );
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('returns the booking when it belongs to the caller sacco', async () => {
      bookingService.findOne.mockResolvedValue({ id: 'b1', saccoId: 'sacco-1' } as any);

      const result = await controller.findOne('b1', saccoAdminUser);

      expect(result).toEqual({ id: 'b1', saccoId: 'sacco-1' });
    });

    it('throws ForbiddenException when the booking belongs to a different sacco', async () => {
      bookingService.findOne.mockResolvedValue({ id: 'b1', saccoId: 'sacco-2' } as any);

      await expect(controller.findOne('b1', saccoAdminUser)).rejects.toThrow(ForbiddenException);
    });

    it('allows a SUPER_ADMIN to view a booking from any sacco', async () => {
      bookingService.findOne.mockResolvedValue({ id: 'b1', saccoId: 'sacco-2' } as any);

      const result = await controller.findOne('b1', superAdminUser);

      expect(result).toEqual({ id: 'b1', saccoId: 'sacco-2' });
    });

    it('throws ForbiddenException for a CLERK viewing another sacco booking', async () => {
      bookingService.findOne.mockResolvedValue({ id: 'b1', saccoId: 'sacco-2' } as any);

      await expect(controller.findOne('b1', clerkUser)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── update ───────────────────────────────────────────────────────────
  describe('update', () => {
    it('scopes update to the caller sacco for a SACCO_ADMIN', async () => {
      const dto = { status: BookingStatus.BOARDED } as any;

      await controller.update('b1', dto, saccoAdminUser);

      expect(bookingService.update).toHaveBeenCalledWith('b1', dto, 'sacco-1');
    });

    it('leaves saccoId undefined for a SUPER_ADMIN', async () => {
      const dto = { status: BookingStatus.BOARDED } as any;

      await controller.update('b1', dto, superAdminUser);

      expect(bookingService.update).toHaveBeenCalledWith('b1', dto, undefined);
    });
  });

  // ── cancel ───────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('scopes cancel to the caller sacco', async () => {
      await controller.cancel('b1', saccoAdminUser);

      expect(bookingService.cancel).toHaveBeenCalledWith('b1', 'sacco-1');
    });

    it('leaves saccoId undefined for a SUPER_ADMIN', async () => {
      await controller.cancel('b1', superAdminUser);

      expect(bookingService.cancel).toHaveBeenCalledWith('b1', undefined);
    });
  });

  // ── confirmPayment / markPaymentFailed (webhook endpoints) ────────────
  describe('confirmPayment', () => {
    const dto = { mpesaReceiptNumber: 'ABC123' } as any;

    it('throws UnauthorizedException when no signature header is present', () => {
      expect(() => controller.confirmPayment('b1', dto, undefined)).toThrow(
        UnauthorizedException,
      );
      expect(bookingService.confirmPayment).not.toHaveBeenCalled();
    });

    it('calls through when a signature header is present', async () => {
      bookingService.confirmPayment.mockResolvedValue({ id: 'b1' } as any);

      await controller.confirmPayment('b1', dto, 'valid-signature');

      expect(bookingService.confirmPayment).toHaveBeenCalledWith('b1', dto);
    });

    it('accepts any non-empty signature value without verifying it (documents the TODO)', async () => {
      bookingService.confirmPayment.mockResolvedValue({ id: 'b1' } as any);

      await controller.confirmPayment('b1', dto, 'totally-fake-signature');

      expect(bookingService.confirmPayment).toHaveBeenCalledWith('b1', dto);
    });
  });

  describe('markPaymentFailed', () => {
    it('throws UnauthorizedException when no signature header is present', () => {
      expect(() => controller.markPaymentFailed('b1', undefined)).toThrow(
        UnauthorizedException,
      );
      expect(bookingService.markPaymentFailed).not.toHaveBeenCalled();
    });

    it('calls through when a signature header is present', async () => {
      await controller.markPaymentFailed('b1', 'valid-signature');

      expect(bookingService.markPaymentFailed).toHaveBeenCalledWith('b1');
    });
  });

  // ── stats endpoints ──────────────────────────────────────────────────
  describe('getUniquePassengerStats', () => {
    it('scopes to caller sacco for SACCO_ADMIN', async () => {
      await controller.getUniquePassengerStats(saccoAdminUser);
      expect(bookingService.getUniquePassengerStats).toHaveBeenCalledWith('sacco-1');
    });

    it('is platform-wide for SUPER_ADMIN', async () => {
      await controller.getUniquePassengerStats(superAdminUser);
      expect(bookingService.getUniquePassengerStats).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getTodayPassengerStats', () => {
    it('forces saccoId to the caller sacco for a SACCO_ADMIN, ignoring any query param', async () => {
      await controller.getTodayPassengerStats('someone-elses-sacco', saccoAdminUser);

      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith('sacco-1');
    });

    it('throws ForbiddenException when a SACCO_ADMIN has no saccoId assigned', () => {
      const unassignedAdmin = { role: UserRole.SACCO_ADMIN, saccoId: null };

      expect(() =>
        controller.getTodayPassengerStats(undefined, unassignedAdmin),
      ).toThrow(ForbiddenException);
    });

    it('respects an explicit saccoId query param for a SUPER_ADMIN', async () => {
      await controller.getTodayPassengerStats('sacco-9', superAdminUser);

      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith('sacco-9');
    });

    it('is platform-wide for a SUPER_ADMIN with no saccoId query param', async () => {
      await controller.getTodayPassengerStats(undefined, superAdminUser);

      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getTodayEarnings', () => {
    it('forces saccoId to the caller sacco for a SACCO_ADMIN, ignoring any query param', async () => {
      await controller.getTodayEarnings('someone-elses-sacco', saccoAdminUser);

      expect(bookingService.getTodayEarnings).toHaveBeenCalledWith('sacco-1');
    });

    it('throws ForbiddenException when a SACCO_ADMIN has no saccoId assigned', () => {
      const unassignedAdmin = { role: UserRole.SACCO_ADMIN, saccoId: null };

      expect(() =>
        controller.getTodayEarnings(undefined, unassignedAdmin),
      ).toThrow(ForbiddenException);
    });

    it('respects the query saccoId for a SUPER_ADMIN', async () => {
      await controller.getTodayEarnings('sacco-9', superAdminUser);

      expect(bookingService.getTodayEarnings).toHaveBeenCalledWith('sacco-9');
    });
  });

  describe('getRevenueTrend', () => {
    it('forces saccoId to the caller sacco for a SACCO_ADMIN regardless of query param', async () => {
      await controller.getRevenueTrend('30', 'someone-elses-sacco', saccoAdminUser);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(30, 'sacco-1');
    });

    it('throws ForbiddenException when a SACCO_ADMIN has no saccoId assigned', () => {
      const unassignedAdmin = { role: UserRole.SACCO_ADMIN, saccoId: null };

      expect(() =>
        controller.getRevenueTrend(undefined, undefined, unassignedAdmin),
      ).toThrow(ForbiddenException);
    });

    it('defaults days to 7 when not provided', async () => {
      await controller.getRevenueTrend(undefined, undefined, saccoAdminUser);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(7, 'sacco-1');
    });

    it('converts the days query string to a number', async () => {
      await controller.getRevenueTrend('14', undefined, saccoAdminUser);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(14, 'sacco-1');
    });

    it('respects an explicit saccoId query param for a SUPER_ADMIN', async () => {
      await controller.getRevenueTrend('7', 'sacco-9', superAdminUser);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(7, 'sacco-9');
    });

    it('is platform-wide for SUPER_ADMIN with no saccoId query param', async () => {
      await controller.getRevenueTrend('7', undefined, superAdminUser);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(7, undefined);
    });
  });
});