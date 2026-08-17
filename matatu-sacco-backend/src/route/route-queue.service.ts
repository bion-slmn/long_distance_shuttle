// src/route/route-queue.service.ts
import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Route } from './entities/route.entity';
import { RouteQueue, RouteQueueStatus } from './entities/route-queue.entity';
import { QueueEntry, QueueEntryStatus } from './entities/queue-entry.entity';
import { CreateQueueDto } from './dto/create-route.dto';
import { UpdateQueueDto } from './dto/update-route.dto';
import { BookingService } from 'src/booking/booking.service';
import { BookingStatus } from 'src/booking/entities/booking.entity';
import { RouteService } from './route.service';
import { TripService } from 'src/trip/trip.service';

// ─── Service ──────────────────────────────────────────────────────────────────
// Live queue orchestration: clocking vehicles in, promoting the next
// WAITING vehicle to BOARDING, moving/removing queue entries, and
// stage-scoped visibility for clerks. Route CRUD lives in RouteService.

@Injectable()
export class RouteQueueService {
    private readonly logger = new Logger(RouteQueueService.name);

    constructor(
        @InjectRepository(RouteQueue)
        private readonly routeQueueRepository: Repository<RouteQueue>,

        @InjectRepository(QueueEntry)
        private readonly queueEntryRepository: Repository<QueueEntry>,

        private readonly routeService: RouteService,
        private readonly tripService: TripService,
        private readonly bookingService: BookingService,
    ) { }

    // "date" column is a plain YYYY-MM-DD string — this is what makes
    // "one queue per route per day" a meaningful, queryable business key.
    private toDateString(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    // Finds today's (or targetDate's) queue for a route, creating it if it
    // doesn't exist yet. Locks the row so concurrent clock-ins can't both
    // race to create duplicate queues for the same route+day.
    private async findOrCreateRouteQueue(
        manager: EntityManager,
        routeId: string,
        targetDate: Date,
    ): Promise<RouteQueue> {
        const queueDate = this.toDateString(targetDate);

        const existing = await manager
            .createQueryBuilder(RouteQueue, 'rq')
            .where('rq.routeId = :routeId', { routeId })
            .andWhere('rq.queueDate = :queueDate', { queueDate })
            .setLock('pessimistic_write')
            .getOne();

        if (existing) return existing;

        const created = manager.create(RouteQueue, {
            routeId,
            queueDate,
            status: RouteQueueStatus.OPEN,
        });

        try {
            return await manager.save(RouteQueue, created);
        } catch (err: any) {
            // Lost the race to another concurrent clock-in — fetch the row
            // the other transaction just created instead of erroring out.
            if (err?.code === '23505') {
                const winner = await manager.findOne(RouteQueue, {
                    where: { routeId, queueDate },
                });
                if (winner) return winner;
            }
            throw err;
        }
    }

    async clockInVehicle(
        dto: CreateQueueDto,
        saccoId?: string,
        assignedStage?: string,
    ): Promise<QueueEntry> {
        const route = await this.routeService.findOneScoped(dto.routeId, saccoId);
        this.assertStageAccess(route, assignedStage);

        const clockedInAt = dto.clockedInAt ?? new Date();

        return await this.queueEntryRepository.manager.transaction(async (manager) => {
            // Serialize ALL clock-in attempts for this vehicle, across ANY route,
            // for the lifetime of this transaction. This closes the gap the
            // RouteQueue row lock alone can't cover: two clock-ins for the same
            // vehicle on two DIFFERENT routes lock two different RouteQueue rows,
            // so neither would otherwise block the other. Auto-released on
            // commit/rollback — nothing to manually unlock.
            await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dto.vehicleId]);

            const routeQueue = await this.findOrCreateRouteQueue(manager, route.id, clockedInAt);

            if (routeQueue.status === RouteQueueStatus.CLOSED) {
                throw new ConflictException(
                    `Today's queue for ${route.origin} → ${route.destination} is closed.`,
                );
            }

            // A vehicle can only hold one active slot (WAITING/BOARDING) across
            // ANY route queue that day — a vehicle can't queue on two routes at once.
            const activeEntry = await manager
                .createQueryBuilder(QueueEntry, 'qe')
                .innerJoinAndSelect('qe.routeQueue', 'rq')
                .innerJoinAndSelect('rq.route', 'route')
                .where('qe.vehicleId = :vehicleId', { vehicleId: dto.vehicleId })
                .andWhere('qe.status IN (:...statuses)', {
                    statuses: [QueueEntryStatus.WAITING, QueueEntryStatus.BOARDING],
                })
                .andWhere('rq.queueDate = :queueDate', {
                    queueDate: this.toDateString(clockedInAt),
                })
                .getOne();

            if (activeEntry) {
                const statusLabel =
                    activeEntry.status === QueueEntryStatus.WAITING ? 'waiting' : 'boarding';
                throw new ConflictException(
                    `This vehicle is already ${statusLabel} on ${activeEntry.routeQueue.route.origin} → ${activeEntry.routeQueue.route.destination}.`,
                );
            }

            const nextPosition = await manager
                .createQueryBuilder(QueueEntry, 'qe')
                .where('qe.routeQueueId = :routeQueueId', { routeQueueId: routeQueue.id })
                .getCount();

            const entry = manager.create(QueueEntry, {
                routeQueueId: routeQueue.id,
                vehicleId: dto.vehicleId,
                status: QueueEntryStatus.WAITING,
                position: nextPosition + 1,
                clockedInAt,
            });

            const saved = await manager.save(QueueEntry, entry);

            this.logger.log(`Vehicle ${saved.vehicleId} clocked in to queue ${saved.id} on route ${route.origin} → ${route.destination} at position ${saved.position}`);

            return saved;
        });
    }

    async findOneQueueEntry(id: string): Promise<QueueEntry> {
        const entry = await this.queueEntryRepository.findOne({
            where: { id },
            relations: { vehicle: true, routeQueue: { route: true } },
        });
        if (!entry) {
            throw new NotFoundException(`Queue record with ID "${id}" not found.`);
        }
        return entry;
    }

    private async saveAndPromoteNextWaiting(entry: QueueEntry): Promise<QueueEntry> {
        return await this.queueEntryRepository.manager.transaction(async (manager) => {
            const updated = await manager.save(QueueEntry, entry);

            const nextWaiting = await manager
                .createQueryBuilder(QueueEntry, 'qe')
                .where('qe.routeQueueId = :routeQueueId', { routeQueueId: entry.routeQueueId })
                .andWhere('qe.status = :status', { status: QueueEntryStatus.WAITING })
                .orderBy('qe.position', 'ASC')
                .setLock('pessimistic_write')
                .getOne();

            if (nextWaiting) {
                nextWaiting.status = QueueEntryStatus.BOARDING;
                await manager.save(QueueEntry, nextWaiting);

                const trip = await this.tripService.createFromQueueEntry(
                    {
                        queueEntryId: nextWaiting.id,
                        routeId: entry.routeQueue.routeId,
                        vehicleId: nextWaiting.vehicleId,
                        saccoId: entry.routeQueue.route.saccoId,
                        fare: entry.routeQueue.route.fare,
                        vehicleCapacity: nextWaiting.vehicle.seatingCapacity,
                        travelDate: entry.routeQueue.queueDate,
                    },
                    manager,
                );

                this.logger.log(`Trip ${trip?.id} created for queue entry ${nextWaiting.id} on route ${entry.routeQueue.route.origin} → ${entry.routeQueue.route.destination}`);

                // ← new: pull any pre-booked, PAID, AWAITING_TRIP bookings onto
                // this vehicle now, capped at its seat capacity.
                const newTrip = await this.tripService.findByQueueEntryId(nextWaiting.id, manager);
                if (newTrip) {
                    await this.bookingService.assignPendingBookingsToTrip(newTrip, manager);
                    this.logger.log(`Bookings assigned to trip ${newTrip.id}`);
                }
            }

            const existingTrip = await this.tripService.findByQueueEntryId(entry.id, manager);
            if (existingTrip) {
                if (entry.status === QueueEntryStatus.DISPATCHED) {
                    await this.tripService.markDeparted(
                        existingTrip.id,
                        entry.routeQueue.route.saccoId,
                        manager,
                    );
                    this.logger.log(`Trip ${existingTrip.id} marked as departed`);
                } else {
                    await this.tripService.cancel(
                        existingTrip.id,
                        entry.routeQueue.route.saccoId,
                        manager,
                    );
                    this.logger.log(`Trip ${existingTrip.id} cancelled`);
                }
            }

            return updated;
        });
    }

    async updateQueueEntry(
        id: string,
        dto: UpdateQueueDto,
        saccoId?: string,
        assignedStage?: string,
    ): Promise<QueueEntry> {
        const entry = await this.findOneQueueEntry(id);
        const currentRoute = entry.routeQueue.route;

        if (saccoId && currentRoute.saccoId !== saccoId) {
            throw new ForbiddenException('Access denied to this route queue data.');
        }
        this.assertStageAccess(currentRoute, assignedStage);

        const previousStatus = entry.status;

        // Moving a vehicle to a different route means moving it to that
        // route's queue for the same day — not just flipping a foreign key.
        if (dto.routeId !== undefined && dto.routeId !== entry.routeQueue.routeId) {
            const targetRoute = await this.routeService.findOneScoped(dto.routeId, saccoId);
            this.assertStageAccess(targetRoute, assignedStage);

            await this.queueEntryRepository.manager.transaction(async (manager) => {
                const targetQueue = await this.findOrCreateRouteQueue(
                    manager,
                    targetRoute.id,
                    entry.clockedInAt,
                );

                if (targetQueue.status === RouteQueueStatus.CLOSED) {
                    throw new ConflictException(
                        `Today's queue for ${targetRoute.origin} → ${targetRoute.destination} is closed.`,
                    );
                }

                const nextPosition = await manager
                    .createQueryBuilder(QueueEntry, 'qe')
                    .where('qe.routeQueueId = :routeQueueId', { routeQueueId: targetQueue.id })
                    .getCount();

                entry.routeQueueId = targetQueue.id;
                entry.position = nextPosition + 1;
            });
        }

        if (dto.status !== undefined) entry.status = dto.status;

        // Manual/direct entry into BOARDING — e.g. an admin bypassing the
        // normal WAITING → auto-promote flow. Auto-promotion is handled
        // separately inside saveAndPromoteNextWaiting.
        const isEnteringBoardingDirectly =
            dto.status === QueueEntryStatus.BOARDING && previousStatus !== QueueEntryStatus.BOARDING;

        const isLeavingBoarding =
            dto.status !== undefined &&
            previousStatus === QueueEntryStatus.BOARDING &&
            dto.status !== QueueEntryStatus.BOARDING;

        if (isEnteringBoardingDirectly) {
            return await this.queueEntryRepository.manager.transaction(async (manager) => {
                const saved = await manager.save(QueueEntry, entry);
                const trip = await this.tripService.createFromQueueEntry(
                    {
                        queueEntryId: saved.id,
                        routeId: entry.routeQueue.routeId,
                        vehicleId: saved.vehicleId,
                        saccoId: currentRoute.saccoId,
                        fare: currentRoute.fare,
                        vehicleCapacity: entry.vehicle.seatingCapacity,
                        travelDate: entry.routeQueue.queueDate,
                    },
                    manager, // ← pass the transactional manager here too
                );

                this.logger.log(`Trip ${trip?.id} created for queue entry ${saved.id} via direct boarding on route ${currentRoute.origin} → ${currentRoute.destination}`);

                if (trip) {
                    await this.bookingService.assignPendingBookingsToTrip(trip, manager);
                    this.logger.log(`Bookings assigned to trip ${trip.id}`);
                }

                return saved;
            });
        }

        return this.saveAndPromoteNextWaiting(entry);
    }

    async removeVehicleFromQueue(
        id: string,
        saccoId?: string,
        assignedStage?: string,
    ): Promise<{ deleted: boolean }> {
        const entry = await this.findOneQueueEntry(id);
        const route = entry.routeQueue.route;

        if (saccoId && route.saccoId !== saccoId) {
            throw new ForbiddenException('Access denied to modify this route queue data.');
        }
        this.assertStageAccess(route, assignedStage);

        await this.queueEntryRepository.remove(entry);
        this.logger.log(`Vehicle ${entry.vehicleId} removed from queue ${id} on route ${route.origin} → ${route.destination}`);

        return { deleted: true };
    }

    // A clerk is stationed at one physical stage (e.g. "NAIROBI") and may
    // only act on queue entries whose route departs FROM that stage.
    // Example: a Nairobi clerk can touch NAIROBI → KISUMU entries, but not
    // KISUMU → NAIROBI entries, even though both may belong to the same
    // sacco. `assignedStage` is undefined for callers that aren't
    // stage-scoped (e.g. an admin/superuser path), matching the existing
    // optional-saccoId convention used elsewhere in this service.
    private assertStageAccess(route: Route, assignedStage?: string): void {
        if (!assignedStage) return;
        if (route.origin !== assignedStage) {
            throw new ForbiddenException(
                `This route departs from "${route.origin}" — you are assigned to "${assignedStage}".`,
            );
        }
    }

    async findAllQueueEntries(filters?: {
        routeId?: string;
        status?: QueueEntryStatus;
        date?: Date;
        assignedStage?: string; // ← new
    }): Promise<(QueueEntry & { seatedCount?: number })[]> {
        const queueDate = this.toDateString(filters?.date ?? new Date());

        const qb = this.queueEntryRepository
            .createQueryBuilder('qe')
            .innerJoinAndSelect('qe.routeQueue', 'rq')
            .innerJoinAndSelect('rq.route', 'route')
            .innerJoinAndSelect('qe.vehicle', 'vehicle')
            .where('rq.queueDate = :queueDate', { queueDate });

        if (filters?.routeId) {
            qb.andWhere('rq.routeId = :routeId', { routeId: filters.routeId });
        }
        if (filters?.status) {
            qb.andWhere('qe.status = :status', { status: filters.status });
        }
        if (filters?.assignedStage) {
            qb.andWhere('route.origin = :assignedStage', { assignedStage: filters.assignedStage });
        }

        const entries = await qb.orderBy('qe.position', 'ASC').getMany();

        // Only BOARDING entries have a live Trip worth counting seats for —
        // WAITING has no trip yet, DISPATCHED's trip is already closed out.
        const boardingIds = entries
            .filter((e) => e.status === QueueEntryStatus.BOARDING)
            .map((e) => e.id);

        const seatedCounts = await this.getSeatedCountsByQueueEntry(boardingIds);

        return entries.map((e) =>
            Object.assign(e, {
                seatedCount:
                    e.status === QueueEntryStatus.BOARDING
                        ? seatedCounts.get(e.id) ?? 0
                        : undefined,
            }),
        );
    }

    // Single joined query: queueEntry -> trip -> booking, grouped by
    // queueEntryId. Replaces what would otherwise be a per-entry round trip
    // through TripService then BookingService for each boarding vehicle.
    private async getSeatedCountsByQueueEntry(
        queueEntryIds: string[],
    ): Promise<Map<string, number>> {
        if (queueEntryIds.length === 0) return new Map();

        const rows = await this.queueEntryRepository.manager
            .createQueryBuilder()
            .select('trip."queueEntryId"', 'queueEntryId')
            .addSelect('COUNT(booking.id)', 'count')
            .from('trips', 'trip')
            .innerJoin('bookings', 'booking', 'booking."tripId" = trip.id')
            .where('trip."queueEntryId" IN (:...ids)', { ids: queueEntryIds })
            .andWhere('booking.status IN (:...statuses)', {
                statuses: [BookingStatus.CONFIRMED, BookingStatus.BOARDED],
            })
            .groupBy('trip."queueEntryId"')
            .getRawMany<{ queueEntryId: string; count: string }>();

        return new Map(rows.map((r) => [r.queueEntryId, parseInt(r.count, 10)]));
    }

    async findAvailableVehiclesForRoute(
        routeId: string,
        targetDate: Date,
        saccoId?: string,
        assignedStage?: string, // ← new
    ): Promise<QueueEntry[]> {
        const queueDate = this.toDateString(targetDate);

        // Validates access AND stage in one shot, using the same helpers
        // already used elsewhere — no duplicate logic.
        const route = await this.routeService.findOneScoped(routeId, saccoId);
        this.assertStageAccess(route, assignedStage);

        return this.queueEntryRepository
            .createQueryBuilder('qe')
            .innerJoin('qe.routeQueue', 'rq')
            .innerJoinAndSelect('qe.vehicle', 'vehicle')
            .where('rq.routeId = :routeId', { routeId })
            .andWhere('rq.queueDate = :queueDate', { queueDate })
            .andWhere('qe.status = :status', { status: QueueEntryStatus.WAITING })
            .orderBy('qe.position', 'ASC')
            .getMany();
    }
}