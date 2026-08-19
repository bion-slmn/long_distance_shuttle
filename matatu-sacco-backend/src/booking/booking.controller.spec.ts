// src/booking/booking.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { OtpService } from './otp.service';
import { BookingStatus, PaymentStatus } from './entities/booking.entity';
import { UserRole } from '../auth/entities/user.entity';

describe('BookingController', () => {
  let controller: BookingController;
  let bookingService: Partial<Record<keyof BookingService, jest.Mock>>;
  let otpService: Partial<Record<keyof OtpService, jest.Mock>>;
  let jwtService: Partial<Record<keyof JwtService, jest.Mock>>;

  const superAdmin = { role: UserRole.SUPER_ADMIN, saccoId: null };
  const saccoAdmin = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
  const saccoAdminNoSacco = { role: UserRole.SACCO_ADMIN, saccoId: null };
  const clerk = { role: UserRole.CLERK, saccoId: 'sacco-1' };

  const baseBooking = {
    id: 'booking-1',
    saccoId: 'sacco-1',
    status: BookingStatus.CONFIRMED,
    paymentStatus: PaymentStatus.PAID,
    seatNumber: 4,
    mpesaReceiptNumber: 'NLJ7RT61SV',
    passengerName: 'Jane Wanjiru',
    passengerPhone: '0712345678',
    passengerEmail: 'jane@example.com',
  };

  beforeEach(async () => {
    bookingService = {
      create: jest.fn(),
      getAvailability: jest.fn(),
      findAll: jest.fn(),
      getUniquePassengerStats: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      getTodayPassengerStats: jest.fn(),
      confirmPayment: jest.fn(),
      markPaymentFailed: jest.fn(),
      cancel: jest.fn(),
      getTodayEarnings: jest.fn(),
      getRevenueTrend: jest.fn(),
      hasBookingForEmail: jest.fn(),
      findByEmail: jest.fn(),
    };

    otpService = {
      requestCode: jest.fn(),
      verifyCode: jest.fn(),
    };

    jwtService = {
      sign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [
        { provide: BookingService, useValue: bookingService },
        { provide: OtpService, useValue: otpService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    controller = module.get<BookingController>(BookingController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── create (public) ───────────────────────────────────────────────
  describe('create', () => {
    it('delegates the dto directly to bookingService.create', () => {
      const dto = { routeId: 'route-1' };
      bookingService.create!.mockReturnValue({ id: 'booking-1' });

      const result = controller.create(dto as any);

      expect(bookingService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'booking-1' });
    });
  });

  // ─── getAvailability (public) ──────────────────────────────────────
  describe('getAvailability', () => {
    it('passes routeId and optional travelDate through', () => {
      bookingService.getAvailability!.mockReturnValue({ hasOpenTrip: true });

      controller.getAvailability('route-1', '2026-08-17');

      expect(bookingService.getAvailability).toHaveBeenCalledWith('route-1', '2026-08-17');
    });

    it('works with travelDate omitted', () => {
      bookingService.getAvailability!.mockReturnValue({ hasOpenTrip: false });

      controller.getAvailability('route-1', undefined);

      expect(bookingService.getAvailability).toHaveBeenCalledWith('route-1', undefined);
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────
  describe('findAll', () => {
    it('SUPER_ADMIN: uses the provided saccoId query param', () => {
      bookingService.findAll!.mockReturnValue([]);

      controller.findAll(superAdmin, 'sacco-9', 'route-1', '2026-08-17');

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-9', routeId: 'route-1', travelDate: '2026-08-17' }),
      );
    });

    it('SACCO_ADMIN/CLERK: ignores query saccoId, scopes to their own saccoId', () => {
      bookingService.findAll!.mockReturnValue([]);

      controller.findAll(saccoAdmin, 'sacco-other');

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('passes through all optional filters', () => {
      bookingService.findAll!.mockReturnValue([]);

      controller.findAll(
        superAdmin,
        'sacco-1',
        'route-1',
        '2026-08-17',
        '2026-08-01',
        '2026-08-31',
        BookingStatus.CONFIRMED,
        'trip-1',
        'vehicle-1',
      );

      expect(bookingService.findAll).toHaveBeenCalledWith({
        saccoId: 'sacco-1',
        routeId: 'route-1',
        travelDate: '2026-08-17',
        from: '2026-08-01',
        to: '2026-08-31',
        status: BookingStatus.CONFIRMED,
        tripId: 'trip-1',
        vehicleId: 'vehicle-1',
      });
    });
  });

  // ─── getUniquePassengerStats ───────────────────────────────────────
  describe('getUniquePassengerStats', () => {
    it('SUPER_ADMIN: passes undefined saccoId (platform-wide)', () => {
      bookingService.getUniquePassengerStats!.mockReturnValue({});

      controller.getUniquePassengerStats(superAdmin);

      expect(bookingService.getUniquePassengerStats).toHaveBeenCalledWith(undefined);
    });

    it('SACCO_ADMIN: scopes to their own saccoId', () => {
      bookingService.getUniquePassengerStats!.mockReturnValue({});

      controller.getUniquePassengerStats(saccoAdmin);

      expect(bookingService.getUniquePassengerStats).toHaveBeenCalledWith('sacco-1');
    });
  });

  // ─── getStatus (public) ────────────────────────────────────────────
  describe('getStatus', () => {
    it('returns only the slim public-safe shape, not the full booking', async () => {
      bookingService.findOne!.mockResolvedValue(baseBooking);

      const result = await controller.getStatus('booking-1');

      expect(result).toEqual({
        id: baseBooking.id,
        status: baseBooking.status,
        paymentStatus: baseBooking.paymentStatus,
        seatNumber: baseBooking.seatNumber,
        mpesaReceiptNumber: baseBooking.mpesaReceiptNumber,
      });
      // Explicitly must NOT leak passenger PII
      expect(result).not.toHaveProperty('passengerName');
      expect(result).not.toHaveProperty('passengerPhone');
      expect(result).not.toHaveProperty('passengerEmail');
      expect(result).not.toHaveProperty('saccoId');
    });
  });

  // ─── requestCode (public, ticket lookup step 1) ─────────────────────
  describe('requestCode', () => {
    it('throws BadRequestException when email is missing', async () => {
      await expect(controller.requestCode('' as any)).rejects.toThrow(BadRequestException);
      expect(bookingService.hasBookingForEmail).not.toHaveBeenCalled();
    });

    it('sends a code when the email has bookings', async () => {
      bookingService.hasBookingForEmail!.mockResolvedValue(true);
      otpService.requestCode!.mockResolvedValue(undefined);

      const result = await controller.requestCode('jane@example.com');

      expect(bookingService.hasBookingForEmail).toHaveBeenCalledWith('jane@example.com');
      expect(otpService.requestCode).toHaveBeenCalledWith('jane@example.com');
      expect(result).toEqual({ message: 'If that email has bookings, a code has been sent.' });
    });

    it('does NOT send a code when the email has no bookings, but returns the same generic message', async () => {
      bookingService.hasBookingForEmail!.mockResolvedValue(false);

      const result = await controller.requestCode('unknown@example.com');

      expect(otpService.requestCode).not.toHaveBeenCalled();
      // Same response regardless — prevents leaking which emails exist
      expect(result).toEqual({ message: 'If that email has bookings, a code has been sent.' });
    });
  });

  // ─── verifyCode (public, ticket lookup step 2) ──────────────────────
  describe('verifyCode', () => {
    it('throws UnauthorizedException when the code is invalid', async () => {
      otpService.verifyCode!.mockResolvedValue(false);

      await expect(
        controller.verifyCode({ email: 'jane@example.com', code: '000000' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('issues a short-lived, ticket-scoped token on success', async () => {
      otpService.verifyCode!.mockResolvedValue(true);
      jwtService.sign!.mockReturnValue('signed.jwt.token');

      const result = await controller.verifyCode({ email: 'Jane@Example.com', code: '123456' });

      expect(otpService.verifyCode).toHaveBeenCalledWith('Jane@Example.com', '123456');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { email: 'jane@example.com', scope: 'tickets' },
        { expiresIn: '30m' },
      );
      expect(result).toEqual({ access_token: 'signed.jwt.token' });
    });
  });

  // ─── getMyTickets (guarded by TicketsAuthGuard) ─────────────────────
  describe('getMyTickets', () => {
    it('returns bookings for the email extracted from the ticket token', async () => {
      bookingService.findByEmail!.mockResolvedValue([baseBooking]);

      const result = await controller.getMyTickets('jane@example.com');

      expect(bookingService.findByEmail).toHaveBeenCalledWith('jane@example.com');
      expect(result).toEqual([baseBooking]);
    });

    it('returns an empty array when the email has no bookings', async () => {
      bookingService.findByEmail!.mockResolvedValue([]);

      const result = await controller.getMyTickets('nobody@example.com');

      expect(result).toEqual([]);
    });
  });

  // ─── findOne (staff) ───────────────────────────────────────────────
  describe('findOne', () => {
    it('returns the booking for SUPER_ADMIN regardless of sacco', async () => {
      bookingService.findOne!.mockResolvedValue(baseBooking);

      const result = await controller.findOne('booking-1', superAdmin);

      expect(result).toEqual(baseBooking);
    });

    it('returns the booking when SACCO_ADMIN owns it', async () => {
      bookingService.findOne!.mockResolvedValue(baseBooking);

      const result = await controller.findOne('booking-1', saccoAdmin);

      expect(result).toEqual(baseBooking);
    });

    it('throws ForbiddenException when a different sacco requests it', async () => {
      bookingService.findOne!.mockResolvedValue(baseBooking);

      await expect(
        controller.findOne('booking-1', { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-2' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('propagates NotFoundException from the service', async () => {
      bookingService.findOne!.mockRejectedValue(new Error('not found'));

      await expect(controller.findOne('missing', superAdmin)).rejects.toThrow();
    });
  });

  // ─── update ────────────────────────────────────────────────────────
  describe('update', () => {
    it('SUPER_ADMIN: passes undefined saccoId (no scoping)', () => {
      bookingService.update!.mockReturnValue(baseBooking);

      controller.update('booking-1', { status: BookingStatus.BOARDED } as any, superAdmin);

      expect(bookingService.update).toHaveBeenCalledWith(
        'booking-1',
        { status: BookingStatus.BOARDED },
        undefined,
      );
    });

    it('SACCO_ADMIN/CLERK: scopes update to their own saccoId', () => {
      bookingService.update!.mockReturnValue(baseBooking);

      controller.update('booking-1', { status: BookingStatus.BOARDED } as any, clerk);

      expect(bookingService.update).toHaveBeenCalledWith(
        'booking-1',
        { status: BookingStatus.BOARDED },
        'sacco-1',
      );
    });
  });

  // ─── getTodayPassengerStats ────────────────────────────────────────
  describe('getTodayPassengerStats', () => {
    it('SUPER_ADMIN: uses provided saccoId query param (may be undefined)', () => {
      bookingService.getTodayPassengerStats!.mockReturnValue({});

      controller.getTodayPassengerStats('sacco-9', superAdmin);

      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith('sacco-9');
    });

    it('SACCO_ADMIN: overrides query param with their own saccoId', () => {
      bookingService.getTodayPassengerStats!.mockReturnValue({});

      controller.getTodayPassengerStats('sacco-other', saccoAdmin);

      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith('sacco-1');
    });

    it('SACCO_ADMIN with no assigned sacco: throws ForbiddenException', () => {
      expect(() => controller.getTodayPassengerStats(undefined, saccoAdminNoSacco)).toThrow(
        ForbiddenException,
      );
      expect(bookingService.getTodayPassengerStats).not.toHaveBeenCalled();
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('SUPER_ADMIN: passes undefined saccoId', () => {
      bookingService.cancel!.mockReturnValue({ ...baseBooking, status: BookingStatus.CANCELLED });

      controller.cancel('booking-1', superAdmin);

      expect(bookingService.cancel).toHaveBeenCalledWith('booking-1', undefined);
    });

    it('SACCO_ADMIN/CLERK: scopes to their own saccoId', () => {
      bookingService.cancel!.mockReturnValue({ ...baseBooking, status: BookingStatus.CANCELLED });

      controller.cancel('booking-1', clerk);

      expect(bookingService.cancel).toHaveBeenCalledWith('booking-1', 'sacco-1');
    });
  });

  // ─── getTodayEarnings ──────────────────────────────────────────────
  describe('getTodayEarnings', () => {
    it('SUPER_ADMIN: uses provided saccoId query param', () => {
      bookingService.getTodayEarnings!.mockReturnValue({});

      controller.getTodayEarnings('sacco-9', superAdmin);

      expect(bookingService.getTodayEarnings).toHaveBeenCalledWith('sacco-9');
    });

    it('SACCO_ADMIN: overrides with own saccoId', () => {
      bookingService.getTodayEarnings!.mockReturnValue({});

      controller.getTodayEarnings(undefined, saccoAdmin);

      expect(bookingService.getTodayEarnings).toHaveBeenCalledWith('sacco-1');
    });

    it('SACCO_ADMIN with no sacco: throws ForbiddenException', () => {
      expect(() => controller.getTodayEarnings(undefined, saccoAdminNoSacco)).toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── getRevenueTrend ───────────────────────────────────────────────
  describe('getRevenueTrend', () => {
    it('defaults days to 7 when not provided', () => {
      bookingService.getRevenueTrend!.mockReturnValue([]);

      controller.getRevenueTrend(undefined, undefined, superAdmin);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(7, undefined);
    });

    it('converts the days query string to a number', () => {
      bookingService.getRevenueTrend!.mockReturnValue([]);

      controller.getRevenueTrend('14', 'sacco-9', superAdmin);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(14, 'sacco-9');
    });

    it('SACCO_ADMIN: overrides saccoId with their own', () => {
      bookingService.getRevenueTrend!.mockReturnValue([]);

      controller.getRevenueTrend('30', 'sacco-other', saccoAdmin);

      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(30, 'sacco-1');
    });

    it('SACCO_ADMIN with no sacco: throws ForbiddenException', () => {
      expect(() => controller.getRevenueTrend('7', undefined, saccoAdminNoSacco)).toThrow(
        ForbiddenException,
      );
    });
  });
});