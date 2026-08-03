// route-queue.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { RouteQueueService } from './route-queue.service';
import { RouteService } from './route.service';
import { RouteQueue, RouteQueueStatus } from './entities/route-queue.entity';
import { QueueEntry, QueueEntryStatus } from './entities/queue-entry.entity';
import { TripService } from 'src/trip/trip.service';
import { BookingService } from 'src/booking/booking.service';

describe('RouteQueueService', () => {
    let service: RouteQueueService;
    let queueEntryRepo: jest.Mocked<Repository<QueueEntry>>;
    let routeService: jest.Mocked<RouteService>;
    let tripService: jest.Mocked<TripService>;
    let bookingService: jest.Mocked<BookingService>;
    let manager: any;
    let qb: any;

    beforeEach(async () => {
        qb = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            innerJoinAndSelect: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn(),
            getCount: jest.fn(),
            getMany: jest.fn(),
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            groupBy: jest.fn().mockReturnThis(),
            getRawMany: jest.fn().mockResolvedValue([]),
        };

        manager = {
            createQueryBuilder: jest.fn().mockReturnValue(qb),
            create: jest.fn((_entity, data) => data),
            save: jest.fn(async (_entity, data) => data),
            findOne: jest.fn(),
            query: jest.fn().mockResolvedValue(undefined),
            transaction: jest.fn(async (cb) => cb(manager)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RouteQueueService,
                {
                    provide: getRepositoryToken(RouteQueue),
                    useValue: { manager },
                },
                {
                    provide: getRepositoryToken(QueueEntry),
                    useValue: {
                        manager,
                        findOne: jest.fn(),
                        remove: jest.fn(),
                        save: jest.fn(),
                        createQueryBuilder: jest.fn().mockReturnValue(qb),
                    },
                },
                {
                    provide: RouteService,
                    useValue: { findOneScoped: jest.fn() },
                },
                {
                    provide: TripService,
                    useValue: {
                        createFromQueueEntry: jest.fn(),
                        findByQueueEntryId: jest.fn(),
                        markDeparted: jest.fn(),
                        cancel: jest.fn(),
                    },
                },
                {
                    provide: BookingService,
                    useValue: { assignPendingBookingsToTrip: jest.fn() },
                },
            ],
        }).compile();

        service = module.get(RouteQueueService);
        queueEntryRepo = module.get(getRepositoryToken(QueueEntry));
        routeService = module.get(RouteService);
        tripService = module.get(TripService);
        bookingService = module.get(BookingService);
    });

    afterEach(() => jest.clearAllMocks());

    const activeRoute = {
        id: 'route-1',
        origin: 'NAIROBI',
        destination: 'MOMBASA',
        saccoId: 'sacco-1',
        fare: 1200,
    };

    // ── clockInVehicle ──────────────────────────────────────────────────────

    describe('clockInVehicle', () => {
        const dto = { routeId: 'route-1', vehicleId: 'v1' } as any;

        beforeEach(() => {
            routeService.findOneScoped.mockResolvedValue(activeRoute as any);
        });

        it('throws ForbiddenException via assertStageAccess when the clerk stage does not match', async () => {
            await expect(
                service.clockInVehicle(dto, 'sacco-1', 'KISUMU'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('creates a new route queue and clocks in the vehicle at position 1', async () => {
            qb.getOne
                .mockResolvedValueOnce(undefined) // findOrCreateRouteQueue: no existing queue
                .mockResolvedValueOnce(undefined); // no active entry for this vehicle
            qb.getCount.mockResolvedValue(0); // nextPosition

            const result = await service.clockInVehicle(dto, 'sacco-1');

            expect(result.position).toBe(1);
            expect(result.status).toBe(QueueEntryStatus.WAITING);
        });

        it('throws ConflictException when the queue is closed', async () => {
            qb.getOne.mockResolvedValueOnce({
                status: RouteQueueStatus.CLOSED,
            });

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow(
                ConflictException,
            );
        });

        it('throws ConflictException when the vehicle already has an active entry', async () => {
            qb.getOne
                .mockResolvedValueOnce({ id: 'rq1', status: RouteQueueStatus.OPEN })
                .mockResolvedValueOnce({
                    status: QueueEntryStatus.WAITING,
                    routeQueue: { route: { origin: 'NAIROBI', destination: 'KISUMU' } },
                });

            await expect(service.clockInVehicle(dto, 'sacco-1')).rejects.toThrow(
                ConflictException,
            );
        });

        it('recovers from a unique-violation race by fetching the winning row', async () => {
            qb.getOne
                .mockResolvedValueOnce(undefined) // no existing queue found initially
                .mockResolvedValueOnce(undefined); // no active entry
            qb.getCount.mockResolvedValue(0);
            manager.save.mockImplementationOnce(async () => {
                throw Object.assign(new Error('duplicate'), { code: '23505' });
            });
            manager.findOne.mockResolvedValue({
                id: 'rq-winner',
                status: RouteQueueStatus.OPEN,
            });

            const result = await service.clockInVehicle(dto, 'sacco-1');

            expect(manager.findOne).toHaveBeenCalled();
            expect(result).toBeDefined();
        });
    });

    // ── findOneQueueEntry ───────────────────────────────────────────────────

    describe('findOneQueueEntry', () => {
        it('returns the entry when found', async () => {
            const entry = { id: 'qe1' } as any;
            queueEntryRepo.findOne.mockResolvedValue(entry);
            await expect(service.findOneQueueEntry('qe1')).resolves.toEqual(entry);
        });

        it('throws NotFoundException when not found', async () => {
            queueEntryRepo.findOne.mockResolvedValue(null);
            await expect(service.findOneQueueEntry('missing')).rejects.toThrow(
                NotFoundException,
            );
        });
    });

    // ── updateQueueEntry ────────────────────────────────────────────────────

    describe('updateQueueEntry', () => {
        const baseEntry = () => ({
            id: 'qe1',
            routeQueueId: 'rq1',
            vehicleId: 'v1',
            status: QueueEntryStatus.WAITING,
            clockedInAt: new Date(),
            vehicle: { seatingCapacity: 14 },
            routeQueue: {
                routeId: 'route-1',
                queueDate: '2026-08-03',
                route: activeRoute,
            },
        });

        it('throws ForbiddenException for cross-sacco access', async () => {
            queueEntryRepo.findOne.mockResolvedValue(baseEntry() as any);

            await expect(
                service.updateQueueEntry('qe1', { status: QueueEntryStatus.BOARDING } as any, 'sacco-2'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('throws ForbiddenException when clerk stage does not match', async () => {
            queueEntryRepo.findOne.mockResolvedValue(baseEntry() as any);

            await expect(
                service.updateQueueEntry(
                    'qe1',
                    { status: QueueEntryStatus.BOARDING } as any,
                    'sacco-1',
                    'KISUMU',
                ),
            ).rejects.toThrow(ForbiddenException);
        });

        it('creates a trip on direct entry into BOARDING', async () => {
            const entry = baseEntry();
            queueEntryRepo.findOne.mockResolvedValue(entry as any);
            queueEntryRepo.save.mockImplementation(async (e: any) => e);
            tripService.createFromQueueEntry.mockResolvedValue({ id: 'trip-1' } as any);

            const result = await service.updateQueueEntry(
                'qe1',
                { status: QueueEntryStatus.BOARDING } as any,
                'sacco-1',
            );

            expect(tripService.createFromQueueEntry).toHaveBeenCalledWith(
                expect.objectContaining({ queueEntryId: 'qe1' }),
            );
            expect(result.status).toBe(QueueEntryStatus.BOARDING);
        });

        it('promotes the next waiting vehicle when leaving BOARDING', async () => {
            const entry = { ...baseEntry(), status: QueueEntryStatus.BOARDING };
            queueEntryRepo.findOne.mockResolvedValue(entry as any);
            manager.save.mockImplementation(async (_entity: any, data: any) => data);
            qb.getOne.mockResolvedValueOnce(undefined); // no next waiting vehicle
            tripService.findByQueueEntryId.mockResolvedValue(null);

            const result = await service.updateQueueEntry(
                'qe1',
                { status: QueueEntryStatus.DISPATCHED } as any,
                'sacco-1',
            );

            expect(manager.transaction).toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        it('marks the trip departed, scoped to the sacco, when DISPATCHED and an existing trip is found', async () => {
            const entry = { ...baseEntry(), status: QueueEntryStatus.BOARDING };
            queueEntryRepo.findOne.mockResolvedValue(entry as any);
            manager.save.mockImplementation(async (_entity: any, data: any) => data);
            qb.getOne.mockResolvedValueOnce(undefined); // no next waiting vehicle
            tripService.findByQueueEntryId.mockResolvedValue({ id: 'trip-1' } as any);
            tripService.markDeparted.mockResolvedValue({ id: 'trip-1' } as any);

            await service.updateQueueEntry(
                'qe1',
                { status: QueueEntryStatus.DISPATCHED } as any,
                'sacco-1',
            );

            expect(tripService.markDeparted).toHaveBeenCalledWith(
                'trip-1',
                activeRoute.saccoId, // 'sacco-1' — scoped, not omitted
                manager,
            );
            expect(tripService.cancel).not.toHaveBeenCalled();
        });

        it('cancels the trip, scoped to the sacco, when leaving BOARDING to a non-DISPATCHED status with an existing trip', async () => {
            const entry = { ...baseEntry(), status: QueueEntryStatus.BOARDING };
            queueEntryRepo.findOne.mockResolvedValue(entry as any);
            manager.save.mockImplementation(async (_entity: any, data: any) => data);
            qb.getOne.mockResolvedValueOnce(undefined); // no next waiting vehicle
            tripService.findByQueueEntryId.mockResolvedValue({ id: 'trip-1' } as any);
            tripService.cancel.mockResolvedValue({ id: 'trip-1' } as any);

            await service.updateQueueEntry(
                'qe1',
                { status: QueueEntryStatus.WAITING } as any,
                'sacco-1',
            );

            expect(tripService.cancel).toHaveBeenCalledWith(
                'trip-1',
                activeRoute.saccoId, // no longer passed as `undefined`
                manager,
            );
            expect(tripService.markDeparted).not.toHaveBeenCalled();
        });

        it('saves directly without promotion for a plain field update', async () => {
            const entry = baseEntry();
            queueEntryRepo.findOne.mockResolvedValue(entry as any);
            queueEntryRepo.save.mockImplementation(async (e: any) => e);

            await service.updateQueueEntry('qe1', {} as any, 'sacco-1');

            expect(queueEntryRepo.save).toHaveBeenCalled();
            expect(manager.transaction).not.toHaveBeenCalled();
        });

        it('moves the entry to a new route queue when routeId changes', async () => {
            const entry = baseEntry();
            const targetRoute = { ...activeRoute, id: 'route-2', origin: 'NAIROBI', destination: 'NAKURU' };
            queueEntryRepo.findOne.mockResolvedValue(entry as any);
            routeService.findOneScoped.mockResolvedValue(targetRoute as any);
            qb.getOne.mockResolvedValueOnce({ id: 'rq-target', status: RouteQueueStatus.OPEN });
            qb.getCount.mockResolvedValue(2);
            queueEntryRepo.save.mockImplementation(async (e: any) => e);

            const result = await service.updateQueueEntry(
                'qe1',
                { routeId: 'route-2' } as any,
                'sacco-1',
            );

            expect(result.routeQueueId).toBe('rq-target');
            expect(result.position).toBe(3);
        });

        it('throws ConflictException when target route queue is closed', async () => {
            const entry = baseEntry();
            queueEntryRepo.findOne.mockResolvedValue(entry as any);
            routeService.findOneScoped.mockResolvedValue({
                ...activeRoute,
                id: 'route-2',
            } as any);
            qb.getOne.mockResolvedValueOnce({ id: 'rq-target', status: RouteQueueStatus.CLOSED });

            await expect(
                service.updateQueueEntry('qe1', { routeId: 'route-2' } as any, 'sacco-1'),
            ).rejects.toThrow(ConflictException);
        });
    });

    // ── removeVehicleFromQueue ──────────────────────────────────────────────

    describe('removeVehicleFromQueue', () => {
        const entry = () => ({
            id: 'qe1',
            vehicleId: 'v1',
            routeQueue: { route: activeRoute },
        });

        it('removes the entry when access checks pass', async () => {
            queueEntryRepo.findOne.mockResolvedValue(entry() as any);

            const result = await service.removeVehicleFromQueue('qe1', 'sacco-1');

            expect(queueEntryRepo.remove).toHaveBeenCalled();
            expect(result).toEqual({ deleted: true });
        });

        it('throws ForbiddenException for cross-sacco removal', async () => {
            queueEntryRepo.findOne.mockResolvedValue(entry() as any);

            await expect(
                service.removeVehicleFromQueue('qe1', 'sacco-2'),
            ).rejects.toThrow(ForbiddenException);
            expect(queueEntryRepo.remove).not.toHaveBeenCalled();
        });

        it('throws ForbiddenException for stage mismatch', async () => {
            queueEntryRepo.findOne.mockResolvedValue(entry() as any);

            await expect(
                service.removeVehicleFromQueue('qe1', 'sacco-1', 'KISUMU'),
            ).rejects.toThrow(ForbiddenException);
        });
    });

    // ── findAllQueueEntries ─────────────────────────────────────────────────

    describe('findAllQueueEntries', () => {
        it('applies status, routeId, and assignedStage filters when provided', async () => {
            qb.getMany.mockResolvedValue([]);

            await service.findAllQueueEntries({
                routeId: 'route-1',
                status: QueueEntryStatus.WAITING,
                assignedStage: 'NAIROBI',
            });

            expect(qb.andWhere).toHaveBeenCalledWith('rq.routeId = :routeId', {
                routeId: 'route-1',
            });
            expect(qb.andWhere).toHaveBeenCalledWith('qe.status = :status', {
                status: QueueEntryStatus.WAITING,
            });
            expect(qb.andWhere).toHaveBeenCalledWith(
                'route.origin = :assignedStage',
                { assignedStage: 'NAIROBI' },
            );
        });

        it('attaches seatedCount only for BOARDING entries', async () => {
            qb.getMany.mockResolvedValue([
                { id: 'qe1', status: QueueEntryStatus.BOARDING },
                { id: 'qe2', status: QueueEntryStatus.WAITING },
            ]);
            qb.getRawMany = jest.fn().mockResolvedValue([
                { queueEntryId: 'qe1', count: '3' },
            ]);

            const result = await service.findAllQueueEntries();

            expect(result[0].seatedCount).toBe(3);
            expect(result[1].seatedCount).toBeUndefined();
        });

        it('returns seatedCount 0 for a BOARDING entry with no seated bookings', async () => {
            qb.getMany.mockResolvedValue([
                { id: 'qe1', status: QueueEntryStatus.BOARDING },
            ]);
            qb.getRawMany = jest.fn().mockResolvedValue([]);

            const result = await service.findAllQueueEntries();

            expect(result[0].seatedCount).toBe(0);
        });
    });

    // ── findAvailableVehiclesForRoute ───────────────────────────────────────

    describe('findAvailableVehiclesForRoute', () => {
        it('validates scope/stage access before querying', async () => {
            routeService.findOneScoped.mockResolvedValue(activeRoute as any);
            qb.getMany.mockResolvedValue([]);

            await service.findAvailableVehiclesForRoute(
                'route-1',
                new Date('2026-08-03'),
                'sacco-1',
            );

            expect(routeService.findOneScoped).toHaveBeenCalledWith('route-1', 'sacco-1');
        });

        it('throws ForbiddenException on stage mismatch', async () => {
            routeService.findOneScoped.mockResolvedValue(activeRoute as any);

            await expect(
                service.findAvailableVehiclesForRoute(
                    'route-1',
                    new Date(),
                    'sacco-1',
                    'KISUMU',
                ),
            ).rejects.toThrow(ForbiddenException);
        });

        it('filters to WAITING status only', async () => {
            routeService.findOneScoped.mockResolvedValue(activeRoute as any);
            qb.getMany.mockResolvedValue([]);

            await service.findAvailableVehiclesForRoute('route-1', new Date(), 'sacco-1');

            expect(qb.andWhere).toHaveBeenCalledWith('qe.status = :status', {
                status: QueueEntryStatus.WAITING,
            });
        });
    });
});