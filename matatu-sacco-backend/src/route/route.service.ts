// src/route/route.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Route } from './entities/route.entity';
import { QueueStatus, RouteQueue } from './entities/route-queue.entity';
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
    private readonly queueRepository: Repository<RouteQueue>,
    private readonly tripService: TripService,
  ) { }

  // ─── ROUTE QUEUE CRUD OPERATIONS ───────────────────────────────────────────

  async clockInVehicle(
    dto: CreateQueueDto,
    saccoId?: string,
    assignedStage?: string,
  ): Promise<RouteQueue> {
    const route = await this.findOneScoped(dto.routeId, saccoId);
    this.assertStageAccess(route, assignedStage);

    const targetDate = dto.clockedInAt ?? new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const activeQueueEntry = await this.queueRepository.findOne({
      where: [
        {
          vehicleId: dto.vehicleId,
          status: QueueStatus.WAITING,
          clockedInAt: Between(startOfDay, endOfDay),
        },
        {
          vehicleId: dto.vehicleId,
          status: QueueStatus.BOARDING,
          clockedInAt: Between(startOfDay, endOfDay),
        },
      ],
      relations: { route: true },
    });

    if (activeQueueEntry) {
      const statusLabel = activeQueueEntry.status === QueueStatus.WAITING ? 'waiting' : 'boarding';
      throw new ConflictException(
        `This vehicle is already ${statusLabel} on ${activeQueueEntry.route.origin} → ${activeQueueEntry.route.destination}.`,
      );
    }

    const queueEntry = this.queueRepository.create({
      routeId: route.id,
      vehicleId: dto.vehicleId,
      status: QueueStatus.WAITING,
      clockedInAt: dto.clockedInAt ?? new Date(),
    });

    return await this.queueRepository.save(queueEntry);
  }

  async findAllQueueEntries(filters?: {
    routeId?: string;
    status?: QueueStatus;
    date?: Date;
  }): Promise<RouteQueue[]> {
    // Default to "today" unless a specific date is explicitly passed —
    // keeps the live queue board from showing stale entries from prior days.
    const targetDate = filters?.date ?? new Date();

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    return await this.queueRepository.find({
      where: {
        ...(filters?.routeId && { routeId: filters.routeId }),
        ...(filters?.status && { status: filters.status }),
        clockedInAt: Between(startOfDay, endOfDay),
      },
      relations: { vehicle: true, route: true },
      order: { clockedInAt: 'DESC' },
    });
  }

  async findOneQueueEntry(id: string): Promise<RouteQueue> {
    const entry = await this.queueRepository.findOne({
      where: { id },
      relations: { vehicle: true, route: true },
    });
    if (!entry) {
      throw new NotFoundException(`Queue record with ID "${id}" not found.`);
    }
    return entry;
  }

  private async saveAndPromoteNextWaiting(entry: RouteQueue): Promise<RouteQueue> {
    return await this.queueRepository.manager.transaction(async (manager) => {
      const updated = await manager.save(RouteQueue, entry);

      const startOfDay = new Date(entry.clockedInAt);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(entry.clockedInAt);
      endOfDay.setHours(23, 59, 59, 999);

      const nextWaiting = await manager
        .createQueryBuilder(RouteQueue, 'rq')
        .where('rq.routeId = :routeId', { routeId: entry.routeId })
        .andWhere('rq.status = :status', { status: QueueStatus.WAITING })
        .andWhere('rq.clockedInAt BETWEEN :startOfDay AND :endOfDay', {
          startOfDay,
          endOfDay,
        })
        .orderBy('rq.clockedInAt', 'ASC')
        .setLock('pessimistic_write')
        .getOne();

      if (nextWaiting) {
        nextWaiting.status = QueueStatus.BOARDING;
        await manager.save(RouteQueue, nextWaiting);

        // entry.route is already loaded (relations: { route: true } on the
        // original findOneQueueEntry call) — same route, so reuse it.
        await this.tripService.createFromQueueEntry({
          queueEntryId: nextWaiting.id,
          routeId: nextWaiting.routeId,
          vehicleId: nextWaiting.vehicleId,
          saccoId: entry.route.saccoId,
          fare: entry.route.fare,
        });
      }

      // The entry that just left BOARDING — dispatch or cancel its trip.
      const existingTrip = await this.tripService.findByQueueEntryId(entry.id);
      if (existingTrip) {
        if (entry.status === QueueStatus.DISPATCHED) {
          await this.tripService.markDeparted(existingTrip.id);
        } else {
          // pulled from boarding for any other reason (cancelled, etc.)
          await this.tripService.cancel(existingTrip.id);
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
  ): Promise<RouteQueue> {
    const entry = await this.findOneQueueEntry(id);

    if (saccoId && entry.route.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to this route queue data.');
    }
    this.assertStageAccess(entry.route, assignedStage);

    const previousStatus = entry.status;

    if (dto.status !== undefined) entry.status = dto.status;
    if (dto.routeId !== undefined) entry.routeId = dto.routeId;

    // Manual/direct entry into BOARDING — e.g. an admin bypassing the
    // normal WAITING → auto-promote flow. Auto-promotion is handled
    // separately inside saveAndPromoteNextWaiting.
    const isEnteringBoardingDirectly =
      dto.status === QueueStatus.BOARDING && previousStatus !== QueueStatus.BOARDING;

    const isLeavingBoarding =
      dto.status !== undefined &&
      previousStatus === QueueStatus.BOARDING &&
      dto.status !== QueueStatus.BOARDING;

    if (isEnteringBoardingDirectly) {
      const saved = await this.queueRepository.save(entry);
      await this.tripService.createFromQueueEntry({
        queueEntryId: saved.id,
        routeId: saved.routeId,
        vehicleId: saved.vehicleId,
        saccoId: entry.route.saccoId,
        fare: entry.route.fare,
      });
      return saved;
    }

    if (!isLeavingBoarding) {
      return await this.queueRepository.save(entry);
    }

    return this.saveAndPromoteNextWaiting(entry);
  }

  async removeVehicleFromQueue(
    id: string,
    saccoId?: string,
    assignedStage?: string,
  ): Promise<{ deleted: boolean }> {
    const entry = await this.findOneQueueEntry(id);

    if (saccoId && entry.route.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to modify this route queue data.');
    }
    this.assertStageAccess(entry.route, assignedStage);

    await this.queueRepository.remove(entry);
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

  async findAvailableVehiclesForRoute(routeId: string, targetDate: Date) {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    return await this.queueRepository.find({
      where: {
        routeId: routeId,
        status: QueueStatus.WAITING,
        clockedInAt: Between(startOfDay, endOfDay),
      },
      relations: {
        vehicle: true,
      },
      order: {
        clockedInAt: 'ASC',
      },
    });
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