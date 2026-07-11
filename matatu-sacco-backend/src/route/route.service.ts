// src/route/route.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Route } from './entities/route.entity';
import { RouteQueue, RouteQueueStatus } from './entities/route-queue.entity';
import { QueueEntry, QueueEntryStatus } from './entities/queue-entry.entity';
import { CreateQueueDto, CreateRouteDto } from './dto/create-route.dto';
import { UpdateQueueDto, UpdateRouteDto } from './dto/update-route.dto';
import { TripService } from 'src/trip/trip.service';

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RouteService {
  constructor(
    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,

    @InjectRepository(RouteQueue)
    private readonly routeQueueRepository: Repository<RouteQueue>,

    @InjectRepository(QueueEntry)
    private readonly queueEntryRepository: Repository<QueueEntry>,

    private readonly tripService: TripService,
  ) { }

  // ─── ROUTE QUEUE CRUD OPERATIONS ───────────────────────────────────────────

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
    const route = await this.findOneScoped(dto.routeId, saccoId);
    this.assertStageAccess(route, assignedStage);

    const clockedInAt = dto.clockedInAt ?? new Date();

    return await this.queueEntryRepository.manager.transaction(async (manager) => {
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

      return manager.save(QueueEntry, entry);
    });
  }

  async findAllQueueEntries(filters?: {
    routeId?: string;
    status?: QueueEntryStatus;
    date?: Date;
  }): Promise<QueueEntry[]> {
    // Default to "today" unless a specific date is explicitly passed —
    // keeps the live queue board from showing stale entries from prior days.
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

    return qb.orderBy('qe.position', 'ASC').getMany();
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

        await this.tripService.createFromQueueEntry(
          {
            queueEntryId: nextWaiting.id,
            routeId: entry.routeQueue.routeId,
            vehicleId: nextWaiting.vehicleId,
            saccoId: entry.routeQueue.route.saccoId,
            fare: entry.routeQueue.route.fare,
          },
          manager, // ← was missing
        );
      }

      const existingTrip = await this.tripService.findByQueueEntryId(entry.id, manager); // ← was missing
      if (existingTrip) {
        if (entry.status === QueueEntryStatus.DISPATCHED) {
          await this.tripService.markDeparted(existingTrip.id, manager); // ← was missing
        } else {
          await this.tripService.cancel(existingTrip.id, undefined, manager); // ← was missing
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
      const targetRoute = await this.findOneScoped(dto.routeId, saccoId);
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
      const saved = await this.queueEntryRepository.save(entry);
      await this.tripService.createFromQueueEntry({
        queueEntryId: saved.id,
        routeId: entry.routeQueue.routeId,
        vehicleId: saved.vehicleId,
        saccoId: currentRoute.saccoId,
        fare: currentRoute.fare,
      });
      return saved;
    }

    if (!isLeavingBoarding) {
      return await this.queueEntryRepository.save(entry);
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

  async findAvailableVehiclesForRoute(
    routeId: string,
    targetDate: Date,
  ): Promise<QueueEntry[]> {
    const queueDate = this.toDateString(targetDate);

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

  // ── Create ────────────────────────────────────────────────────────────────

  async create(dto: CreateRouteDto): Promise<Route> {
    if (!dto.origin?.trim()) {
      throw new BadRequestException('Origin is required.');
    }
    if (!dto.destination?.trim()) {
      throw new BadRequestException('Destination is required.');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('Description is required.');
    }

    const origin = dto.origin.trim().toUpperCase();
    const destination = dto.destination.trim().toUpperCase();

    if (origin === destination) {
      throw new BadRequestException('Origin and destination cannot be the same.');
    }

    const exists = await this.routeRepository.findOne({
      where: { saccoId: dto.saccoId, origin, destination },
    });
    if (exists) {
      throw new ConflictException(
        `Route ${origin} → ${destination} already exists for this sacco.`
      );
    }

    const stages = this.normalizeStages(dto.stages ?? []);

    const route = this.routeRepository.create({
      saccoId: dto.saccoId,
      origin,
      destination,
      description: dto.description.trim(),
      stages,
      isActive: true,
    });

    return this.routeRepository.save(route);
  }

  // ── Find all ──────────────────────────────────────────────────────────────

  async findAll(saccoId?: string): Promise<Route[]> {
    return this.routeRepository.find({
      where: saccoId
        ? { saccoId, isActive: true }
        : { isActive: true },
      order: { origin: 'ASC', destination: 'ASC' },
    });
  }

  // ── Find one ──────────────────────────────────────────────────────────────

  async findOne(id: string): Promise<Route> {
    const route = await this.routeRepository.findOne({ where: { id } });
    if (!route) {
      throw new NotFoundException(`Route "${id}" not found.`);
    }
    return route;
  }

  async findOneScoped(id: string, saccoId?: string): Promise<Route> {
    const route = await this.findOne(id);
    if (saccoId && route.saccoId !== saccoId) {
      throw new ForbiddenException('You do not have access to this route.');
    }
    return route;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateRouteDto, saccoId?: string): Promise<Route> {
    const route = await this.findOneScoped(id, saccoId);

    if (dto.origin !== undefined) {
      route.origin = dto.origin.trim().toUpperCase();
    }
    if (dto.destination !== undefined) {
      route.destination = dto.destination.trim().toUpperCase();
    }
    if (route.origin === route.destination) {
      throw new BadRequestException('Origin and destination cannot be the same.');
    }
    if (dto.description !== undefined) {
      route.description = dto.description.trim();
    }
    if (dto.stages !== undefined) route.stages = this.normalizeStages(dto.stages);
    if (dto.isActive !== undefined) route.isActive = dto.isActive;

    return this.routeRepository.save(route);
  }

  // ── Add / remove a stage ──────────────────────────────────────────────────

  async addStage(id: string, stage: string, saccoId?: string): Promise<Route> {
    const route = await this.findOneScoped(id, saccoId);
    const normalized = stage.trim().toUpperCase();

    if (!normalized) {
      throw new BadRequestException('Stage name cannot be empty.');
    }
    if (normalized === route.origin || normalized === route.destination) {
      throw new BadRequestException(
        'Stage cannot be the same as origin or destination.'
      );
    }
    if (route.stages.includes(normalized)) {
      throw new BadRequestException(`"${normalized}" is already a stage on this route.`);
    }

    route.stages = [...route.stages, normalized];
    return this.routeRepository.save(route);
  }

  async removeStage(id: string, stage: string, saccoId?: string): Promise<Route> {
    const route = await this.findOneScoped(id, saccoId);
    const normalized = stage.trim().toUpperCase();
    route.stages = route.stages.filter(s => s !== normalized);
    return this.routeRepository.save(route);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private normalizeStages(stages: string[]): string[] {
    return [
      ...new Set(
        stages
          .map(s => s.trim().toUpperCase())
          .filter(s => s.length > 0)
      ),
    ];
  }
}