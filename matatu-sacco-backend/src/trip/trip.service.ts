// trip.service.ts
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Trip, TripStatus } from './entities/trip.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';

export interface FindAllTripsOptions {
  saccoId?: string;
  isSuperAdmin?: boolean; // must be explicitly true to allow an unscoped query
  routeId?: string;
  vehicleId?: string;
  status?: TripStatus;
  page?: number;
  limit?: number;
  date?: Date;
  plateNumber?: string;
}

export interface PaginatedTrips {
  data: Trip[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class TripService {
  constructor(
    @InjectRepository(Trip)
    private readonly tripRepository: Repository<Trip>,
  ) { }

  // Every method that can be called from inside a caller-owned transaction
  // (RouteService.saveAndPromoteNextWaiting) takes an optional `manager` and
  // resolves its repository from it. When no manager is passed, it falls back
  // to the injected repository — same behavior as before for standalone calls.
  private repo(manager?: EntityManager): Repository<Trip> {
    return manager ? manager.getRepository(Trip) : this.tripRepository;
  }

  // ── Manual/admin create ─────────────────────────────────────────────────
  async create(dto: CreateTripDto): Promise<Trip> {
    if (!dto.fare || dto.fare <= 0) {
      throw new BadRequestException('Fare must be greater than 0.');
    }

    const trip = this.tripRepository.create({
      routeId: dto.routeId,
      vehicleId: dto.vehicleId,
      saccoId: dto.saccoId,
      fare: dto.fare,
      driverId: dto.driverId ?? null,
      queueEntryId: dto.queueEntryId ?? null,
      status: TripStatus.BOARDING,
    });

    return await this.tripRepository.save(trip);
  }

  // ── Domain trigger: queue entry moves into BOARDING ─────────────────────
  async createFromQueueEntry(
    params: {
      queueEntryId: string;
      routeId: string;
      vehicleId: string;
      saccoId: string;
      fare: number;
      vehicleCapacity: number;
      travelDate: string;
    },
    manager?: EntityManager,
  ): Promise<Trip> {
    const repo = this.repo(manager);
    const trip = repo.create({
      queueEntryId: params.queueEntryId,
      routeId: params.routeId,
      vehicleId: params.vehicleId,
      saccoId: params.saccoId,
      fare: params.fare,
      vehicleCapacity: params.vehicleCapacity,
      travelDate: params.travelDate,
      status: TripStatus.BOARDING,
    });

    return await repo.save(trip);
  }

  // ── Domain trigger: queue entry moves BOARDING -> DISPATCHED ────────────
  async markDeparted(tripId: string, manager?: EntityManager): Promise<Trip> {
    const trip = await this.findOne(tripId, manager);

    if (trip.status !== TripStatus.BOARDING) {
      throw new BadRequestException(
        `Trip is "${trip.status}", not BOARDING — cannot mark departed.`,
      );
    }

    trip.status = TripStatus.EN_ROUTE;
    trip.departureTime = new Date();
    return await this.repo(manager).save(trip);
  }

  // ── Domain trigger: vehicle gets clocked into any queue again ───────────
  async closeActiveTripForVehicle(vehicleId: string, manager?: EntityManager): Promise<Trip | null> {
    const repo = this.repo(manager);
    const activeTrip = await repo.findOne({
      where: [
        { vehicleId, status: TripStatus.BOARDING },
        { vehicleId, status: TripStatus.EN_ROUTE },
      ],
    });

    if (!activeTrip) return null;

    activeTrip.status = TripStatus.COMPLETED;
    activeTrip.completedAt = new Date();
    return await repo.save(activeTrip);
  }

  // ── Passenger count — filled in as boarding progresses ──────────────────
  async updatePassengerCount(id: string, passengerCount: number, saccoId?: string): Promise<Trip> {
    if (passengerCount < 0) {
      throw new BadRequestException('Passenger count cannot be negative.');
    }
    const trip = await this.findOneScoped(id, saccoId);
    trip.passengerCount = passengerCount;
    return await this.tripRepository.save(trip);
  }

  async findByQueueEntryId(queueEntryId: string, manager?: EntityManager): Promise<Trip | null> {
    return await this.repo(manager).findOne({ where: { queueEntryId } });
  }

  // ── Manual force-close/cancel ────────────────────────────────────────────
  async cancel(id: string, saccoId?: string, manager?: EntityManager): Promise<Trip> {
    const trip = await this.findOneScoped(id, saccoId, manager);
    if (trip.status === TripStatus.COMPLETED) {
      throw new BadRequestException('A completed trip cannot be cancelled.');
    }
    trip.status = TripStatus.CANCELLED;
    trip.completedAt = new Date();
    return await this.repo(manager).save(trip);
  }

  // ── Find all (paginated, filterable) ─────────────────────────────────────
  async findAll(options: FindAllTripsOptions = {}): Promise<PaginatedTrips> {
    const {
      saccoId,
      isSuperAdmin = false,
      routeId,
      vehicleId,
      status,
      page = 1,
      limit = 20,
      date,
      plateNumber,
    } = options;

    if (!saccoId && !isSuperAdmin) {
      throw new ForbiddenException('saccoId is required unless the caller is a super admin.');
    }

    const take = limit > 0 ? limit : 20;
    const currentPage = page > 0 ? page : 1;
    const skip = (currentPage - 1) * take;

    const qb = this.tripRepository.createQueryBuilder('trip');

    if (plateNumber) {
      qb.innerJoin('fleet', 'vehicle', 'vehicle.id = trip.vehicleId');
      qb.andWhere('vehicle."numberPlate" ILIKE :plateNumber', {
        plateNumber: `%${plateNumber.trim()}%`,
      });
    }

    if (saccoId) qb.andWhere('trip.saccoId = :saccoId', { saccoId });
    if (routeId) qb.andWhere('trip.routeId = :routeId', { routeId });
    if (vehicleId) qb.andWhere('trip.vehicleId = :vehicleId', { vehicleId });
    if (status) qb.andWhere('trip.status = :status', { status });

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      qb.andWhere('trip.createdAt BETWEEN :startOfDay AND :endOfDay', { startOfDay, endOfDay });
    }

    qb.orderBy('trip.createdAt', 'DESC').skip(skip).take(take);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page: currentPage,
      limit: take,
      totalPages: Math.ceil(total / take) || 0,
    };
  }

  // ── Find one ──────────────────────────────────────────────────────────────
  async findOne(id: string, manager?: EntityManager): Promise<Trip> {
    const trip = await this.repo(manager).findOne({ where: { id } });
    if (!trip) {
      throw new NotFoundException(`Trip "${id}" not found.`);
    }
    return trip;
  }

  async findOneScoped(id: string, saccoId?: string, manager?: EntityManager): Promise<Trip> {
    const trip = await this.findOne(id, manager);
    if (saccoId && trip.saccoId !== saccoId) {
      throw new ForbiddenException('You do not have access to this trip.');
    }
    return trip;
  }

  // ── Update (generic) ─────────────────────────────────────────────────────
  async update(id: string, dto: UpdateTripDto, saccoId?: string): Promise<Trip> {
    const trip = await this.findOneScoped(id, saccoId);

    if (dto.passengerCount !== undefined) {
      if (dto.passengerCount < 0) {
        throw new BadRequestException('Passenger count cannot be negative.');
      }
      trip.passengerCount = dto.passengerCount;
    }
    if (dto.driverId !== undefined) trip.driverId = dto.driverId;
    if (dto.status !== undefined) trip.status = dto.status;

    return await this.tripRepository.save(trip);
  }

  // ── Remove ────────────────────────────────────────────────────────────────
  async remove(id: string, saccoId?: string): Promise<{ deleted: boolean }> {
    const trip = await this.findOneScoped(id, saccoId);
    if (trip.status === TripStatus.COMPLETED) {
      throw new BadRequestException('Completed trips cannot be deleted — cancel instead.');
    }
    await this.tripRepository.remove(trip);
    return { deleted: true };
  }
}