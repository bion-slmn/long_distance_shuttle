// fleet.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError, ILike, SelectQueryBuilder } from 'typeorm';
import { Fleet, VehicleStatus } from './entities/fleet.entity';
import { QueueEntryStatus } from 'src/route/entities/queue-entry.entity';

// ─── DTOs ─────────────────────────────────────────────────────────────────────


export interface FindAllFleetOptions {
  saccoId?: string;
  status?: VehicleStatus;
  page?: number;
  limit?: number;
  minimalFields?: boolean;
  search?: string;
  withQueueStatus?: boolean;
}

type FleetListItem = Omit<Fleet, 'generateId'> & {
  queue?: {
    status: QueueEntryStatus;
    clockedInAt: Date;
    route: {
      id: string;
      origin: string;
      destination: string;
    };
  } | null;
};

export interface PaginatedFleet {
  data: FleetListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class CreateFleetDto {
  declare numberPlate: string;
  declare seatingCapacity: number;
  declare saccoId: string;
  declare notes?: string;
}

export class UpdateFleetDto {
  declare numberPlate?: string;
  declare seatingCapacity?: number;
  declare status?: VehicleStatus;
  declare notes?: string;
}




// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FleetService {
  constructor(
    @InjectRepository(Fleet)
    private readonly fleetRepository: Repository<Fleet>,
  ) { }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(dto: CreateFleetDto): Promise<Fleet> {
    if (!dto.numberPlate?.trim()) {
      throw new BadRequestException('Number plate is required.');
    }
    if (!dto.seatingCapacity || dto.seatingCapacity < 1) {
      throw new BadRequestException('Seating capacity must be at least 1.');
    }

    const vehicle = this.fleetRepository.create({
      numberPlate: dto.numberPlate.trim().toUpperCase(),
      seatingCapacity: dto.seatingCapacity,
      saccoId: dto.saccoId,
      notes: dto.notes?.trim() ?? null,
      status: VehicleStatus.ACTIVE,
    });

    try {
      return await this.fleetRepository.save(vehicle);
    } catch (err) {
      this.handleUniqueViolation(err);
    }
  }



  async findAll(options: FindAllFleetOptions = {}): Promise<PaginatedFleet> {
    const {
      saccoId,
      status,
      page = 1,
      limit = 20,
      minimalFields = false,
      search,
      withQueueStatus = false,
    } = options;

    const take = limit > 0 ? limit : 20;
    const currentPage = page > 0 ? page : 1;
    const skip = (currentPage - 1) * take;

    const qb = this.fleetRepository.createQueryBuilder('fleet');

    if (minimalFields) {
      qb.select(['fleet.id', 'fleet.numberPlate']);
    }

    if (saccoId) {
      qb.andWhere('fleet.saccoId = :saccoId', { saccoId });
    }

    if (status) {
      qb.andWhere('fleet.status = :status', { status });
    }

    if (search?.trim()) {
      qb.andWhere('fleet.numberPlate ILIKE :search', { search: `%${search.trim()}%` });
    }

    if (withQueueStatus) {
      this.addQueueStatusJoin(qb);
    }

    qb.orderBy('fleet.numberPlate', 'ASC').skip(skip).take(take);

    const total = await qb.getCount();
    const data = withQueueStatus
      ? await this.getManyWithQueueStatus(qb)
      : await qb.getMany();

    return {
      data,
      total,
      page: currentPage,
      limit: take,
      totalPages: Math.ceil(total / take) || 0,
    };
  }

  // Finds each vehicle's most recent queue_entries row for TODAY's
  // route_queues (queueDate = today), joined through to the route it
  // belongs to. Split across two tables now: queue_entries holds the
  // per-vehicle status/clockedInAt, route_queues holds which route+day
  // that entry belongs to.
  private addQueueStatusJoin(qb: SelectQueryBuilder<Fleet>): void {
    const today = new Date().toISOString().slice(0, 10);

    qb.leftJoin(
      (subQb) =>
        subQb
          .select('qe.*')
          .addSelect('rq."routeId"', 'routeId')
          .addSelect(
            'ROW_NUMBER() OVER (PARTITION BY qe."vehicleId" ORDER BY qe."clockedInAt" DESC)',
            'rn',
          )
          .from('queue_entries', 'qe')
          .innerJoin('route_queues', 'rq', 'rq.id = qe."routeQueueId"')
          .where('rq."queueDate" = :today'),
      'latest_entry',
      'latest_entry."vehicleId" = fleet.id AND latest_entry.rn = 1',
    )
      .leftJoin('routes', 'queue_route', 'queue_route.id = latest_entry."routeId"')
      .addSelect('latest_entry.status', 'queueStatus')
      .addSelect('latest_entry."routeId"', 'queueRouteId')
      .addSelect('queue_route.origin', 'queueOrigin')
      .addSelect('queue_route.destination', 'queueDestination')
      .addSelect('latest_entry."clockedInAt"', 'queueClockedInAt')
      .setParameter('today', today);
  }

  private async getManyWithQueueStatus(qb: SelectQueryBuilder<Fleet>): Promise<FleetListItem[]> {
    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((entity, i) => {
      const row = raw[i];

      const queue = row?.queueStatus
        ? {
          status: row.queueStatus as QueueEntryStatus,
          clockedInAt: row.queueClockedInAt,
          route: {
            id: row.queueRouteId,
            origin: row.queueOrigin,
            destination: row.queueDestination,
          },
        }
        : null;

      return {
        ...entity,
        queue,
      };
    });
  }

  // ── Find by status ────────────────────────────────────────────────────────

  async findByStatus(status: VehicleStatus, saccoId?: string): Promise<Fleet[]> {
    return this.fleetRepository.find({
      where: saccoId ? { status, saccoId } : { status },
      order: { numberPlate: 'ASC' },
    });
  }

  // ── Find one ──────────────────────────────────────────────────────────────

  async findOne(id: string): Promise<Fleet> {
    const vehicle = await this.fleetRepository.findOne({ where: { id } });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle "${id}" not found.`);
    }
    return vehicle;
  }

  async findOneScoped(id: string, saccoId?: string): Promise<Fleet> {
    const vehicle = await this.findOne(id);
    if (saccoId && vehicle.saccoId !== saccoId) {
      throw new ForbiddenException('You do not have access to this vehicle.');
    }
    return vehicle;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateFleetDto, saccoId?: string): Promise<Fleet> {
    const vehicle = await this.findOneScoped(id, saccoId);

    if (dto.numberPlate !== undefined) {
      vehicle.numberPlate = dto.numberPlate.trim().toUpperCase();
    }
    if (dto.seatingCapacity !== undefined) {
      if (dto.seatingCapacity < 1) {
        throw new BadRequestException('Seating capacity must be at least 1.');
      }
      vehicle.seatingCapacity = dto.seatingCapacity;
    }
    if (dto.status !== undefined) vehicle.status = dto.status;
    if (dto.notes !== undefined) vehicle.notes = dto.notes?.trim() ?? null;

    try {
      return await this.fleetRepository.save(vehicle);
    } catch (err) {
      this.handleUniqueViolation(err);
    }
  }

  // ── Status shortcuts ──────────────────────────────────────────────────────

  async setStatus(
    id: string,
    status: VehicleStatus,
    saccoId?: string,
  ): Promise<Fleet> {
    const vehicle = await this.findOneScoped(id, saccoId);
    vehicle.status = status;
    return this.fleetRepository.save(vehicle);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private handleUniqueViolation(err: unknown): never {
    if (err instanceof QueryFailedError && (err as any).code === '23505') {
      throw new BadRequestException(
        'A vehicle with this number plate already exists.',
      );
    }
    throw err;
  }
}