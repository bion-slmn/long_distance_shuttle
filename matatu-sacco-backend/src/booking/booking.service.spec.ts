// src/booking/booking.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { Booking, BookingStatus, PaymentStatus } from './entities/booking.entity';
import { Trip, TripStatus } from '../trip/entities/trip.entity';
import { Route } from '../route/entities/route.entity';

describe('BookingService', () => {
  let service: BookingService;
  let bookingRepo: any;
  let tripRepo: any;
  let routeRepo: any;
  let manager: any;
  let qb: any;

  beforeEach(async () => {
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(undefined),
    };

    manager = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (_entity, data) => data),
    };

    bookingRepo = {
      manager: { transaction: jest.fn(async (cb) => cb(manager)) },
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn(),
      save: jest.fn(async (data: any) => data),
    };

    tripRepo = {
      findOne: jest.fn(),
    };

    routeRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        { provide: getRepositoryToken(Trip), useValue: tripRepo },
        { provide: getRepositoryToken(Route), useValue: routeRepo },
      ],
    }).compile();

    service = module.get(BookingService);
  });

  afterEach(() => jest.clearAllMocks());

  const activeRoute = { id: 'route-1', saccoId: 'sacco-1', fare: 500 };

  // ── create ────────────────────────────────────────────────────────────
  describe('create', () => {
    const dto = {
      routeId: 'route-1',
      passengerName: 'Jane',
      passengerPhone: '0700000000',
      paymentMethod: 'CASH',
    } as any;

    it('throws NotFoundException when the route does not exist', async () => {
      routeRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('slots into an open BOARDING trip with free capacity', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      qb.getOne.mockResolvedValue({ id: 'trip-1', vehicleCapacity: 14 });
      qb.getCount.mockResolvedValue(3); // seatedCount

      const result = await service.create(dto);

      expect(result.status).toBe(BookingStatus.CONFIRMED);
      expect(result.tripId).toBe('trip-1');
      expect(result.seatNumber).toBe(4);
      expect(result.saccoId).toBe('sacco-1');
    });

    it('falls back to AWAITING_TRIP when the open trip is full', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      qb.getOne.mockResolvedValue({ id: 'trip-1', vehicleCapacity: 14 });
      qb.getCount.mockResolvedValue(14); // full

      const result = await service.create(dto);

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
      expect(result.tripId).toBeNull();
      expect(result.seatNumber).toBeNull();
    });

    it('falls back to AWAITING_TRIP when there is no open trip at all', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      qb.getOne.mockResolvedValue(undefined);

      const result = await service.create(dto);

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });

    it('uses the dto travelDate when provided, else defaults to today', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      qb.getOne.mockResolvedValue(undefined);

      const result = await service.create({ ...dto, travelDate: '2026-08-10' });

      expect(result.travelDate).toBe('2026-08-10');
    });

    it('marks paymentStatus as PAID regardless of payment method (MVP behavior)', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      qb.getOne.mockResolvedValue(undefined);

      const result = await service.create({ ...dto, paymentMethod: 'MPESA' });

      expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    });
  });

  // ── assignPendingBookingsToTrip ─────────────────────────────────────────
  describe('assignPendingBookingsToTrip', () => {
    const trip = { id: 'trip-1', routeId: 'route-1', travelDate: '2026-08-03', vehicleCapacity: 5 } as any;

    it('returns early when the trip is already at capacity', async () => {
      qb.getCount.mockResolvedValue(5); // alreadySeated === capacity

      await service.assignPendingBookingsToTrip(trip, manager);

      expect(manager.createQueryBuilder).toHaveBeenCalledTimes(1); // only the seated-count query
    });

    it('assigns pending bookings FIFO up to remaining capacity', async () => {
      qb.getCount.mockResolvedValue(3); // 3 already seated, 2 seats left
      const pending = [
        { id: 'b1' },
        { id: 'b2' },
        { id: 'b3' }, // should NOT be assigned — capacity reached after b1/b2
      ] as any[];
      qb.getMany.mockResolvedValue(pending);

      await service.assignPendingBookingsToTrip(trip, manager);

      expect(pending[0].status).toBe(BookingStatus.CONFIRMED);
      expect(pending[0].seatNumber).toBe(4);
      expect(pending[1].status).toBe(BookingStatus.CONFIRMED);
      expect(pending[1].seatNumber).toBe(5);
      expect(pending[2].status).toBeUndefined(); // untouched — stays AWAITING_TRIP
      expect(manager.save).toHaveBeenCalledTimes(2);
    });

    it('assigns nothing when there are no pending bookings', async () => {
      qb.getCount.mockResolvedValue(0);
      qb.getMany.mockResolvedValue([]);

      await service.assignPendingBookingsToTrip(trip, manager);

      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  // ── confirmPayment / markPaymentFailed ──────────────────────────────────
  describe('confirmPayment', () => {
    it('marks the booking PAID and stores the mpesa receipt when provided', async () => {
      bookingRepo.findOne.mockResolvedValue({ id: 'b1', paymentStatus: PaymentStatus.PENDING } as any);

      const result = await service.confirmPayment('b1', { mpesaReceiptNumber: 'ABC123' });

      expect(result.paymentStatus).toBe(PaymentStatus.PAID);
      expect(result.mpesaReceiptNumber).toBe('ABC123');
    });

    it('throws NotFoundException for a missing booking', async () => {
      bookingRepo.findOne.mockResolvedValue(null);

      await expect(service.confirmPayment('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('markPaymentFailed', () => {
    it('sets paymentStatus to FAILED', async () => {
      bookingRepo.findOne.mockResolvedValue({ id: 'b1', paymentStatus: PaymentStatus.PENDING } as any);

      const result = await service.markPaymentFailed('b1');

      expect(result.paymentStatus).toBe(PaymentStatus.FAILED);
    });
  });

  // ── findOne / findAll ────────────────────────────────────────────────────
  describe('findOne', () => {
    it('returns the booking when found', async () => {
      const booking = { id: 'b1' };
      bookingRepo.findOne.mockResolvedValue(booking);

      await expect(service.findOne('b1')).resolves.toEqual(booking);
    });

    it('throws NotFoundException when not found', async () => {
      bookingRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('applies all provided filters', async () => {
      await service.findAll({
        saccoId: 'sacco-1',
        routeId: 'route-1',
        travelDate: '2026-08-03',
        status: BookingStatus.CONFIRMED,
        tripId: 'trip-1',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('b.saccoId = :saccoId', { saccoId: 'sacco-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.routeId = :routeId', { routeId: 'route-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.travelDate = :travelDate', { travelDate: '2026-08-03' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.status = :status', { status: BookingStatus.CONFIRMED });
      expect(qb.andWhere).toHaveBeenCalledWith('b.tripId = :tripId', { tripId: 'trip-1' });
    });

    it('applies no filters when none are provided', async () => {
      await service.findAll();

      expect(qb.andWhere).not.toHaveBeenCalled();
    });
  });

  // ── update ────────────────────────────────────────────────────────────
  describe('update', () => {
    it('throws ForbiddenException on cross-sacco access', async () => {
      bookingRepo.findOne.mockResolvedValue({ id: 'b1', saccoId: 'sacco-1' } as any);

      await expect(
        service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when boarding a booking that is not CONFIRMED', async () => {
      bookingRepo.findOne.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.AWAITING_TRIP,
        paymentStatus: PaymentStatus.PAID,
      } as any);

      await expect(
        service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when boarding an unpaid booking', async () => {
      bookingRepo.findOne.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      } as any);

      await expect(
        service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('boards a CONFIRMED, PAID booking successfully', async () => {
      bookingRepo.findOne.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        seatNumber: 4,
        tripId: 'trip-1',
      } as any);

      const result = await service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-1');

      expect(result.status).toBe(BookingStatus.BOARDED);
    });

    it('allows a super admin (no saccoId) to update across saccos', async () => {
      bookingRepo.findOne.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      } as any);

      const result = await service.update('b1', { status: BookingStatus.BOARDED } as any, undefined);

      expect(result.status).toBe(BookingStatus.BOARDED);
    });
  });

  // ── cancel ────────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('throws ForbiddenException on cross-sacco access', async () => {
      bookingRepo.findOne.mockResolvedValue({ id: 'b1', saccoId: 'sacco-1', status: BookingStatus.CONFIRMED } as any);

      await expect(service.cancel('b1', 'sacco-2')).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the booking already boarded', async () => {
      bookingRepo.findOne.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.BOARDED,
      } as any);

      await expect(service.cancel('b1', 'sacco-1')).rejects.toThrow(BadRequestException);
    });

    it('cancels and refunds a PAID booking', async () => {
      bookingRepo.findOne.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      } as any);

      const result = await service.cancel('b1', 'sacco-1');

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.paymentStatus).toBe(PaymentStatus.REFUNDED);
    });

    it('cancels without refunding when payment was not PAID', async () => {
      bookingRepo.findOne.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.AWAITING_TRIP,
        paymentStatus: PaymentStatus.FAILED,
      } as any);

      const result = await service.cancel('b1', 'sacco-1');

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.paymentStatus).toBe(PaymentStatus.FAILED);
    });
  });

  // ── getAvailability ──────────────────────────────────────────────────────
  describe('getAvailability', () => {
    it('throws NotFoundException for an unknown route', async () => {
      routeRepo.findOne.mockResolvedValue(null);

      await expect(service.getAvailability('missing-route')).rejects.toThrow(NotFoundException);
    });

    it('reports full availability details when a trip is open', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      tripRepo.findOne.mockResolvedValue({ id: 'trip-1', vehicleCapacity: 14 });
      qb.getCount
        .mockResolvedValueOnce(5)  // seatedCount
        .mockResolvedValueOnce(2); // awaitingCount

      const result = await service.getAvailability('route-1', '2026-08-03');

      expect(result).toEqual({
        routeId: 'route-1',
        travelDate: '2026-08-03',
        hasOpenTrip: true,
        seatsTotal: 14,
        seatsBooked: 5,
        seatsAvailable: 9,
        awaitingTripCount: 2,
      });
    });

    it('reports null seat figures when there is no open trip', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      tripRepo.findOne.mockResolvedValue(null);
      qb.getCount.mockResolvedValueOnce(3); // awaitingCount only

      const result = await service.getAvailability('route-1', '2026-08-03');

      expect(result.hasOpenTrip).toBe(false);
      expect(result.seatsTotal).toBeNull();
      expect(result.seatsBooked).toBe(0);
      expect(result.seatsAvailable).toBeNull();
      expect(result.awaitingTripCount).toBe(3);
    });

    it('defaults travelDate to today when omitted', async () => {
      routeRepo.findOne.mockResolvedValue(activeRoute);
      tripRepo.findOne.mockResolvedValue(null);
      qb.getCount.mockResolvedValue(0);

      const result = await service.getAvailability('route-1');

      expect(result.travelDate).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  // ── getRevenueTrend ──────────────────────────────────────────────────────
  describe('getRevenueTrend', () => {
    it('throws BadRequestException when days < 1', async () => {
      await expect(service.getRevenueTrend(0)).rejects.toThrow(BadRequestException);
    });

    it('fills gap days with 0 revenue and applies the commission rate', async () => {
      qb.getRawMany.mockResolvedValue([]); // no bookings at all

      const result = await service.getRevenueTrend(3);

      expect(result).toHaveLength(3);
      expect(result.every((p) => p.revenue === 0 && p.commission === 0)).toBe(true);
    });

    it('normalizes a raw Date object back to a YYYY-MM-DD string key', async () => {
      const today = new Date();
      qb.getRawMany.mockResolvedValue([{ travelDate: today, grossRevenue: '1000' }]);

      const result = await service.getRevenueTrend(1);

      expect(result[0].revenue).toBe(1000);
      expect(result[0].commission).toBe(100); // 10% commission
    });

    it('scopes to a saccoId when provided', async () => {
      qb.getRawMany.mockResolvedValue([]);

      await service.getRevenueTrend(7, 'sacco-1');

      expect(qb.andWhere).toHaveBeenCalledWith('b.saccoId = :saccoId', { saccoId: 'sacco-1' });
    });
  });

  // ── getTodayEarnings ─────────────────────────────────────────────────────
  describe('getTodayEarnings', () => {
    it('returns 0 revenue when there are no paid bookings today', async () => {
      qb.getRawOne.mockResolvedValue({ grossRevenue: null });

      const result = await service.getTodayEarnings();

      expect(result.grossRevenue).toBe(0);
      expect(result.commission).toBe(0);
    });

    it('computes commission from gross revenue', async () => {
      qb.getRawOne.mockResolvedValue({ grossRevenue: '2000' });

      const result = await service.getTodayEarnings('sacco-1');

      expect(result.grossRevenue).toBe(2000);
      expect(result.commission).toBe(200);
      expect(qb.andWhere).toHaveBeenCalledWith('b.saccoId = :saccoId', { saccoId: 'sacco-1' });
    });
  });

  // ── getUniquePassengerStats ──────────────────────────────────────────────
  describe('getUniquePassengerStats', () => {
    it('computes new vs returning passengers for the week', async () => {
      qb.getRawMany
        .mockResolvedValueOnce([{ passengerPhone: '0700000001' }, { passengerPhone: '0700000002' }]) // this week
        .mockResolvedValueOnce([{ passengerPhone: '0700000003' }]) // last week
        .mockResolvedValueOnce([{ passengerPhone: '0700000001' }]); // ever booked before (only 0001 is returning)

      const result = await service.getUniquePassengerStats();

      expect(result.thisWeekUnique).toBe(2);
      expect(result.lastWeekUnique).toBe(1);
      expect(result.newThisWeek).toBe(1); // 0700000002 is new
      expect(result.returningThisWeek).toBe(1); // 0700000001 is returning
      expect(result.changePercent).toBe(100); // (2-1)/1 * 100
    });

    it('returns null changePercent when lastWeekUnique is 0', async () => {
      qb.getRawMany
        .mockResolvedValueOnce([{ passengerPhone: '0700000001' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getUniquePassengerStats();

      expect(result.changePercent).toBeNull();
    });
  });

  // ── getTodayPassengerStats ───────────────────────────────────────────────
  describe('getTodayPassengerStats', () => {
    it('computes change count and percent vs yesterday', async () => {
      qb.getCount
        .mockResolvedValueOnce(10) // today
        .mockResolvedValueOnce(8); // yesterday

      const result = await service.getTodayPassengerStats('sacco-1');

      expect(result.today).toBe(10);
      expect(result.yesterday).toBe(8);
      expect(result.changeCount).toBe(2);
      expect(result.changePercent).toBe(25);
    });

    it('returns null changePercent when yesterday had 0 bookings', async () => {
      qb.getCount
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(0);

      const result = await service.getTodayPassengerStats();

      expect(result.changePercent).toBeNull();
    });
  });
});