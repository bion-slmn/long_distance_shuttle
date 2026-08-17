// src/route/route.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Route } from './entities/route.entity';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

// ─── Service ──────────────────────────────────────────────────────────────────
// Route CRUD, stage management, and public route discovery/search.
// Live queue orchestration lives in RouteQueueService.
// Fill-time reporting lives in RouteAnalyticsService.

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  constructor(
    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,
  ) { }

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
    const fare = Number(dto.fare);

    if (dto.fare === undefined || dto.fare === null || isNaN(fare) || fare <= 0) {
      throw new BadRequestException('A valid fare is required.');
    }

    const route = this.routeRepository.create({
      saccoId: dto.saccoId,
      origin,
      destination,
      description: dto.description.trim(),
      stages,
      isActive: true,
      fare,
    });

    const saved = await this.routeRepository.save(route);
    this.logger.log(`Route created: ${saved.origin} → ${saved.destination} (${saved.id})`);

    // ← new: mirror the route in the opposite direction
    if (dto.createReturnLeg) {
      const returnExists = await this.routeRepository.findOne({
        where: { saccoId: dto.saccoId, origin: destination, destination: origin },
      });

      if (!returnExists) {
        const returnRoute = this.routeRepository.create({
          saccoId: dto.saccoId,
          origin: destination,       // swapped
          destination: origin,       // swapped
          description: dto.description.trim(),
          stages: [...stages].reverse(), // reverse stage order for the return trip
          isActive: true,
          fare,
        });

        const savedReturn = await this.routeRepository.save(returnRoute);
        this.logger.log(`Return leg created: ${savedReturn.origin} → ${savedReturn.destination} (${savedReturn.id})`);
      } else {
        this.logger.log(`Return leg ${destination} → ${origin} already exists — skipped.`);
      }
    }

    return saved;
  }

  // ── Find all ──────────────────────────────────────────────────────────────

  async findAll(saccoId?: string, assignedStage?: string): Promise<Route[]> {
    const where: any = { isActive: true };

    console.log('findAll called with saccoId:', saccoId, 'assignedStage:', assignedStage);

    if (saccoId) where.saccoId = saccoId;
    // A clerk only sees routes that depart from their assigned stage —
    // mirrors assertStageAccess's origin-only restriction used on writes.
    if (assignedStage) where.origin = assignedStage;

    return this.routeRepository.find({
      where,
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

    const updated = await this.routeRepository.save(route);
    this.logger.log(`Route updated: ${updated.origin} → ${updated.destination} (${updated.id})`);

    return updated;
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
    const updated = await this.routeRepository.save(route);
    this.logger.log(`Stage "${normalized}" added to route ${route.origin} → ${route.destination}`);

    return updated;
  }

  async removeStage(id: string, stage: string, saccoId?: string): Promise<Route> {
    const route = await this.findOneScoped(id, saccoId);
    const normalized = stage.trim().toUpperCase();
    route.stages = route.stages.filter(s => s !== normalized);
    const updated = await this.routeRepository.save(route);
    this.logger.log(`Stage "${normalized}" removed from route ${route.origin} → ${route.destination}`);

    return updated;
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

  // ── Distinct origins/destinations (for public search inputs) ────────────
  // Used to populate the "from" / "to" selects on the booking page before
  // a route is chosen. Only pulls from active routes.
  async getAvailableLocations(): Promise<{
    origins: string[];
    destinations: string[];
  }> {
    const origins = await this.routeRepository
      .createQueryBuilder('route')
      .select('route.origin', 'origin')
      .where('route.isActive = :isActive', { isActive: true })
      .distinct(true)
      .orderBy('route.origin', 'ASC')
      .getRawMany<{ origin: string }>();

    const destinations = await this.routeRepository
      .createQueryBuilder('route')
      .select('route.destination', 'destination')
      .where('route.isActive = :isActive', { isActive: true })
      .distinct(true)
      .orderBy('route.destination', 'ASC')
      .getRawMany<{ destination: string }>();

    return {
      origins: origins.map((o) => o.origin),
      destinations: destinations.map((d) => d.destination),
    };
  }

  // ── Search routes for a given origin/destination pair ───────────────────
  // Public booking flow: user picks from → to, this returns every sacco
  // that services that pair so the frontend can either auto-select (single
  // result) or show a sacco picker (multiple results).
  async searchRoutes(
    origin: string,
    destination: string,
  ): Promise<{
    routeId: string;
    saccoId: string;
    saccoName: string;
    origin: string;
    destination: string;
    description: string;
    stages: string[];
    fare: number;
  }[]> {
    if (!origin?.trim() || !destination?.trim()) {
      throw new BadRequestException(
        'Both origin and destination are required.',
      );
    }

    const normalizedOrigin = origin.trim().toUpperCase();
    const normalizedDestination = destination.trim().toUpperCase();

    const rows = await this.routeRepository.manager
      .createQueryBuilder()
      .select('route.id', 'routeId')
      .addSelect('route."saccoId"', 'saccoId')
      .addSelect('sacco.name', 'saccoName')
      .addSelect('route.origin', 'origin')
      .addSelect('route.destination', 'destination')
      .addSelect('route.description', 'description')
      .addSelect('route.stages', 'stages')
      .addSelect('route.fare', 'fare')
      .from('routes', 'route')
      .innerJoin('saccos', 'sacco', 'sacco.id = route."saccoId"')
      .where('route.origin = :origin', { origin: normalizedOrigin })
      .andWhere('route.destination = :destination', {
        destination: normalizedDestination,
      })
      .andWhere('route."isActive" = :isActive', { isActive: true })
      .orderBy('route.fare', 'ASC')
      .getRawMany<{
        routeId: string;
        saccoId: string;
        saccoName: string;
        origin: string;
        destination: string;
        description: string;
        stages: string[];
        fare: string;
      }>();

    return rows.map((r) => ({
      ...r,
      fare: Number(r.fare),
    }));
  }
}