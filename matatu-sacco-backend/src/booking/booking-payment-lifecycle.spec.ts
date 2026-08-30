// src/booking/booking-payment-lifecycle.spec.ts
//
// Two things that decide whether a booking's money story stays coherent:
//
//   retryPayment — a clerk re-prompting a passenger must never re-charge a
//   paid booking, resurrect a cancelled one, or reopen one that has boarded.
//
//   findAll — the reporting query. Its ordering is load-bearing: the manifest
//   reads bookings oldest-first (boarding order), so the reverse-chronological
//   view the clerk dashboard wants is applied client-side, not here.
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { BookingService } from './booking.service';
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

describe('BookingService — payment lifecycle and reporting', () => {
    let service: BookingService;
    let bookingRepository: any;
    let paymentService: any;
    let managerMock: any;
    let queryBuilder: any;

    const ROUTE_ID = 'route-1';
    const SACCO_ID = 'sacco-1';

    const baseRoute = { id: ROUTE_ID, saccoId: SACCO_ID, fare: 500 } as any;

    const existingBooking = (overrides: Partial<Booking> = {}): Booking =>
        ({
            id: 'booking-1',
            routeId: ROUTE_ID,
            saccoId: SACCO_ID,
            travelDate: '2026-08-30',
            tripId: 'trip-1',
            seatNumber: 4,
            passengerName: 'Jane Doe',
            passengerPhone: '254700000000',
            fare: 500,
            status: BookingStatus.CONFIRMED,
            paymentMethod: PaymentMethod.MPESA,
            paymentStatus: PaymentStatus.PENDING,
            holdExpiresAt: null,
            route: baseRoute,
            ...overrides,
        }) as Booking;

    beforeEach(async () => {
        queryBuilder = createMockQueryBuilder();

        managerMock = {
            createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((_entity: any, data: any) =>
                Promise.resolve({ id: 'booking-1', ...data }),
            ),
            getRepository: jest.fn(() => ({
                save: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                findOneByOrFail: jest
                    .fn()
                    .mockResolvedValue({ mpesaReceiptNumber: 'NLJ7RT61SV' }),
            })),
        };

        bookingRepository = {
            createQueryBuilder: jest.fn(() => queryBuilder),
            findOne: jest.fn(),
            save: jest.fn(async (b: any) => b),
            manager: {
                transaction: jest.fn((cb: any) => cb(managerMock)),
                createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
            },
        };

        paymentService = {
            initiateMpesaPayment: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BookingService,
                { provide: getRepositoryToken(Booking), useValue: bookingRepository },
                { provide: getRepositoryToken(Trip), useValue: { findOne: jest.fn() } },
                {
                    provide: getRepositoryToken(Route),
                    useValue: { findOne: jest.fn().mockResolvedValue(baseRoute) },
                },
                { provide: PaymentService, useValue: paymentService },
                { provide: SaccoSettingsService, useValue: { findOne: jest.fn() } },
            ],
        }).compile();

        service = module.get<BookingService>(BookingService);
    });

    afterEach(() => jest.clearAllMocks());

    // ─── retryPayment guards ──────────────────────────────────────────────
    describe('retry guards', () => {
        const retryDto = (overrides: any = {}) =>
            ({
                bookingId: 'booking-1',
                routeId: ROUTE_ID,
                passengerName: 'Jane Doe',
                passengerPhone: '254700000000',
                paymentMethod: PaymentMethod.MPESA,
                ...overrides,
            }) as any;

        it('never re-charges a booking that is already PAID', async () => {
            const paid = existingBooking({ paymentStatus: PaymentStatus.PAID });
            bookingRepository.findOne.mockResolvedValue(paid);

            const result = await service.create(retryDto(), BookingSource.CLERK);

            // A stale retry click must be a no-op, not a second STK prompt.
            expect(result).toBe(paid);
            expect(paymentService.initiateMpesaPayment).not.toHaveBeenCalled();
            expect(bookingRepository.save).not.toHaveBeenCalled();
        });

        it('refuses to retry a CANCELLED booking', async () => {
            bookingRepository.findOne.mockResolvedValue(
                existingBooking({ status: BookingStatus.CANCELLED }),
            );

            await expect(
                service.create(retryDto(), BookingSource.CLERK),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(paymentService.initiateMpesaPayment).not.toHaveBeenCalled();
        });

        it('refuses to retry a booking that has already BOARDED', async () => {
            bookingRepository.findOne.mockResolvedValue(
                existingBooking({ status: BookingStatus.BOARDED }),
            );

            await expect(
                service.create(retryDto(), BookingSource.CLERK),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(paymentService.initiateMpesaPayment).not.toHaveBeenCalled();
        });

        it('reuses the existing row rather than creating a second seat claim', async () => {
            bookingRepository.findOne.mockResolvedValue(existingBooking());

            const result = await service.create(retryDto(), BookingSource.CLERK);

            // A new row would claim a second seat for one passenger.
            expect(result.id).toBe('booking-1');
            expect(result.seatNumber).toBe(4);
            expect(managerMock.create).not.toHaveBeenCalled();
        });

        it('lets a clerk switch a stuck STK booking to cash, settling it PAID with no hold', async () => {
            bookingRepository.findOne.mockResolvedValue(existingBooking());

            const result = await service.create(
                retryDto({ paymentMethod: PaymentMethod.CASH }),
                BookingSource.CLERK,
            );

            expect(result.paymentMethod).toBe(PaymentMethod.CASH);
            expect(result.paymentStatus).toBe(PaymentStatus.PAID);
            // Cash is sold outright — a hold here would free a paid seat.
            expect(result.holdExpiresAt).toBeNull();
            expect(paymentService.initiateMpesaPayment).not.toHaveBeenCalled();
        });

        it('restarts the hold clock on a fresh STK retry instead of inheriting a spent one', async () => {
            const stale = existingBooking({
                holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
            });
            bookingRepository.findOne.mockResolvedValue(stale);

            const before = Date.now();
            const result = await service.create(retryDto(), BookingSource.CLERK);

            expect(result.holdExpiresAt!.getTime()).toBeGreaterThanOrEqual(
                before + SEAT_HOLD_MS - 1000,
            );
            expect(paymentService.initiateMpesaPayment).toHaveBeenCalled();
        });

        it('settles a retry against a matched C2B receipt without an STK prompt', async () => {
            bookingRepository.findOne.mockResolvedValue(existingBooking());

            const result = await service.create(
                retryDto({ mpesaTransactionId: 'mpesa-txn-1' }),
                BookingSource.CLERK,
            );

            expect(result.paymentStatus).toBe(PaymentStatus.PAID);
            expect(result.holdExpiresAt).toBeNull();
            expect(paymentService.initiateMpesaPayment).not.toHaveBeenCalled();
        });
    });

    // ─── findAll ──────────────────────────────────────────────────────────
    describe('findAll', () => {
        const whereClauses = () =>
            queryBuilder.andWhere.mock.calls.map((c: any[]) => c[0]);

        it('returns bookings oldest-first, the order the manifest boards in', async () => {
            await service.findAll({});

            // The clerk dashboard wants newest-first and sorts client-side.
            // Flipping it here would silently reorder the manifest.
            expect(queryBuilder.orderBy).toHaveBeenCalledWith('b.createdAt', 'ASC');
        });

        it('filters an inclusive travelDate range from both ends', async () => {
            await service.findAll({ from: '2026-08-01', to: '2026-08-31' });

            expect(whereClauses()).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('b.travelDate >= :from'),
                    expect.stringContaining('b.travelDate <= :to'),
                ]),
            );
        });

        it('treats an exact travelDate as its own filter, never combined with a range', async () => {
            await service.findAll({
                travelDate: '2026-08-30',
                from: '2026-08-01',
                to: '2026-08-31',
            });

            const clauses = whereClauses();
            expect(clauses).toEqual(
                expect.arrayContaining([expect.stringContaining('b.travelDate = :travelDate')]),
            );
            // Applying both would produce an empty intersection on most inputs.
            expect(clauses.join(' ')).not.toContain(':from');
            expect(clauses.join(' ')).not.toContain(':to');
        });

        it('accepts an open-ended range (from with no to)', async () => {
            await service.findAll({ from: '2026-08-01' });

            const clauses = whereClauses().join(' ');
            expect(clauses).toContain(':from');
            expect(clauses).not.toContain(':to');
        });

        it('filters by vehicle through the joined trip, not the booking row', async () => {
            await service.findAll({ vehicleId: 'vehicle-1' });

            // Bookings carry no vehicleId of their own — it lives on the trip.
            expect(whereClauses()).toEqual(
                expect.arrayContaining([expect.stringContaining('trip.vehicleId')]),
            );
        });

        it('joins route and trip so the list can render without N+1 lookups', async () => {
            await service.findAll({});

            const joined = queryBuilder.leftJoinAndSelect.mock.calls.map(
                (c: any[]) => c[1],
            );
            expect(joined).toEqual(expect.arrayContaining(['route', 'trip']));
        });

        it('applies no date predicate at all when neither travelDate nor a range is given', async () => {
            await service.findAll({ saccoId: SACCO_ID });

            expect(whereClauses().join(' ')).not.toContain('travelDate');
        });

        it('combines sacco, route, status and trip filters additively', async () => {
            await service.findAll({
                saccoId: SACCO_ID,
                routeId: ROUTE_ID,
                status: BookingStatus.CONFIRMED,
                tripId: 'trip-1',
            });

            const clauses = whereClauses().join(' ');
            expect(clauses).toContain('b.saccoId');
            expect(clauses).toContain('b.routeId');
            expect(clauses).toContain('b.status');
            expect(clauses).toContain('b.tripId');
        });
    });
});
