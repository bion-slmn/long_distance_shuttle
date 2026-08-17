// src/booking/booking.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { BookingService } from './booking.service';
import { Booking, BookingStatus, PaymentMethod, PaymentStatus } from './entities/booking.entity';
import { Trip, TripStatus } from '../trip/entities/trip.entity';
import { Route } from '../route/entities/route.entity';
import { PaymentService } from '../payment/payment.service';
import {
  Payment,
  PaymentMethod as PaymentEntityMethod,
  PaymentStatus as PaymentEntityStatus,
  PaymentReferenceType,
} from '../payment/entities/payment.entity';

type MockRepo<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const createMockRepo = (): MockRepo<any> => ({
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((x) => x),
  createQueryBuilder: jest.fn(),
  manager: undefined,
});

// Minimal chainable query builder mock — configure the terminal method
// (getOne/getCount/getMany/getRawOne/getRawMany) per test.
function mockQueryBuilder(overrides: Partial<Record<string, any>> = {}) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return qb;
}

describe('BookingService', () => {
  let service: BookingService;
  let bookingRepository: MockRepo<Booking>;
  let tripRepository: MockRepo<Trip>;
  let routeRepository: MockRepo<Route>;
  let paymentService: Partial<Record<keyof PaymentService, jest.Mock>>;

  const route: Route = {
    id: 'route-1',
    saccoId: 'sacco-1',
    fare: 500,
    origin: 'Nairobi',
    destination: 'Kisumu',
  } as Route;

  const baseDto = {
    routeId: 'route-1',
    travelDate: '2026-08-17',
    passengerName: 'Jane Wanjiru',
    passengerPhone: '0712345678',
    paymentMethod: PaymentMethod.CASH,
  };

  // Mocked transaction manager — captures the query builders it's asked to build
  let mockManager: any;
  let managerQueryBuilders: any[];

  beforeEach(async () => {
    bookingRepository = createMockRepo();
    tripRepository = createMockRepo();
    routeRepository = createMockRepo();
    paymentService = {
      initiateMpesaPayment: jest.fn(),
      recordCashPayment: jest.fn(),
    };

    managerQueryBuilders = [];
    mockManager = {
      createQueryBuilder: jest.fn(() => {
        const qb = mockQueryBuilder();
        managerQueryBuilders.push(qb);
        return qb;
      }),
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (_entity, data) => ({ id: 'booking-generated-id', ...data })),
      getRepository: jest.fn(() => ({
        save: jest.fn(async (data) => ({ id: 'payment-generated-id', ...data })),
      })),
    };

    (bookingRepository as any).manager = {
      transaction: jest.fn(async (cb: (manager: EntityManager) => Promise<any>) => cb(mockManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: getRepositoryToken(Booking), useValue: bookingRepository },
        { provide: getRepositoryToken(Trip), useValue: tripRepository },
        { provide: getRepositoryToken(Route), useValue: routeRepository },
        { provide: PaymentService, useValue: paymentService },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── create() ──────────────────────────────────────────────────────
  describe('create', () => {
    it('throws NotFoundException if the route does not exist', async () => {
      routeRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(baseDto as any)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when preferredBoardingFrom is after preferredBoardingTo', async () => {
      routeRepository.findOne!.mockResolvedValue(route);

      await expect(
        service.create({
          ...baseDto,
          preferredBoardingFrom: '17:00',
          preferredBoardingTo: '08:00',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates an AWAITING_TRIP booking when no BOARDING trip exists for the route/date', async () => {
      routeRepository.findOne!.mockResolvedValue(route);
      // findLockedOpenTrip -> getOne resolves null (managerQueryBuilders[0])
      mockManager.createQueryBuilder.mockImplementationOnce(() => {
        const qb = mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
        managerQueryBuilders.push(qb);
        return qb;
      });

      const result = await service.create(baseDto as any);

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
      expect(result.tripId).toBeNull();
      expect(result.seatNumber).toBeNull();
    });

    it('seats the passenger directly when a BOARDING trip has capacity and window matches', async () => {
      routeRepository.findOne!.mockResolvedValue(route);

      const openTrip: Trip = {
        id: 'trip-1',
        routeId: 'route-1',
        travelDate: '2026-08-17',
        status: TripStatus.BOARDING,
        vehicleCapacity: 14,
        createdAt: new Date('2026-08-17T08:00:00'),
      } as Trip;

      // 1st qb: findLockedOpenTrip -> getOne
      mockManager.createQueryBuilder
        .mockImplementationOnce(() => {
          const qb = mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(openTrip) });
          managerQueryBuilders.push(qb);
          return qb;
        })
        // 2nd qb: trySeatOnTrip's seatedCount -> getCount
        .mockImplementationOnce(() => {
          const qb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(3) });
          managerQueryBuilders.push(qb);
          return qb;
        });

      const result = await service.create(baseDto as any);

      expect(result.status).toBe(BookingStatus.CONFIRMED);
      expect(result.tripId).toBe('trip-1');
      expect(result.seatNumber).toBe(4);
    });

    it('falls back to AWAITING_TRIP when the open trip is already full', async () => {
      routeRepository.findOne!.mockResolvedValue(route);

      const openTrip: Trip = {
        id: 'trip-1',
        routeId: 'route-1',
        travelDate: '2026-08-17',
        status: TripStatus.BOARDING,
        vehicleCapacity: 14,
        createdAt: new Date('2026-08-17T08:00:00'),
      } as Trip;

      mockManager.createQueryBuilder
        .mockImplementationOnce(() => {
          const qb = mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(openTrip) });
          managerQueryBuilders.push(qb);
          return qb;
        })
        .mockImplementationOnce(() => {
          const qb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(14) }); // full
          managerQueryBuilders.push(qb);
          return qb;
        });

      const result = await service.create(baseDto as any);

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
      expect(result.tripId).toBeNull();
    });

    it('falls back to AWAITING_TRIP when the trip boarding time is outside the preferred window', async () => {
      routeRepository.findOne!.mockResolvedValue(route);

      const openTrip: Trip = {
        id: 'trip-1',
        routeId: 'route-1',
        travelDate: '2026-08-17',
        status: TripStatus.BOARDING,
        vehicleCapacity: 14,
        createdAt: new Date('2026-08-17T20:00:00'), // 8pm boarding
      } as Trip;

      mockManager.createQueryBuilder.mockImplementationOnce(() => {
        const qb = mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(openTrip) });
        managerQueryBuilders.push(qb);
        return qb;
      });

      const result = await service.create({
        ...baseDto,
        preferredBoardingFrom: '08:00',
        preferredBoardingTo: '10:00',
      } as any);

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
      // Only 1 query builder call (findLockedOpenTrip) — trySeatOnTrip is skipped entirely
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('records a cash payment inside the transaction for CASH bookings', async () => {
      routeRepository.findOne!.mockResolvedValue(route);
      mockManager.createQueryBuilder.mockImplementationOnce(() => {
        const qb = mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
        managerQueryBuilders.push(qb);
        return qb;
      });

      const paymentRepoSave = jest.fn(async (data) => data);
      mockManager.getRepository.mockReturnValue({ save: paymentRepoSave });

      await service.create({ ...baseDto, paymentMethod: PaymentMethod.CASH } as any);

      expect(mockManager.getRepository).toHaveBeenCalledWith(Payment);
      expect(paymentRepoSave).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: PaymentReferenceType.BOOKING,
          saccoId: route.saccoId,
          amount: route.fare,
          method: PaymentEntityMethod.CASH,
          status: PaymentEntityStatus.SUCCESS,
        }),
      );
    });

    it('does NOT record a cash payment for MPESA bookings, and triggers STK push instead', async () => {
      routeRepository.findOne!.mockResolvedValue(route);
      mockManager.createQueryBuilder.mockImplementationOnce(() => {
        const qb = mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
        managerQueryBuilders.push(qb);
        return qb;
      });
      paymentService.initiateMpesaPayment!.mockResolvedValue({
        paymentId: 'payment-1',
        checkoutRequestId: 'ws_CO_1',
      });

      const result = await service.create({ ...baseDto, paymentMethod: PaymentMethod.MPESA } as any);

      expect(mockManager.getRepository).not.toHaveBeenCalled();
      expect(paymentService.initiateMpesaPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: PaymentReferenceType.BOOKING,
          referenceId: result.id,
          saccoId: route.saccoId,
          amount: route.fare,
          payerPhone: baseDto.passengerPhone,
        }),
      );
    });

    it('marks the booking payment-failed if the M-Pesa STK push throws', async () => {
      routeRepository.findOne!.mockResolvedValue(route);
      mockManager.createQueryBuilder.mockImplementationOnce(() => {
        const qb = mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) });
        managerQueryBuilders.push(qb);
        return qb;
      });
      paymentService.initiateMpesaPayment!.mockRejectedValue(new Error('Daraja timeout'));

      const existingBooking = {
        id: 'booking-generated-id',
        paymentStatus: PaymentStatus.PENDING,
        status: BookingStatus.AWAITING_TRIP,
      };
      bookingRepository.findOne!.mockResolvedValue(existingBooking);
      bookingRepository.save!.mockImplementation(async (b) => b);

      await service.create({ ...baseDto, paymentMethod: PaymentMethod.MPESA } as any);

      expect(bookingRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'booking-generated-id' } }),
      );
      expect(bookingRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentStatus: PaymentStatus.FAILED,
          status: BookingStatus.CANCELLED,
        }),
      );
    });
  });

  // ─── markPaymentFailed ─────────────────────────────────────────────
  describe('markPaymentFailed', () => {
    it('sets paymentStatus FAILED and status CANCELLED', async () => {
      const booking = {
        id: 'booking-1',
        paymentStatus: PaymentStatus.PENDING,
        status: BookingStatus.AWAITING_TRIP,
      };
      bookingRepository.findOne!.mockResolvedValue(booking);
      bookingRepository.save!.mockImplementation(async (b) => b);

      const result = await service.markPaymentFailed('booking-1');

      expect(result.paymentStatus).toBe(PaymentStatus.FAILED);
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });

    it('throws NotFoundException if the booking does not exist', async () => {
      bookingRepository.findOne!.mockResolvedValue(null);

      await expect(service.markPaymentFailed('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── confirmPayment ────────────────────────────────────────────────
  describe('confirmPayment', () => {
    it('marks PAID and stores the mpesa receipt number', async () => {
      const booking = { id: 'booking-1', paymentStatus: PaymentStatus.PENDING };
      bookingRepository.findOne!.mockResolvedValue(booking);
      bookingRepository.save!.mockImplementation(async (b) => b);

      const result = await service.confirmPayment('booking-1', {
        mpesaReceiptNumber: 'NLJ7RT61SV',
      });

      expect(result.paymentStatus).toBe(PaymentStatus.PAID);
      expect(result.mpesaReceiptNumber).toBe('NLJ7RT61SV');
    });

    it('does not overwrite existing receipt/checkoutId fields when not provided', async () => {
      const booking = {
        id: 'booking-1',
        paymentStatus: PaymentStatus.PENDING,
        mpesaReceiptNumber: 'EXISTING',
      };
      bookingRepository.findOne!.mockResolvedValue(booking);
      bookingRepository.save!.mockImplementation(async (b) => b);

      const result = await service.confirmPayment('booking-1', {});

      expect(result.mpesaReceiptNumber).toBe('EXISTING');
    });
  });

  // ─── update ────────────────────────────────────────────────────────
  describe('update', () => {
    it('throws ForbiddenException when saccoId does not match', async () => {
      bookingRepository.findOne!.mockResolvedValue({ id: 'b1', saccoId: 'sacco-1' });

      await expect(
        service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException boarding a non-CONFIRMED booking', async () => {
      bookingRepository.findOne!.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.AWAITING_TRIP,
        paymentStatus: PaymentStatus.PAID,
      });

      await expect(
        service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException boarding an unpaid CONFIRMED booking', async () => {
      bookingRepository.findOne!.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
      });

      await expect(
        service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('boards a paid, confirmed booking successfully', async () => {
      const booking = {
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        seatNumber: 4,
        tripId: 'trip-1',
      };
      bookingRepository.findOne!.mockResolvedValue(booking);
      bookingRepository.save!.mockImplementation(async (b) => b);

      const result = await service.update('b1', { status: BookingStatus.BOARDED } as any, 'sacco-1');

      expect(result.status).toBe(BookingStatus.BOARDED);
    });
  });

  // ─── cancel ────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('throws ForbiddenException when saccoId does not match', async () => {
      bookingRepository.findOne!.mockResolvedValue({ id: 'b1', saccoId: 'sacco-1' });

      await expect(service.cancel('b1', 'sacco-2')).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException cancelling a BOARDED booking', async () => {
      bookingRepository.findOne!.mockResolvedValue({
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.BOARDED,
      });

      await expect(service.cancel('b1', 'sacco-1')).rejects.toThrow(BadRequestException);
    });

    it('cancels an unpaid booking without touching paymentStatus', async () => {
      const booking = {
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.AWAITING_TRIP,
        paymentStatus: PaymentStatus.PENDING,
      };
      bookingRepository.findOne!.mockResolvedValue(booking);
      bookingRepository.save!.mockImplementation(async (b) => b);

      const result = await service.cancel('b1', 'sacco-1');

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.paymentStatus).toBe(PaymentStatus.PENDING);
    });

    it('refunds a paid booking on cancel', async () => {
      const booking = {
        id: 'b1',
        saccoId: 'sacco-1',
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      };
      bookingRepository.findOne!.mockResolvedValue(booking);
      bookingRepository.save!.mockImplementation(async (b) => b);

      const result = await service.cancel('b1', 'sacco-1');

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.paymentStatus).toBe(PaymentStatus.REFUNDED);
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────
  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      bookingRepository.findOne!.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the booking with route/trip relations', async () => {
      const booking = { id: 'b1' };
      bookingRepository.findOne!.mockResolvedValue(booking);

      const result = await service.findOne('b1');

      expect(bookingRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'b1' },
        relations: { route: true, trip: true },
      });
      expect(result).toEqual(booking);
    });
  });

  // ─── getAvailability ───────────────────────────────────────────────
  describe('getAvailability', () => {
    it('throws NotFoundException for an unknown route', async () => {
      routeRepository.findOne!.mockResolvedValue(null);

      await expect(service.getAvailability('route-x', '2026-08-17')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns seat counts when a BOARDING trip is open', async () => {
      routeRepository.findOne!.mockResolvedValue(route);
      tripRepository.findOne!.mockResolvedValue({ id: 'trip-1', vehicleCapacity: 14 });

      const seatedQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(9) });
      const awaitingQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(2) });
      bookingRepository.createQueryBuilder!
        .mockReturnValueOnce(seatedQb)
        .mockReturnValueOnce(awaitingQb);

      const result = await service.getAvailability('route-1', '2026-08-17');

      expect(result).toEqual({
        routeId: 'route-1',
        travelDate: '2026-08-17',
        hasOpenTrip: true,
        seatsTotal: 14,
        seatsBooked: 9,
        seatsAvailable: 5,
        awaitingTripCount: 2,
      });
    });

    it('returns null seat fields when no trip is open', async () => {
      routeRepository.findOne!.mockResolvedValue(route);
      tripRepository.findOne!.mockResolvedValue(null);

      const awaitingQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(5) });
      bookingRepository.createQueryBuilder!.mockReturnValueOnce(awaitingQb);

      const result = await service.getAvailability('route-1', '2026-08-17');

      expect(result.hasOpenTrip).toBe(false);
      expect(result.seatsTotal).toBeNull();
      expect(result.seatsAvailable).toBeNull();
      expect(result.awaitingTripCount).toBe(5);
    });

    it('defaults travelDate to today when omitted', async () => {
      routeRepository.findOne!.mockResolvedValue(route);
      tripRepository.findOne!.mockResolvedValue(null);
      bookingRepository.createQueryBuilder!.mockReturnValue(mockQueryBuilder());

      const result = await service.getAvailability('route-1');

      expect(result.travelDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ─── assignPendingBookingsToTrip ───────────────────────────────────
  describe('assignPendingBookingsToTrip', () => {
    const trip: Trip = {
      id: 'trip-1',
      routeId: 'route-1',
      travelDate: '2026-08-17',
      vehicleCapacity: 3,
      createdAt: new Date('2026-08-17T09:00:00'),
    } as Trip;

    it('does nothing if the trip is already at capacity', async () => {
      mockManager.createQueryBuilder.mockImplementationOnce(() => {
        const qb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(3) }); // == capacity
        return qb;
      });

      await service.assignPendingBookingsToTrip(trip, mockManager);

      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(1); // only alreadySeated check
    });

    it('assigns pending PAID bookings up to capacity, in FIFO order, skipping outside-window ones', async () => {
      const pendingBookings = [
        { id: 'p1', preferredBoardingFrom: null, preferredBoardingTo: null },
        { id: 'p2', preferredBoardingFrom: '20:00', preferredBoardingTo: '22:00' }, // outside 9am trip
        { id: 'p3', preferredBoardingFrom: null, preferredBoardingTo: null },
      ];

      mockManager.createQueryBuilder
        .mockImplementationOnce(() => mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) })) // alreadySeated
        .mockImplementationOnce(() =>
          mockQueryBuilder({ getMany: jest.fn().mockResolvedValue(pendingBookings) }),
        );

      await service.assignPendingBookingsToTrip(trip, mockManager);

      expect(mockManager.save).toHaveBeenCalledTimes(2); // p1 and p3 assigned, p2 skipped
      expect(pendingBookings[0].status).toBe(BookingStatus.CONFIRMED);
      expect((pendingBookings[0] as any).seatNumber).toBe(1);
      expect((pendingBookings[2] as any).seatNumber).toBe(2);
      expect((pendingBookings[1] as any).status).toBeUndefined(); // untouched
    });

    it('stops assigning once capacity is reached mid-list', async () => {
      const trip2Cap = { ...trip, vehicleCapacity: 1 };
      const pendingBookings = [
        { id: 'p1', preferredBoardingFrom: null, preferredBoardingTo: null },
        { id: 'p2', preferredBoardingFrom: null, preferredBoardingTo: null },
      ];

      mockManager.createQueryBuilder
        .mockImplementationOnce(() => mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) }))
        .mockImplementationOnce(() =>
          mockQueryBuilder({ getMany: jest.fn().mockResolvedValue(pendingBookings) }),
        );

      await service.assignPendingBookingsToTrip(trip2Cap as Trip, mockManager);

      expect(mockManager.save).toHaveBeenCalledTimes(1);
      expect((pendingBookings[0] as any).status).toBe(BookingStatus.CONFIRMED);
      expect((pendingBookings[1] as any).status).toBeUndefined();
    });
  });

  // ─── getRevenueTrend ───────────────────────────────────────────────
  describe('getRevenueTrend', () => {
    it('throws BadRequestException for days < 1', async () => {
      await expect(service.getRevenueTrend(0)).rejects.toThrow(BadRequestException);
    });

    it('fills gap days with 0 revenue and computes commission', async () => {
      const qb = mockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ travelDate: '2026-08-16', grossRevenue: '1000' }]),
      });
      bookingRepository.createQueryBuilder!.mockReturnValue(qb);

      // Freeze "today" isn't trivial without jest fake timers; instead just
      // check structural properties rather than exact dates.
      const trend = await service.getRevenueTrend(2);

      expect(trend).toHaveLength(2);
      expect(trend.every((t) => typeof t.revenue === 'number')).toBe(true);
      expect(trend.every((t) => t.commission === t.revenue * 0.1)).toBe(true);
    });

    it('scopes to saccoId when provided', async () => {
      const qb = mockQueryBuilder();
      bookingRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.getRevenueTrend(3, 'sacco-1');

      expect(qb.andWhere).toHaveBeenCalledWith('b.saccoId = :saccoId', { saccoId: 'sacco-1' });
    });
  });

  // ─── getTodayEarnings ──────────────────────────────────────────────
  describe('getTodayEarnings', () => {
    it('returns 0 revenue/commission when there is no data', async () => {
      const qb = mockQueryBuilder({ getRawOne: jest.fn().mockResolvedValue(null) });
      bookingRepository.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.getTodayEarnings();

      expect(result.grossRevenue).toBe(0);
      expect(result.commission).toBe(0);
    });

    it('computes commission at 10% of gross revenue', async () => {
      const qb = mockQueryBuilder({ getRawOne: jest.fn().mockResolvedValue({ grossRevenue: '2000' }) });
      bookingRepository.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.getTodayEarnings();

      expect(result.grossRevenue).toBe(2000);
      expect(result.commission).toBe(200);
    });
  });

  // ─── getUniquePassengerStats ───────────────────────────────────────
  describe('getUniquePassengerStats', () => {
    it('computes new vs returning passengers correctly', async () => {
      // Order of calls in the implementation: thisWeek, lastWeek, priorPhones
      const thisWeekQb = mockQueryBuilder({
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ passengerPhone: '0700000001' }, { passengerPhone: '0700000002' }]),
      });
      const lastWeekQb = mockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ passengerPhone: '0700000003' }]),
      });
      const priorQb = mockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ passengerPhone: '0700000001' }]), // 0700000001 booked before
      });

      bookingRepository.createQueryBuilder!
        .mockReturnValueOnce(thisWeekQb)
        .mockReturnValueOnce(lastWeekQb)
        .mockReturnValueOnce(priorQb);

      const result = await service.getUniquePassengerStats();

      expect(result.thisWeekUnique).toBe(2);
      expect(result.lastWeekUnique).toBe(1);
      expect(result.newThisWeek).toBe(1); // only 0700000002 is new
      expect(result.returningThisWeek).toBe(1);
      expect(result.changePercent).toBe(100); // (2-1)/1 * 100
    });

    it('returns null changePercent when lastWeekUnique is 0', async () => {
      bookingRepository.createQueryBuilder!
        .mockReturnValueOnce(mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }))
        .mockReturnValueOnce(mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }))
        .mockReturnValueOnce(mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }));

      const result = await service.getUniquePassengerStats();

      expect(result.changePercent).toBeNull();
    });
  });

  // ─── getTodayPassengerStats ────────────────────────────────────────
  describe('getTodayPassengerStats', () => {
    it('computes changeCount and changePercent vs yesterday', async () => {
      const todayQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(10) });
      const yesterdayQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(8) });
      bookingRepository.createQueryBuilder!.mockReturnValueOnce(todayQb).mockReturnValueOnce(yesterdayQb);

      const result = await service.getTodayPassengerStats();

      expect(result.today).toBe(10);
      expect(result.yesterday).toBe(8);
      expect(result.changeCount).toBe(2);
      expect(result.changePercent).toBe(25);
    });

    it('returns null changePercent when yesterday is 0', async () => {
      const todayQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(5) });
      const yesterdayQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      bookingRepository.createQueryBuilder!.mockReturnValueOnce(todayQb).mockReturnValueOnce(yesterdayQb);

      const result = await service.getTodayPassengerStats();

      expect(result.changePercent).toBeNull();
    });
  });
});