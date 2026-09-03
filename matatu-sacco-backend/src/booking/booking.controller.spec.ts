import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { OtpService } from './otp.service';
import { JwtService } from '@nestjs/jwt';
import { BookingSource, BookingStatus, PaymentStatus } from './entities/booking.entity';
import { UserRole } from 'src/auth/entities/user.entity';

describe('BookingController', () => {
  let controller: BookingController;
  let bookingService: jest.Mocked<Partial<BookingService>>;
  let otpService: jest.Mocked<Partial<OtpService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;

  const SACCO_A = 'sacco-a';
  const SACCO_B = 'sacco-b';

  const superAdmin = { id: 'user-1', sub: 'user-1', role: UserRole.SUPER_ADMIN, saccoId: null };
  const saccoAdmin = { id: 'user-2', sub: 'user-2', role: UserRole.SACCO_ADMIN, saccoId: SACCO_A };
  // Clerks are pinned to one stage — a stage is a route's origin.
  const CLERK_STAGE = 'Kencom';
  const clerk = { id: 'user-3', sub: 'user-3', role: UserRole.CLERK, saccoId: SACCO_A, assignedStage: CLERK_STAGE };

  beforeEach(async () => {
    bookingService = {
      create: jest.fn().mockResolvedValue({ id: 'booking-1' }),
      getAvailability: jest.fn().mockResolvedValue({ routeId: 'route-1' }),
      findAll: jest.fn().mockResolvedValue([]),
      getUniquePassengerStats: jest.fn().mockResolvedValue({ thisWeekUnique: 5 }),
      findOne: jest.fn(),
      assertStageAccess: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'booking-1', status: BookingStatus.BOARDED }),
      cancel: jest.fn().mockResolvedValue({ id: 'booking-1', status: BookingStatus.CANCELLED }),
      hasBookingForEmail: jest.fn(),
      findByEmail: jest.fn().mockResolvedValue([{ id: 'booking-1' }]),
      getTodayPassengerStats: jest.fn().mockResolvedValue({ today: 10 }),
      getTodayEarnings: jest.fn().mockResolvedValue({ grossRevenue: 1000 }),
      getRevenueTrend: jest.fn().mockResolvedValue([{ date: '2026-08-20', revenue: 500 }]),
    };

    otpService = {
      requestCode: jest.fn().mockResolvedValue(undefined),
      verifyCode: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
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

  // ── POST /bookings — public portal ───────────────────────────────────────
  describe('create (public)', () => {
    it('always tags the booking as PUBLIC_PORTAL, regardless of what the caller sends', () => {
      const dto = { routeId: 'route-1' };

      controller.create(dto as any);

      expect(bookingService.create).toHaveBeenCalledWith(dto, BookingSource.PUBLIC_PORTAL);
    });

    it('never lets the request body inject createdByUserId or source', () => {
      // CreateBookingDto has no `source` field, so nothing in the body can
      // reach past this — this test locks in that createdByUserId isn't
      // silently forwarded either on the public route.
      const dto = { routeId: 'route-1', createdByUserId: 'someone-elses-id' };

      controller.create(dto as any);

      expect(bookingService.create).toHaveBeenCalledWith(dto, BookingSource.PUBLIC_PORTAL);
      // Specifically: the second positional arg is always PUBLIC_PORTAL,
      // never derived from anything in the body.
      const [, sourceArg] = (bookingService.create as jest.Mock).mock.calls[0];
      expect(sourceArg).toBe(BookingSource.PUBLIC_PORTAL);
    });

    it('returns whatever bookingService.create resolves', async () => {
      const result = await controller.create({ routeId: 'route-1' } as any);
      expect(result).toEqual({ id: 'booking-1' });
    });
  });

  // ── POST /bookings/clerk — staff booking creation ────────────────────────
  describe('createByClerk', () => {
    it('SECURITY: a super admin books unscoped', () => {
      controller.createByClerk({ routeId: 'route-1' } as any, superAdmin);

      expect(bookingService.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdByUserId: 'user-1' }),
        BookingSource.CLERK,
        undefined,
      );
    });

    it('SECURITY: refuses staff with no sacco', () => {
      expect(() =>
        controller.createByClerk({ routeId: 'route-1' } as any, { sub: 'x', role: UserRole.CLERK, saccoId: null }),
      ).toThrow(ForbiddenException);
    });

    it('tags the booking CLERK and stamps createdByUserId from the authenticated user', () => {
      const dto = { routeId: 'route-1', passengerName: 'Jane' };

      controller.createByClerk(dto as any, clerk);

      expect(bookingService.create).toHaveBeenCalledWith(
        { ...dto, createdByUserId: clerk.sub },
        BookingSource.CLERK,
        SACCO_A,
      );
    });

    it('overwrites any createdByUserId already present in the body with the real caller', () => {
      const dto = { routeId: 'route-1', createdByUserId: 'spoofed-id' };

      controller.createByClerk(dto as any, clerk);

      expect(bookingService.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdByUserId: clerk.sub }),
        BookingSource.CLERK,
        SACCO_A,
      );
    });
  });

  // ── GET /bookings/availability — public ──────────────────────────────────
  describe('getAvailability', () => {
    it('forwards routeId and travelDate straight through', () => {
      controller.getAvailability('route-1', '2026-08-25');
      expect(bookingService.getAvailability).toHaveBeenCalledWith('route-1', '2026-08-25');
    });

    it('works with travelDate omitted', () => {
      controller.getAvailability('route-1', undefined);
      expect(bookingService.getAvailability).toHaveBeenCalledWith('route-1', undefined);
    });
  });

  // ── GET /bookings — staff list, sacco-scoped ─────────────────────────────
  describe('findAll — stage scoping', () => {
    it('narrows a clerk to their assigned stage', () => {
      controller.findAll(clerk);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: SACCO_A, assignedStage: CLERK_STAGE }),
      );
    });

    it('leaves a sacco admin unscoped by stage', () => {
      controller.findAll(saccoAdmin);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: SACCO_A, assignedStage: undefined }),
      );
    });

    it('leaves a super admin unscoped by stage', () => {
      controller.findAll(superAdmin, SACCO_B);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: SACCO_B, assignedStage: undefined }),
      );
    });

    it('applies the stage guard when a clerk opens a booking by id', async () => {
      bookingService.findOne.mockResolvedValue({ id: 'booking-1', saccoId: SACCO_A });

      await controller.findOne('booking-1', clerk);

      expect(bookingService.assertStageAccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'booking-1' }),
        CLERK_STAGE,
      );
    });
  });

  describe('findAll — sacco scoping', () => {
    it('lets a super admin filter by any saccoId query param', () => {
      controller.findAll(superAdmin, SACCO_B, 'route-1');

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: SACCO_B, routeId: 'route-1' }),
      );
    });

    it('lets a super admin see all saccos when no saccoId param is given', () => {
      controller.findAll(superAdmin, undefined);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined }),
      );
    });

    it('SECURITY: ignores a non-super-admin caller\'s saccoId query param and forces their own', () => {
      // sacco_admin from SACCO_A tries to peek at SACCO_B via the query
      // string — this must be silently overridden, not honored.
      controller.findAll(saccoAdmin, SACCO_B);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: SACCO_A }),
      );
    });

    it('SECURITY: same enforcement for a clerk', () => {
      controller.findAll(clerk, SACCO_B);

      expect(bookingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: SACCO_A }),
      );
    });

    it('passes all remaining filters through untouched', () => {
      controller.findAll(
        superAdmin,
        SACCO_A,
        'route-1',
        '2026-08-25',
        '2026-08-20',
        '2026-08-25',
        BookingStatus.CONFIRMED,
        'trip-1',
        'vehicle-1',
      );

      expect(bookingService.findAll).toHaveBeenCalledWith({
        saccoId: SACCO_A,
        routeId: 'route-1',
        travelDate: '2026-08-25',
        from: '2026-08-20',
        to: '2026-08-25',
        status: BookingStatus.CONFIRMED,
        tripId: 'trip-1',
        vehicleId: 'vehicle-1',
      });
    });
  });

  // ── GET /bookings/stats/unique-passengers ────────────────────────────────
  describe('getUniquePassengerStats — sacco scoping', () => {
    it('passes undefined (platform-wide) for a super admin', () => {
      controller.getUniquePassengerStats(superAdmin);
      expect(bookingService.getUniquePassengerStats).toHaveBeenCalledWith(undefined);
    });

    it('scopes to the caller\'s own saccoId for a sacco admin', () => {
      controller.getUniquePassengerStats(saccoAdmin);
      expect(bookingService.getUniquePassengerStats).toHaveBeenCalledWith(SACCO_A);
    });
  });

  // ── GET /bookings/:id/status — public polling endpoint ───────────────────
  describe('getStatus', () => {
    it('returns ONLY the allowlisted fields, never the full booking record', async () => {
      bookingService.findOne = jest.fn().mockResolvedValue({
        id: 'booking-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        seatNumber: 7,
        mpesaReceiptNumber: 'ABC123',
        // sensitive / irrelevant-to-the-client fields that must NOT leak:
        passengerName: 'Jane Doe',
        passengerPhone: '254700000000',
        passengerEmail: 'jane@example.com',
        fare: 500,
        saccoId: SACCO_A,
      });

      const result = await controller.getStatus('booking-1');

      expect(result).toEqual({
        id: 'booking-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        seatNumber: 7,
        mpesaReceiptNumber: 'ABC123',
      });
      expect(result).not.toHaveProperty('passengerPhone');
      expect(result).not.toHaveProperty('passengerEmail');
      expect(result).not.toHaveProperty('fare');
    });

    it('propagates NotFoundException from the service for an unknown id', async () => {
      const err = new Error('not found');
      bookingService.findOne = jest.fn().mockRejectedValue(err);

      await expect(controller.getStatus('nope')).rejects.toThrow(err);
    });
  });

  // ── POST /bookings/tickets/request-code ──────────────────────────────────
  describe('requestCode', () => {
    it('rejects with BadRequestException when email is missing', async () => {
      await expect(controller.requestCode(undefined as any)).rejects.toThrow(BadRequestException);
      await expect(controller.requestCode('' as any)).rejects.toThrow(BadRequestException);
    });

    it('sends a code when the email has bookings', async () => {
      bookingService.hasBookingForEmail = jest.fn().mockResolvedValue(true);

      await controller.requestCode('jane@example.com');

      expect(otpService.requestCode).toHaveBeenCalledWith('jane@example.com');
    });

    it('does NOT send a code when the email has no bookings', async () => {
      bookingService.hasBookingForEmail = jest.fn().mockResolvedValue(false);

      await controller.requestCode('nobody@example.com');

      expect(otpService.requestCode).not.toHaveBeenCalled();
    });

    it('SECURITY: returns the identical generic message whether or not the email has bookings', async () => {
      bookingService.hasBookingForEmail = jest.fn().mockResolvedValue(true);
      const withBookings = await controller.requestCode('jane@example.com');

      bookingService.hasBookingForEmail = jest.fn().mockResolvedValue(false);
      const withoutBookings = await controller.requestCode('nobody@example.com');

      // Response must not leak whether the email exists in the system —
      // an attacker probing emails should learn nothing from the response
      // shape or content.
      expect(withBookings).toEqual(withoutBookings);
      expect(withBookings).toEqual({ message: 'If that email has bookings, a code has been sent.' });
    });
  });

  // ── POST /bookings/tickets/verify-code ───────────────────────────────────
  describe('verifyCode', () => {
    it('issues a short-lived, email-scoped access token on a valid code', async () => {
      otpService.verifyCode = jest.fn().mockResolvedValue(true);

      const result = await controller.verifyCode({ email: 'Jane@Example.com', code: '123456' });

      expect(otpService.verifyCode).toHaveBeenCalledWith('Jane@Example.com', '123456');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { email: 'jane@example.com', scope: 'tickets' },
        { expiresIn: '30m' },
      );
      expect(result).toEqual({ access_token: 'signed.jwt.token' });
    });

    it('normalizes the email into the token claim (trimmed, lowercased) regardless of input casing/whitespace', async () => {
      otpService.verifyCode = jest.fn().mockResolvedValue(true);

      await controller.verifyCode({ email: '  Jane@EXAMPLE.com  ', code: '123456' });

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jane@example.com' }),
        expect.anything(),
      );
    });

    it('rejects with UnauthorizedException on an invalid or expired code', async () => {
      otpService.verifyCode = jest.fn().mockResolvedValue(false);

      await expect(
        controller.verifyCode({ email: 'jane@example.com', code: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });

  // ── GET /bookings/tickets/my-tickets ─────────────────────────────────────
  describe('getMyTickets', () => {
    it('looks up bookings by the email carried on the ticket-scoped token', async () => {
      const result = await controller.getMyTickets('jane@example.com');

      expect(bookingService.findByEmail).toHaveBeenCalledWith('jane@example.com');
      expect(result).toEqual([{ id: 'booking-1' }]);
    });
  });

  // ── GET /bookings/:id — staff, cross-sacco access control ────────────────
  describe('findOne — access control', () => {
    it('lets a super admin view a booking from any sacco', async () => {
      bookingService.findOne = jest.fn().mockResolvedValue({ id: 'booking-1', saccoId: SACCO_B });

      const result = await controller.findOne('booking-1', superAdmin);

      expect(result).toEqual({ id: 'booking-1', saccoId: SACCO_B });
    });

    it('lets a sacco admin view a booking that belongs to their own sacco', async () => {
      bookingService.findOne = jest.fn().mockResolvedValue({ id: 'booking-1', saccoId: SACCO_A });

      const result = await controller.findOne('booking-1', saccoAdmin);

      expect(result).toEqual({ id: 'booking-1', saccoId: SACCO_A });
    });

    it('SECURITY: rejects a sacco admin viewing a booking from a different sacco', async () => {
      bookingService.findOne = jest.fn().mockResolvedValue({ id: 'booking-1', saccoId: SACCO_B });

      await expect(controller.findOne('booking-1', saccoAdmin)).rejects.toThrow(ForbiddenException);
    });

    it('SECURITY: rejects a clerk viewing a booking from a different sacco', async () => {
      bookingService.findOne = jest.fn().mockResolvedValue({ id: 'booking-1', saccoId: SACCO_B });

      await expect(controller.findOne('booking-1', clerk)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── PATCH /bookings/:id ───────────────────────────────────────────────────
  describe('update — sacco scoping', () => {
    it('passes saccoId = undefined for a super admin (service applies no extra scoping)', () => {
      controller.update('booking-1', { status: BookingStatus.BOARDED } as any, superAdmin);

      expect(bookingService.update).toHaveBeenCalledWith(
        'booking-1',
        { status: BookingStatus.BOARDED },
        undefined,
        undefined,
      );
    });

    it('scopes the update to the caller\'s own saccoId for a sacco admin', () => {
      controller.update('booking-1', { status: BookingStatus.BOARDED } as any, saccoAdmin);

      expect(bookingService.update).toHaveBeenCalledWith(
        'booking-1',
        { status: BookingStatus.BOARDED },
        SACCO_A,
        undefined,
      );
    });

    it('scopes the update to the caller\'s sacco AND assigned stage for a clerk', () => {
      controller.update('booking-1', { status: BookingStatus.BOARDED } as any, clerk);

      expect(bookingService.update).toHaveBeenCalledWith(
        'booking-1',
        { status: BookingStatus.BOARDED },
        SACCO_A,
        CLERK_STAGE,
      );
    });
  });

  // ── DELETE /bookings/:id ──────────────────────────────────────────────────
  describe('cancel — sacco scoping', () => {
    it('passes saccoId = undefined for a super admin', () => {
      controller.cancel('booking-1', superAdmin);
      expect(bookingService.cancel).toHaveBeenCalledWith('booking-1', undefined, undefined);
    });

    it('scopes cancellation to the caller\'s own saccoId for a sacco admin', () => {
      controller.cancel('booking-1', saccoAdmin);
      expect(bookingService.cancel).toHaveBeenCalledWith('booking-1', SACCO_A, undefined);
    });
  });

  // ── GET /bookings/stats/today-passengers ─────────────────────────────────
  describe('getTodayPassengerStats — sacco scoping', () => {
    it('lets a super admin pass any saccoId query param through, including none', () => {
      controller.getTodayPassengerStats(SACCO_B, superAdmin);
      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith(SACCO_B);

      controller.getTodayPassengerStats(undefined, superAdmin);
      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith(undefined);
    });

    it('SECURITY: forces a sacco admin\'s own saccoId, ignoring a mismatched query param', () => {
      controller.getTodayPassengerStats(SACCO_B, saccoAdmin);
      expect(bookingService.getTodayPassengerStats).toHaveBeenCalledWith(SACCO_A);
    });

    it('throws ForbiddenException if a sacco admin has no saccoId assigned', () => {
      const orphanAdmin = { id: 'user-4', role: UserRole.SACCO_ADMIN, saccoId: null };

      expect(() => controller.getTodayPassengerStats(undefined, orphanAdmin)).toThrow(
        ForbiddenException,
      );
      expect(bookingService.getTodayPassengerStats).not.toHaveBeenCalled();
    });
  });

  // ── GET /bookings/earnings/today ─────────────────────────────────────────
  describe('getTodayEarnings — sacco scoping', () => {
    it('lets a super admin pass any saccoId query param through', () => {
      controller.getTodayEarnings(SACCO_B, superAdmin);
      expect(bookingService.getTodayEarnings).toHaveBeenCalledWith(SACCO_B);
    });

    it('SECURITY: forces a sacco admin\'s own saccoId, ignoring a mismatched query param', () => {
      controller.getTodayEarnings(SACCO_B, saccoAdmin);
      expect(bookingService.getTodayEarnings).toHaveBeenCalledWith(SACCO_A);
    });

    it('throws ForbiddenException if a sacco admin has no saccoId assigned', () => {
      const orphanAdmin = { id: 'user-4', role: UserRole.SACCO_ADMIN, saccoId: null };

      expect(() => controller.getTodayEarnings(undefined, orphanAdmin)).toThrow(ForbiddenException);
      expect(bookingService.getTodayEarnings).not.toHaveBeenCalled();
    });
  });

  // ── GET /bookings/earnings/trend ─────────────────────────────────────────
  describe('getRevenueTrend — days parsing and sacco scoping', () => {
    it('defaults to 7 days when no days query param is given', () => {
      controller.getRevenueTrend(undefined, SACCO_A, superAdmin);
      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(7, SACCO_A);
    });

    it('parses a numeric days query param', () => {
      controller.getRevenueTrend('30', SACCO_A, superAdmin);
      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(30, SACCO_A);
    });

    it('lets a super admin pass any saccoId query param through', () => {
      controller.getRevenueTrend('14', SACCO_B, superAdmin);
      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(14, SACCO_B);
    });

    it('SECURITY: forces a sacco admin\'s own saccoId, ignoring a mismatched query param', () => {
      controller.getRevenueTrend('14', SACCO_B, saccoAdmin);
      expect(bookingService.getRevenueTrend).toHaveBeenCalledWith(14, SACCO_A);
    });

    it('throws ForbiddenException if a sacco admin has no saccoId assigned', () => {
      const orphanAdmin = { id: 'user-4', role: UserRole.SACCO_ADMIN, saccoId: null };

      expect(() => controller.getRevenueTrend('7', undefined, orphanAdmin)).toThrow(
        ForbiddenException,
      );
      expect(bookingService.getRevenueTrend).not.toHaveBeenCalled();
    });
  });
});