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

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RouteService {
  constructor(
    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,

    @InjectRepository(RouteQueue)
    private readonly queueRepository: Repository<RouteQueue>,
  ) { }

  // ─── ROUTE QUEUE CRUD OPERATIONS ───────────────────────────────────────────

  async clockInVehicle(dto: CreateQueueDto, saccoId?: string): Promise<RouteQueue> {
    const route = await this.findOneScoped(dto.routeId, saccoId);

    const activeQueueEntry = await this.queueRepository.findOne({
      where: [
        { vehicleId: dto.vehicleId, status: QueueStatus.WAITING },
        { vehicleId: dto.vehicleId, status: QueueStatus.BOARDING }
      ]
    });

    if (activeQueueEntry) {
      throw new ConflictException('This vehicle is already active in a loading line-up.');
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

  async updateQueueEntry(id: string, dto: UpdateQueueDto, saccoId?: string): Promise<RouteQueue> {
    const entry = await this.findOneQueueEntry(id);

    if (saccoId && entry.route.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to this route queue data.');
    }

    if (dto.status !== undefined) entry.status = dto.status;
    if (dto.routeId !== undefined) entry.routeId = dto.routeId;

    return await this.queueRepository.save(entry);
  }

  async removeVehicleFromQueue(id: string, saccoId?: string): Promise<{ deleted: boolean }> {
    const entry = await this.findOneQueueEntry(id);

    if (saccoId && entry.route.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to modify this route queue data.');
    }

    await this.queueRepository.remove(entry);
    return { deleted: true };
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