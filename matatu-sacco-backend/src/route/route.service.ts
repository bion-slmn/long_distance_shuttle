// src/route/route.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Route } from './entities/route.entity';

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
  ) { }

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