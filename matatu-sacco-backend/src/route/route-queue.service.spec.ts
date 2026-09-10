// src/route/route-queue.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { RouteQueueService } from './route-queue.service';
import { RouteQueue, RouteQueueStatus } from './entities/route-queue.entity';
import { QueueEntry, QueueEntryStatus } from './entities/queue-entry.entity';
import { BookingStatus } from '../booking/entities/booking.entity';
import { RouteService } from './route.service';
import { TripService } from '../trip/trip.service';
import { BookingService } from '../booking/booking.service';

type MockRepo<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function mockQueryBuilder(overrides: Partial<Record<string, any>> = {}) {
    const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
        getCount: jest.fn().mockResolvedValue(0),
        getMany: jest.fn().mockResolvedValue([]),
        getRawMany: jest.fn().mockResolvedValue([]),
        ...overrides,
    };
    return qb;
}

describe('RouteQueueService', () => {
    let service: RouteQueueService;
    let routeQueueRepository: MockRepo<RouteQueue>;
    let queueEntryRepository: MockRepo<QueueEntry>;
    let fleetFindOne: jest.Mock;
    let routeService: Partial<Record<keyof RouteService, jest.Mock>>;
    let tripService: Partial<Record<keyof TripService, jest.Mock>>;
    let bookingService: Partial<Record<keyof BookingService, jest.Mock>>;

    let mockManager: any;
    let managerQbQueue: any[];

    const route = {
        id: 'route-1',
        saccoId: 'sacco-1',
        origin: 'NAIROBI',
        destination: 'KISUMU',
        fare: 800,
    };

    beforeEach(async () => {
        managerQbQueue = [];

        mockManager = {
            query: jest.fn().mockResolvedValue(undefined),
            createQueryBuilder: jest.fn(() => (managerQbQueue.length ? managerQbQueue.shift() : mockQueryBuilder())),
            create: jest.fn((_entity, data) => data),
            save: jest.fn(async (_entity, data) => ({ id: data.id ?? 'generated-id', ...data })),
            findOne: jest.fn(),
        };

        routeQueueRepository = {
            manager: {
                transaction: jest.fn(async (cb: (m: EntityManager) => Promise<any>) => cb(mockManager)),
            } as any,
        };

        // clockInVehicle checks the vehicle's sacco through the manager.
        fleetFindOne = jest.fn().mockResolvedValue({ id: 'vehicle-1', saccoId: 'sacco-1' });
        queueEntryRepository = {
            findOne: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn(),
            manager: {
                transaction: jest.fn(async (cb: (m: EntityManager) => Promise<any>) => cb(mockManager)),
                createQueryBuilder: jest.fn(() => mockQueryBuilder()),
                getRepository: jest.fn(() => ({ findOne: fleetFindOne })),
            } as any,
        };

        routeService = {
            findOneScoped: jest.fn().mockResolvedValue(route),
        };
        tripService = {
            createFromQueueEntry: jest.fn(),
            findByQueueEntryId: jest.fn(),
            markDeparted: jest.fn(),
            cancel: jest.fn(),
        };
        bookingService = {
            assignPendingBookingsToTrip: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RouteQueueService,
                { provide: getRepositoryToken(RouteQueue), useValue: routeQueueRepository },
                { provide: getRepositoryToken(QueueEntry), useValue: queueEntryRepository },
                { provide: RouteService, useValue: routeService },
                { provide: TripService, useValue: tripService },
                { provide: BookingService, useValue: bookingService },
            ],
        }).compile();

        service = module.get<RouteQueueService>(RouteQueueService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ─── clockInVehicle ─────────────────────────────────────────────────
    describe('clockInVehicle', () => {
        const dto = { routeId: 'route-1', vehicleId: 'vehicle-1' };

        it('takes the advisory lock on the vehicleId before anything else', async () => {
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // findOrCreateRouteQueue existing check
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // activeEntry check
                mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) }), // nextPosition
            ];

            await service.clockInVehicle(dto, 'sacco-1');

            expect(mockManager.query).toHaveBeenCalledWith(
                'SELECT pg_advisory_xact_lock(hashtext($1))',
                ['vehicle-1'],
            );
        });

        it("SECURITY: refuses to clock in a vehicle that belongs to another sacco", async () => {
            fleetFindOne.mockResolvedValue({ id: 'vehicle-1', saccoId: 'sacco-OTHER' });

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow(ForbiddenException);
            expect(mockManager.query).not.toHaveBeenCalled();
        });

        it('throws NotFoundException when the vehicle does not exist', async () => {
            fleetFindOne.mockResolvedValue(null);

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow(NotFoundException);
        });

        it('throws ForbiddenException via assertStageAccess when route does not match assignedStage', async () => {
            await expect(
                service.clockInVehicle(dto, 'sacco-1', 'KISUMU'), // route.origin is NAIROBI
            ).rejects.toThrow(ForbiddenException);
        });

        it('succeeds when assignedStage matches the route origin', async () => {
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
                mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) }),
            ];

            const result = await service.clockInVehicle(dto, 'sacco-1', 'NAIROBI');

            expect(result.status).toBe(QueueEntryStatus.WAITING);
        });

        it('creates a new RouteQueue when none exists for the route/day', async () => {
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // no existing queue
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // no active entry
                mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) }),
            ];

            await service.clockInVehicle(dto, 'sacco-1');

            expect(mockManager.create).toHaveBeenCalledWith(
                RouteQueue,
                expect.objectContaining({ routeId: 'route-1', status: RouteQueueStatus.OPEN }),
            );
        });

        it('reuses an existing OPEN RouteQueue instead of creating a duplicate', async () => {
            const existingQueue = { id: 'rq-1', routeId: 'route-1', status: RouteQueueStatus.OPEN };
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(existingQueue) }),
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
                mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(2) }),
            ];

            const result = await service.clockInVehicle(dto, 'sacco-1');

            expect(mockManager.create).not.toHaveBeenCalledWith(RouteQueue, expect.anything());
            expect(result.routeQueueId).toBe('rq-1');
            expect(result.position).toBe(3);
        });

        it('recovers from a unique-violation race by fetching the winning row', async () => {
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // no existing at check time
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // active entry check
                mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) }),
            ];
            const winnerQueue = { id: 'rq-winner', routeId: 'route-1', status: RouteQueueStatus.OPEN };
            mockManager.save.mockImplementationOnce(async () => {
                const err: any = new Error('duplicate key');
                err.code = '23505';
                throw err;
            });
            mockManager.findOne.mockResolvedValue(winnerQueue);

            const result = await service.clockInVehicle(dto, 'sacco-1');

            expect(mockManager.findOne).toHaveBeenCalledWith(RouteQueue, {
                where: { routeId: 'route-1', queueDate: expect.any(String) },
            });
            expect(result.routeQueueId).toBe('rq-winner');
        });

        it('rethrows a non-unique-violation error from RouteQueue creation', async () => {
            managerQbQueue = [mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) })];
            mockManager.save.mockImplementationOnce(async () => {
                throw new Error('connection lost');
            });

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow('connection lost');
        });

        it('throws ConflictException when the queue is CLOSED', async () => {
            managerQbQueue = [
                mockQueryBuilder({
                    getOne: jest.fn().mockResolvedValue({ id: 'rq-1', status: RouteQueueStatus.CLOSED }),
                }),
            ];

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow(ConflictException);
        });

        it('throws ConflictException when the vehicle already has an active entry (WAITING)', async () => {
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue({ id: 'rq-1', status: RouteQueueStatus.OPEN }) }),
                mockQueryBuilder({
                    getOne: jest.fn().mockResolvedValue({
                        status: QueueEntryStatus.WAITING,
                        routeQueue: { route: { origin: 'NAIROBI', destination: 'MOMBASA' } },
                    }),
                }),
            ];

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow(
                /already waiting on NAIROBI → MOMBASA/,
            );
        });

        it('throws ConflictException when the vehicle is already BOARDING elsewhere', async () => {
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue({ id: 'rq-1', status: RouteQueueStatus.OPEN }) }),
                mockQueryBuilder({
                    getOne: jest.fn().mockResolvedValue({
                        status: QueueEntryStatus.BOARDING,
                        routeQueue: { route: { origin: 'NAIROBI', destination: 'MOMBASA' } },
                    }),
                }),
            ];

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow(/already boarding/);
        });

        it('assigns position = current count + 1', async () => {
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue({ id: 'rq-1', status: RouteQueueStatus.OPEN }) }),
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
                mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(5) }),
            ];

            const result = await service.clockInVehicle(dto, 'sacco-1');

            expect(result.position).toBe(6);
            expect(result.status).toBe(QueueEntryStatus.WAITING);
        });

        // ── startBoarding: clock in and open the bay in one call ──────────
        describe('startBoarding', () => {
            // Query builders consumed, in order: existing RouteQueue, active
            // entry for this vehicle, next position, then the bay check.
            function mockQueueState(opts: { bayOccupied: boolean }) {
                managerQbQueue = [
                    mockQueryBuilder({
                        getOne: jest.fn().mockResolvedValue({ id: 'rq-1', status: RouteQueueStatus.OPEN, routeId: 'route-1', queueDate: '2026-08-31' }),
                    }),
                    mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
                    mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) }),
                    mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(opts.bayOccupied ? 1 : 0) }),
                ];
                mockManager.findOne.mockResolvedValue({ vehicle: { seatingCapacity: 14 } });
            }

            it('promotes straight to BOARDING and opens the trip when the bay is empty', async () => {
                mockQueueState({ bayOccupied: false });
                tripService.createFromQueueEntry!.mockResolvedValue({ id: 'trip-1' });

                const result = await service.clockInVehicle(
                    { ...dto, startBoarding: true },
                    'sacco-1',
                );

                expect(result.status).toBe(QueueEntryStatus.BOARDING);
                expect(tripService.createFromQueueEntry).toHaveBeenCalledWith(
                    expect.objectContaining({
                        routeId: 'route-1',
                        vehicleId: 'vehicle-1',
                        vehicleCapacity: 14,
                    }),
                    mockManager, // same transaction as the clock-in
                );
                expect(bookingService.assignPendingBookingsToTrip).toHaveBeenCalledWith(
                    { id: 'trip-1' },
                    mockManager,
                );
            });

            it('leaves the vehicle WAITING when another vehicle already holds the bay', async () => {
                mockQueueState({ bayOccupied: true });

                const result = await service.clockInVehicle(
                    { ...dto, startBoarding: true },
                    'sacco-1',
                );

                expect(result.status).toBe(QueueEntryStatus.WAITING);
                expect(tripService.createFromQueueEntry).not.toHaveBeenCalled();
            });

            it('does not touch the bay at all without the flag', async () => {
                mockQueueState({ bayOccupied: false });

                const result = await service.clockInVehicle(dto, 'sacco-1');

                expect(result.status).toBe(QueueEntryStatus.WAITING);
                expect(tripService.createFromQueueEntry).not.toHaveBeenCalled();
            });
        });
    });

    // ─── findOneQueueEntry ─────────────────────────────────────────────
    describe('findOneQueueEntry', () => {
        it('throws NotFoundException when missing', async () => {
            queueEntryRepository.findOne!.mockResolvedValue(null);

            await expect(service.findOneQueueEntry('missing')).rejects.toThrow(NotFoundException);
        });

        it('returns the entry with vehicle/routeQueue.route relations', async () => {
            const entry = { id: 'qe-1' };
            queueEntryRepository.findOne!.mockResolvedValue(entry);

            const result = await service.findOneQueueEntry('qe-1');

            expect(queueEntryRepository.findOne).toHaveBeenCalledWith({
                where: { id: 'qe-1' },
                relations: { vehicle: true, routeQueue: { route: true } },
            });
            expect(result).toEqual(entry);
        });
    });

    // ─── updateQueueEntry ──────────────────────────────────────────────
    describe('updateQueueEntry', () => {
        const baseEntry = () => ({
            id: 'qe-1',
            vehicleId: 'vehicle-1',
            status: QueueEntryStatus.WAITING,
            routeQueueId: 'rq-1',
            clockedInAt: new Date('2026-08-17T08:00:00'),
            vehicle: { seatingCapacity: 14 },
            routeQueue: {
                id: 'rq-1',
                routeId: 'route-1',
                queueDate: '2026-08-17',
                route,
            },
        });

        it('throws ForbiddenException when saccoId does not match the entry route', async () => {
            queueEntryRepository.findOne!.mockResolvedValue(baseEntry());

            await expect(
                service.updateQueueEntry('qe-1', { status: QueueEntryStatus.DISPATCHED }, 'sacco-2'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('throws ForbiddenException via assertStageAccess for a mismatched clerk stage', async () => {
            queueEntryRepository.findOne!.mockResolvedValue(baseEntry());

            await expect(
                service.updateQueueEntry('qe-1', { status: QueueEntryStatus.DISPATCHED }, 'sacco-1', 'KISUMU'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('moves the entry to a different route queue when routeId changes', async () => {
            const entry = baseEntry();
            queueEntryRepository.findOne!.mockResolvedValue(entry);
            const targetRoute = { id: 'route-2', saccoId: 'sacco-1', origin: 'NAIROBI', destination: 'ELDORET' };
            routeService.findOneScoped!.mockResolvedValueOnce(targetRoute);

            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // findOrCreateRouteQueue: no existing
                mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(1) }), // nextPosition
            ];
            // Then falls through to saveAndPromoteNextWaiting -> its own qb calls
            queueEntryRepository.manager.createQueryBuilder = jest.fn(() =>
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
            );
            tripService.findByQueueEntryId!.mockResolvedValue(null);

            await service.updateQueueEntry('qe-1', { routeId: 'route-2' }, 'sacco-1');

            expect(mockManager.create).toHaveBeenCalledWith(
                RouteQueue,
                expect.objectContaining({ routeId: 'route-2' }),
            );
            expect(entry.routeQueueId).not.toBe('rq-1');
            expect(entry.position).toBe(2);
        });

        it('throws ConflictException if the target route queue is CLOSED', async () => {
            const entry = baseEntry();
            queueEntryRepository.findOne!.mockResolvedValue(entry);
            const targetRoute = { id: 'route-2', saccoId: 'sacco-1', origin: 'NAIROBI', destination: 'ELDORET' };
            routeService.findOneScoped!.mockResolvedValueOnce(targetRoute);

            managerQbQueue = [
                mockQueryBuilder({
                    getOne: jest.fn().mockResolvedValue({ id: 'rq-2', status: RouteQueueStatus.CLOSED }),
                }),
            ];

            await expect(service.updateQueueEntry('qe-1', { routeId: 'route-2' }, 'sacco-1')).rejects.toThrow(
                ConflictException,
            );
        });

        it('does not touch routeQueueId when routeId is unchanged', async () => {
            const entry = baseEntry();
            queueEntryRepository.findOne!.mockResolvedValue(entry);
            queueEntryRepository.manager.createQueryBuilder = jest.fn(() =>
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
            );
            tripService.findByQueueEntryId!.mockResolvedValue(null);

            await service.updateQueueEntry('qe-1', { routeId: 'route-1' }, 'sacco-1');

            expect(routeService.findOneScoped).toHaveBeenCalledTimes(0); // only called for moves to a DIFFERENT route
        });

        it('directly enters BOARDING, creates a trip, and assigns pending bookings', async () => {
            const entry = baseEntry();
            queueEntryRepository.findOne!.mockResolvedValue(entry);
            const trip = { id: 'trip-1' };
            tripService.createFromQueueEntry!.mockResolvedValue(trip);

            const result = await service.updateQueueEntry(
                'qe-1',
                { status: QueueEntryStatus.BOARDING },
                'sacco-1',
            );

            expect(result.status).toBe(QueueEntryStatus.BOARDING);
            expect(tripService.createFromQueueEntry).toHaveBeenCalledWith(
                expect.objectContaining({
                    queueEntryId: 'qe-1',
                    vehicleId: 'vehicle-1',
                    saccoId: 'sacco-1',
                    fare: route.fare,
                    vehicleCapacity: 14,
                }),
                mockManager,
            );
            expect(bookingService.assignPendingBookingsToTrip).toHaveBeenCalledWith(trip, mockManager);
        });

        it('does not call assignPendingBookingsToTrip when createFromQueueEntry returns falsy', async () => {
            const entry = baseEntry();
            queueEntryRepository.findOne!.mockResolvedValue(entry);
            tripService.createFromQueueEntry!.mockResolvedValue(null);

            await service.updateQueueEntry('qe-1', { status: QueueEntryStatus.BOARDING }, 'sacco-1');

            expect(bookingService.assignPendingBookingsToTrip).not.toHaveBeenCalled();
        });

        it('falls through to saveAndPromoteNextWaiting for a non-BOARDING status transition (e.g. DISPATCHED)', async () => {
            const entry = { ...baseEntry(), status: QueueEntryStatus.BOARDING };
            queueEntryRepository.findOne!.mockResolvedValue(entry);
            queueEntryRepository.manager.createQueryBuilder = jest.fn(() =>
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }), // no next WAITING
            );
            tripService.findByQueueEntryId!.mockResolvedValue({ id: 'trip-1' });

            const result = await service.updateQueueEntry(
                'qe-1',
                { status: QueueEntryStatus.DISPATCHED },
                'sacco-1',
            );

            expect(result.status).toBe(QueueEntryStatus.DISPATCHED);
            expect(tripService.markDeparted).toHaveBeenCalledWith('trip-1', 'sacco-1', mockManager);
            expect(tripService.cancel).not.toHaveBeenCalled();
        });
    });

    // ─── saveAndPromoteNextWaiting (exercised via updateQueueEntry) ─────
    describe('saveAndPromoteNextWaiting behavior', () => {
        const entryWithTrip = () => ({
            id: 'qe-1',
            vehicleId: 'vehicle-1',
            status: QueueEntryStatus.BOARDING,
            routeQueueId: 'rq-1',
            clockedInAt: new Date('2026-08-17T08:00:00'),
            vehicle: { seatingCapacity: 14 },
            routeQueue: { id: 'rq-1', routeId: 'route-1', queueDate: '2026-08-17', route },
        });

        it('promotes the next WAITING entry to BOARDING and creates its trip', async () => {
            const entry = entryWithTrip();
            queueEntryRepository.findOne!.mockResolvedValue(entry);

            const nextWaiting = {
                id: 'qe-2',
                vehicleId: 'vehicle-2',
                vehicle: { seatingCapacity: 14 },
            };
            managerQbQueue = [
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(nextWaiting) }),
            ];
            tripService.createFromQueueEntry!.mockResolvedValue({ id: 'trip-2' });
            tripService.findByQueueEntryId!
                .mockResolvedValueOnce({ id: 'trip-2' }) // for the newly promoted entry
                .mockResolvedValueOnce(null); // existingTrip lookup for `entry` itself (DISPATCHED handling)

            await service.updateQueueEntry('qe-1', { status: QueueEntryStatus.DISPATCHED }, 'sacco-1');

            expect(nextWaiting.status).toBe(QueueEntryStatus.BOARDING);
            expect(tripService.createFromQueueEntry).toHaveBeenCalledWith(
                expect.objectContaining({ queueEntryId: 'qe-2', vehicleId: 'vehicle-2' }),
                mockManager,
            );
            expect(bookingService.assignPendingBookingsToTrip).toHaveBeenCalledWith({ id: 'trip-2' }, mockManager);
        });

        it('cancels the existing trip when the entry leaves BOARDING for a non-DISPATCHED status', async () => {
            const entry = entryWithTrip();
            queueEntryRepository.findOne!.mockResolvedValue(entry);

            queueEntryRepository.manager.createQueryBuilder = jest.fn(() =>
                mockQueryBuilder({ getOne: jest.fn().mockResolvedValue(null) }),
            );
            tripService.findByQueueEntryId!.mockResolvedValue({ id: 'trip-1' });

            await service.updateQueueEntry(
                'qe-1',
                { status: QueueEntryStatus.WAITING }, // e.g. bumped back to waiting
                'sacco-1',
            );

            expect(tripService.cancel).toHaveBeenCalledWith('trip-1', 'sacco-1', mockManager);
            expect(tripService.markDeparted).not.toHaveBeenCalled();
        });
    });

    // ─── removeVehicleFromQueue ────────────────────────────────────────
    describe('removeVehicleFromQueue', () => {
        const entry = {
            id: 'qe-1',
            vehicleId: 'vehicle-1',
            routeQueue: { route },
        };

        it('throws ForbiddenException when saccoId does not match', async () => {
            queueEntryRepository.findOne!.mockResolvedValue(entry);

            await expect(service.removeVehicleFromQueue('qe-1', 'sacco-2')).rejects.toThrow(
                ForbiddenException,
            );
        });

        it('throws ForbiddenException via assertStageAccess', async () => {
            queueEntryRepository.findOne!.mockResolvedValue(entry);

            await expect(service.removeVehicleFromQueue('qe-1', 'sacco-1', 'KISUMU')).rejects.toThrow(
                ForbiddenException,
            );
        });

        it('removes the entry and returns { deleted: true }', async () => {
            queueEntryRepository.findOne!.mockResolvedValue(entry);
            queueEntryRepository.remove!.mockResolvedValue(entry);

            const result = await service.removeVehicleFromQueue('qe-1', 'sacco-1', 'NAIROBI');

            expect(queueEntryRepository.remove).toHaveBeenCalledWith(entry);
            expect(result).toEqual({ deleted: true });
        });
    });

    // ─── findAllQueueEntries ───────────────────────────────────────────
    describe('findAllQueueEntries', () => {
        it('applies routeId/status/assignedStage filters and today as default date', async () => {
            const qb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([]) });
            queueEntryRepository.createQueryBuilder!.mockReturnValue(qb);

            await service.findAllQueueEntries({
                routeId: 'route-1',
                status: QueueEntryStatus.WAITING,
                assignedStage: 'NAIROBI',
            });

            expect(qb.andWhere).toHaveBeenCalledWith('rq.routeId = :routeId', { routeId: 'route-1' });
            expect(qb.andWhere).toHaveBeenCalledWith('qe.status = :status', {
                status: QueueEntryStatus.WAITING,
            });
            expect(qb.andWhere).toHaveBeenCalledWith('route.origin = :assignedStage', {
                assignedStage: 'NAIROBI',
            });
        });

        it('attaches seatedCount only to BOARDING entries, undefined for others', async () => {
            const entries = [
                { id: 'qe-1', status: QueueEntryStatus.BOARDING },
                { id: 'qe-2', status: QueueEntryStatus.WAITING },
            ];
            const qb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue(entries) });
            queueEntryRepository.createQueryBuilder!.mockReturnValue(qb);

            const seatedQb = mockQueryBuilder({
                getRawMany: jest
                    .fn()
                    .mockResolvedValue([{ queueEntryId: 'qe-1', seated: '7', held: '0' }]),
            });
            queueEntryRepository.manager.createQueryBuilder = jest.fn().mockReturnValue(seatedQb);

            const result = await service.findAllQueueEntries();

            expect(result[0].seatedCount).toBe(7);
            expect(result[1].seatedCount).toBeUndefined();
        });

        // A conductor deciding whether to dispatch has to be able to tell the
        // two apart: paid seats are gone, held seats may still evaporate.
        it('reports paid and in-flight seats separately for a BOARDING entry', async () => {
            const entries = [{ id: 'qe-1', status: QueueEntryStatus.BOARDING }];
            const qb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue(entries) });
            queueEntryRepository.createQueryBuilder!.mockReturnValue(qb);

            const seatedQb = mockQueryBuilder({
                getRawMany: jest
                    .fn()
                    .mockResolvedValue([{ queueEntryId: 'qe-1', seated: '13', held: '3' }]),
            });
            queueEntryRepository.manager.createQueryBuilder = jest.fn().mockReturnValue(seatedQb);

            const result = await service.findAllQueueEntries();

            expect(result[0].seatedCount).toBe(13);
            expect(result[0].heldCount).toBe(3);
        });

        it('defaults both counts to 0 for a BOARDING entry with no bookings', async () => {
            const entries = [{ id: 'qe-1', status: QueueEntryStatus.BOARDING }];
            const qb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue(entries) });
            queueEntryRepository.createQueryBuilder!.mockReturnValue(qb);

            queueEntryRepository.manager.createQueryBuilder = jest
                .fn()
                .mockReturnValue(mockQueryBuilder());

            const result = await service.findAllQueueEntries();

            expect(result[0].seatedCount).toBe(0);
            expect(result[0].heldCount).toBe(0);
        });

        it('skips the seated-count query entirely when there are no BOARDING entries', async () => {
            const entries = [{ id: 'qe-1', status: QueueEntryStatus.WAITING }];
            const qb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue(entries) });
            queueEntryRepository.createQueryBuilder!.mockReturnValue(qb);

            const managerQbSpy = jest.fn();
            queueEntryRepository.manager.createQueryBuilder = managerQbSpy;

            await service.findAllQueueEntries();

            expect(managerQbSpy).not.toHaveBeenCalled();
        });
    });

    // ─── findAvailableVehiclesForRoute ─────────────────────────────────
    describe('findAvailableVehiclesForRoute', () => {
        const targetDate = new Date('2026-08-17T00:00:00');

        it('throws ForbiddenException via assertStageAccess for a mismatched stage', async () => {
            await expect(
                service.findAvailableVehiclesForRoute('route-1', targetDate, 'sacco-1', 'KISUMU'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('returns only WAITING entries for the route/date, ordered by position', async () => {
            const qb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([{ id: 'qe-1' }]) });
            queueEntryRepository.createQueryBuilder!.mockReturnValue(qb);

            const result = await service.findAvailableVehiclesForRoute('route-1', targetDate, 'sacco-1', 'NAIROBI');

            expect(qb.where).toHaveBeenCalledWith('rq.routeId = :routeId', { routeId: 'route-1' });
            expect(qb.andWhere).toHaveBeenCalledWith('qe.status = :status', {
                status: QueueEntryStatus.WAITING,
            });
            expect(qb.orderBy).toHaveBeenCalledWith('qe.position', 'ASC');
            expect(result).toEqual([{ id: 'qe-1' }]);
        });

        it('propagates NotFoundException/ForbiddenException from routeService.findOneScoped', async () => {
            routeService.findOneScoped!.mockRejectedValue(new NotFoundException('Route not found.'));

            await expect(
                service.findAvailableVehiclesForRoute('route-x', targetDate, 'sacco-1'),
            ).rejects.toThrow(NotFoundException);
        });
    });
});