// src/booking/booking-seat-hold.spec.ts
//
// Seat holds: an M-Pesa booking claims its seat before any money moves, so
// the seat is HELD, not SOLD. These tests pin the two halves of that idea —
// the hold's lifecycle on the row, and the fact that occupancy queries read
// expiry as a predicate (SQL NOW()) rather than waiting for a job to fire.
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BookingService, SeatState } from './booking.service';
import {
    Booking,
    BookingSource,
    BookingStatus,
    PaymentMethod,
    PaymentStatus,
} from './entities/booking.entity';
import { Trip } from '../trip/entities/trip.entity';
import { Route } from '../route/entities/route.entity';
import { PaymentService } from '../payment/payment.service';
import { SaccoSettingsService } from '../sacco/sacco-settings.service';
import { SEAT_HOLD_MS } from '../payment/payment-reconcile.constants';

function createMockQueryBuilder() {
    const qb: any = {};
    [
        'where', 'andWhere', 'orderBy', 'setLock', 'leftJoinAndSelect',
        'select', 'addSelect', 'groupBy',
    ].forEach((m) => (qb[m] = jest.fn().mockReturnValue(qb)));
    qb.getOne = jest.fn().mockResolvedValue(null);
    qb.getCount = jest.fn().mockResolvedValue(0);
    qb.getMany = jest.fn().mockResolvedValue([]);
    qb.getRawMany = jest.fn().mockResolvedValue([]);
    qb.getRawOne = jest.fn();
    return qb;
}

describe('BookingService — seat holds', () => {
    let service: BookingService;
    let bookingRepository: any;
    let tripRepository: any;
    let routeRepository: any;
    let paymentService: any;
    let managerMock: any;

    const ROUTE_ID = 'route-1';
    const SACCO_ID = 'sacco-1';
    const TRIP_ID = 'trip-1';

    const FROZEN_NOW = new Date();
    FROZEN_NOW.setHours(9, 0, 0, 0);

    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(FROZEN_NOW);
    });
    afterAll(() => jest.useRealTimers());

    const baseRoute = { id: ROUTE_ID, saccoId: SACCO_ID, fare: 500 } as any;
    const baseDto = {
        routeId: ROUTE_ID,
        passengerName: 'Jane Doe',
        passengerPhone: '254700000000',
        paymentMethod: PaymentMethod.MPESA,
    } as any;

    const todayStr = () => new Date().toISOString().slice(0, 10);

    beforeEach(async () => {
        managerMock = {
            createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((_entity: any, data: any) => Promise.resolve({ id: 'booking-1', ...data })),
            getRepository: jest.fn(() => ({
                save: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOneByOrFail: jest.fn().mockResolvedValue({ mpesaReceiptNumber: 'NLJ7RT61SV' }),
            })),
        };

        bookingRepository = {
            createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            findOne: jest.fn(),
            save: jest.fn(async (b: any) => b),
            manager: {
                transaction: jest.fn((cb: any) => cb(managerMock)),
                createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            },
        };

        tripRepository = { findOne: jest.fn().mockResolvedValue(null) };
        routeRepository = { findOne: jest.fn().mockResolvedValue(baseRoute) };
        paymentService = { initiateMpesaPayment: jest.fn().mockResolvedValue(undefined) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BookingService,
                { provide: getRepositoryToken(Booking), useValue: bookingRepository },
                { provide: getRepositoryToken(Trip), useValue: tripRepository },
                { provide: getRepositoryToken(Route), useValue: routeRepository },
                { provide: PaymentService, useValue: paymentService },
                { provide: SaccoSettingsService, useValue: { findOne: jest.fn() } },
            ],
        }).compile();

        service = module.get<BookingService>(BookingService);
    });

    afterEach(() => jest.clearAllMocks());

    // ─── Hold lifecycle on the booking row ────────────────────────────────
    describe('hold lifecycle', () => {
        it('starts the hold clock for an M-Pesa booking, derived from the reconcile ceiling', async () => {
            const result = await service.create(baseDto, BookingSource.CLERK);

            expect(result.paymentStatus).toBe(PaymentStatus.PENDING);
            expect(result.holdExpiresAt).toEqual(new Date(FROZEN_NOW.getTime() + SEAT_HOLD_MS));
        });

        // Cash is money already in hand — the seat is sold, not held, so it
        // must never carry an expiry that could release it.
        it('leaves holdExpiresAt null for a CASH booking', async () => {
            const result = await service.create(
                { ...baseDto, paymentMethod: PaymentMethod.CASH },
                BookingSource.CLERK,
            );

            expect(result.paymentStatus).toBe(PaymentStatus.PAID);
            expect(result.holdExpiresAt).toBeNull();
        });

        it('leaves holdExpiresAt null when a C2B receipt is matched up front', async () => {
            const result = await service.create(
                { ...baseDto, mpesaTransactionId: 'txn-1' },
                BookingSource.CLERK,
            );

            expect(result.paymentStatus).toBe(PaymentStatus.PAID);
            expect(result.holdExpiresAt).toBeNull();
        });

        it('clears the hold when payment lands — the seat is now sold', async () => {
            bookingRepository.findOne.mockResolvedValue({
                id: 'booking-1',
                holdExpiresAt: new Date(FROZEN_NOW.getTime() + SEAT_HOLD_MS),
            });

            const result = await service.confirmPayment('booking-1', {
                mpesaReceiptNumber: 'NLJ7RT61SV',
            });

            expect(result.paymentStatus).toBe(PaymentStatus.PAID);
            expect(result.holdExpiresAt).toBeNull();
        });

        // Releasing on failure rather than letting the clock run out matters:
        // a clerk retrying immediately should find the seat free.
        it('releases the seat immediately when payment fails, without waiting out the clock', async () => {
            bookingRepository.findOne.mockResolvedValue({
                id: 'booking-1',
                holdExpiresAt: new Date(FROZEN_NOW.getTime() + SEAT_HOLD_MS),
            });

            const result = await service.markPaymentFailed('booking-1');

            expect(result.status).toBe(BookingStatus.CANCELLED);
            expect(result.holdExpiresAt).toBeNull();
        });
    });

    // ─── Retry restarts the clock rather than inheriting a spent one ──────
    describe('retry', () => {
        const existing = () => ({
            id: 'booking-1',
            route: baseRoute,
            status: BookingStatus.CONFIRMED,
            paymentStatus: PaymentStatus.FAILED,
            holdExpiresAt: new Date(FROZEN_NOW.getTime() - 60_000), // already lapsed
        });

        it('restarts the hold from now for a fresh STK retry', async () => {
            bookingRepository.findOne.mockResolvedValue(existing());

            const result = await service.create(
                { ...baseDto, bookingId: 'booking-1' },
                BookingSource.CLERK,
            );

            expect(result.holdExpiresAt).toEqual(new Date(FROZEN_NOW.getTime() + SEAT_HOLD_MS));
            expect(paymentService.initiateMpesaPayment).toHaveBeenCalled();
        });

        it('carries no hold when a retry is settled in cash', async () => {
            bookingRepository.findOne.mockResolvedValue(existing());

            const result = await service.create(
                { ...baseDto, bookingId: 'booking-1', paymentMethod: PaymentMethod.CASH },
                BookingSource.CLERK,
            );

            expect(result.paymentStatus).toBe(PaymentStatus.PAID);
            expect(result.holdExpiresAt).toBeNull();
        });
    });

    // ─── Occupancy: expiry is a predicate, not an event ───────────────────
    describe('seat map', () => {
        function mockOccupancy(rows: any[]) {
            const qb = createMockQueryBuilder();
            qb.getRawMany.mockResolvedValue(rows);
            bookingRepository.manager.createQueryBuilder.mockReturnValue(qb);
            return qb;
        }

        beforeEach(() => {
            tripRepository.findOne.mockResolvedValue({ id: TRIP_ID, vehicleCapacity: 14 });
        });

        it('distinguishes a sold seat from one held by an in-flight payment', async () => {
            const holdExpiresAt = new Date(FROZEN_NOW.getTime() + 90_000);
            mockOccupancy([
                { seatNumber: 1, paymentStatus: PaymentStatus.PAID, holdExpiresAt: null },
                { seatNumber: 2, paymentStatus: PaymentStatus.PENDING, holdExpiresAt },
            ]);

            const result = await service.getSeatMap(ROUTE_ID, todayStr());

            expect(result.seats).toEqual([
                { seatNumber: 1, state: SeatState.TAKEN, holdExpiresAt: null },
                { seatNumber: 2, state: SeatState.HELD, holdExpiresAt },
            ]);
        });

        // The old shape is what the seat picker already consumes — both a sold
        // and a held seat are unbookable, so both must still appear here.
        it('keeps takenSeatNumbers covering sold and held alike', async () => {
            mockOccupancy([
                { seatNumber: 1, paymentStatus: PaymentStatus.PAID, holdExpiresAt: null },
                {
                    seatNumber: 2,
                    paymentStatus: PaymentStatus.PENDING,
                    holdExpiresAt: new Date(FROZEN_NOW.getTime() + 90_000),
                },
            ]);

            const result = await service.getSeatMap(ROUTE_ID, todayStr());

            expect(result.takenSeatNumbers).toEqual([1, 2]);
        });

        // This is the whole design in one assertion: a lapsed hold is filtered
        // out by the database, so no sweeper, cron or queue job is required
        // for the seat to become bookable again.
        it('filters lapsed holds in SQL against NOW(), not in application code', async () => {
            const qb = mockOccupancy([]);

            await service.getSeatMap(ROUTE_ID, todayStr());

            expect(qb.andWhere).toHaveBeenCalledWith(
                '(b.paymentStatus = :paid OR b.holdExpiresAt > NOW())',
                { paid: PaymentStatus.PAID },
            );
        });

        it('reports an empty map when no vehicle is boarding', async () => {
            tripRepository.findOne.mockResolvedValue(null);

            const result = await service.getSeatMap(ROUTE_ID, todayStr());

            expect(result.hasOpenTrip).toBe(false);
            expect(result.seats).toEqual([]);
            expect(result.seatsTotal).toBeNull();
        });
    });

    // ─── Blocking vs counting are different questions ─────────────────────
    describe('availability counts', () => {
        it('excludes held seats from seatsBooked but still subtracts them from seatsAvailable', async () => {
            tripRepository.findOne.mockResolvedValue({ id: TRIP_ID, vehicleCapacity: 14 });

            const qb = createMockQueryBuilder();
            qb.getRawMany.mockResolvedValue([
                { seatNumber: 1, paymentStatus: PaymentStatus.PAID, holdExpiresAt: null },
                { seatNumber: 2, paymentStatus: PaymentStatus.PAID, holdExpiresAt: null },
                {
                    seatNumber: 3,
                    paymentStatus: PaymentStatus.PENDING,
                    holdExpiresAt: new Date(FROZEN_NOW.getTime() + 90_000),
                },
            ]);
            bookingRepository.manager.createQueryBuilder.mockReturnValue(qb);

            routeRepository.findOne.mockResolvedValue(baseRoute);
            (service as any).saccoSettingsService.findOne.mockResolvedValue({
                preBookingEnabled: true,
                preBookingMorningStart: '05:00:00',
                preBookingMorningEnd: '10:00:00',
                preBookingMaxMorningVehicles: 2,
                preBookingMaxSeatsPerTrip: 14,
            });

            const result = await service.getAvailability(ROUTE_ID, todayStr());

            expect(result.seatsBooked).toBe(2);  // sold only
            expect(result.seatsHeld).toBe(1);    // mid-payment
            expect(result.seatsAvailable).toBe(11); // 14 - 2 sold - 1 held
        });
    });
});
