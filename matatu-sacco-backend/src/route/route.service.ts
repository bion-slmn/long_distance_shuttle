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
import { CreateQueueDto } from './dto/create-route.dto';
import { UpdateQueueDto } from './dto/update-route.dto';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export class CreateRouteDto {
  declare origin: string;
  declare destination: string;
  declare stops?: string[];
  declare saccoId: string;
}

export class UpdateRouteDto {
  declare origin?: string;
  declare destination?: string;
  declare stops?: string[];
  declare isActive?: boolean;
}

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

  /**
   * 1. CLOCK-IN A VEHICLE (Create Queue Entry)
   * Triggers when a driver arrives at the terminal and checks into a route
   */
  async clockInVehicle(dto: CreateQueueDto, saccoId?: string): Promise<RouteQueue> {
    // Verify the route exists (and falls under the user's Sacco if scoped)
    const route = await this.findOneScoped(dto.routeId, saccoId);

    // Prevent a vehicle from double-queuing actively if it's already waiting or boarding
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

  /**
   * 2. FETCH ALL QUEUE ENTRIES (Read All)
   * Useful for logs or getting full dispatch histories
   */
  async findAllQueueEntries(filters?: { routeId?: string; status?: QueueStatus }): Promise<RouteQueue[]> {
    return await this.queueRepository.find({
      where: {
        ...(filters?.routeId && { routeId: filters.routeId }),
        ...(filters?.status && { status: filters.status }),
      },
      relations: { vehicle: true, route: true },
      order: { clockedInAt: 'DESC' },
    });
  }

  /**
   * 3. FETCH SINGLE QUEUE RECORD (Read One)
   */
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

  /**
   * 4. UPDATE QUEUE STATUS/DETAILS (Update)
   * Useful if a vehicle is manually reassigned to another route or shifts to BOARDING
   */
  async updateQueueEntry(id: string, dto: UpdateQueueDto, saccoId?: string): Promise<RouteQueue> {
    const entry = await this.findOneQueueEntry(id);

    // Security check: ensure the route belongs to the correct Sacco
    if (saccoId && entry.route.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to this route queue data.');
    }

    if (dto.status !== undefined) entry.status = dto.status;
    if (dto.routeId !== undefined) entry.routeId = dto.routeId;

    return await this.queueRepository.save(entry);
  }

  /**
   * 5. REMOVE VEHICLE FROM QUEUE (Delete / Clock-Out)
   * Triggers if a vehicle breaks down in the yard or leaves the stage prematurely
   */
  async removeVehicleFromQueue(id: string, saccoId?: string): Promise<{ deleted: boolean }> {
    const entry = await this.findOneQueueEntry(id);

    if (saccoId && entry.route.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to modify this route queue data.');
    }

    await this.queueRepository.remove(entry);
    return { deleted: true };
  }
  /**
     * Finds all available waiting vehicles for a specific route on a chosen calendar day
     */
  async findAvailableVehiclesForRoute(routeId: string, targetDate: Date) {
    // Create boundaries for the target date (from 00:00:00 to 23:59:59)
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    return await this.queueRepository.find({
      where: {
        routeId: routeId,
        status: QueueStatus.WAITING, // Only show vehicles that haven't departed or started boarding
        clockedInAt: Between(startOfDay, endOfDay), // Match the specific calendar date
      },
      relations: {
        vehicle: true, //  Tells TypeORM explicitly to join the Fleet/Vehicle relation
      }, order: {
        clockedInAt: 'ASC', // FIFO ordering! The vehicle that checked in earliest shows up first
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

    const origin = dto.origin.trim().toUpperCase();
    const destination = dto.destination.trim().toUpperCase();

    if (origin === destination) {
      throw new BadRequestException('Origin and destination cannot be the same.');
    }

    // Prevent duplicate route for the same sacco
    const exists = await this.routeRepository.findOne({
      where: { saccoId: dto.saccoId, origin, destination },
    });
    if (exists) {
      throw new ConflictException(
        `Route ${origin} → ${destination} already exists for this sacco.`
      );
    }

    // Normalize stops — uppercase, trim, remove duplicates and empty strings
    const stops = this.normalizeStops(dto.stops ?? []);

    const route = this.routeRepository.create({
      saccoId: dto.saccoId,
      origin,
      destination,
      stops,
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
    if (dto.stops !== undefined) route.stops = this.normalizeStops(dto.stops);
    if (dto.isActive !== undefined) route.isActive = dto.isActive;

    return this.routeRepository.save(route);
  }

  // ── Add / remove a stop ───────────────────────────────────────────────────

  async addStop(id: string, stop: string, saccoId?: string): Promise<Route> {
    const route = await this.findOneScoped(id, saccoId);
    const normalized = stop.trim().toUpperCase();

    if (!normalized) {
      throw new BadRequestException('Stop name cannot be empty.');
    }
    if (normalized === route.origin || normalized === route.destination) {
      throw new BadRequestException(
        'Stop cannot be the same as origin or destination.'
      );
    }
    if (route.stops.includes(normalized)) {
      throw new BadRequestException(`"${normalized}" is already a stop on this route.`);
    }

    route.stops = [...route.stops, normalized];
    return this.routeRepository.save(route);
  }

  async removeStop(id: string, stop: string, saccoId?: string): Promise<Route> {
    const route = await this.findOneScoped(id, saccoId);
    const normalized = stop.trim().toUpperCase();
    route.stops = route.stops.filter(s => s !== normalized);
    return this.routeRepository.save(route);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private normalizeStops(stops: string[]): string[] {
    return [
      ...new Set(
        stops
          .map(s => s.trim().toUpperCase())
          .filter(s => s.length > 0)
      ),
    ];
  }
}