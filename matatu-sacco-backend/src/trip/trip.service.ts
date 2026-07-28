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

export interface TripTrendPoint {
  date: string;
  trips: number;
}

export interface AverageTripsPerVehicleSummary {
  saccoId: string | null;
  todayAverage: number;
  yesterdayAverage: number;
  change: number;
  changePercent: number | null;
}

export interface TripCountSummary {
  saccoId: string | null; // null = fleet-wide (all saccos)
  today: number;
  yesterday: number;
  changeCount: number;      // today - yesterday
  changePercent: number | null; // null when yesterday === 0 (can't compute %)
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

  // ── Trip counts: today vs yesterday, optionally scoped to a sacco ───────
  async getTripCountSummary(saccoId?: string): Promise<TripCountSummary> {
    const todayStr = this.formatDate(new Date());
    const yesterdayStr = this.formatDate(this.subtractDays(new Date(), 1));

    const baseQb = () => {
      const qb = this.tripRepository.createQueryBuilder('trip');
      if (saccoId) qb.andWhere('trip.saccoId = :saccoId', { saccoId });
      return qb;
    };

    const today = await baseQb()
      .andWhere('trip.travelDate = :today', { today: todayStr })
      .getCount();

    const yesterday = await baseQb()
      .andWhere('trip.travelDate = :yesterday', { yesterday: yesterdayStr })
      .getCount();

    const changeCount = today - yesterday;
    const changePercent = yesterday > 0 ? (changeCount / yesterday) * 100 : null;

    return {
      saccoId: saccoId ?? null,
      today,
      yesterday,
      changeCount,
      changePercent,
    };
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  private subtractDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
  }



  async getAverageTripsPerVehicleSummary(
    saccoId?: string,
  ): Promise<AverageTripsPerVehicleSummary> {
    const today = this.formatDate(new Date());
    const yesterday = this.formatDate(this.subtractDays(new Date(), 1));

    const getAverage = async (travelDate: string): Promise<number> => {
      const qb = this.tripRepository
        .createQueryBuilder('trip')
        .select('COUNT(*)', 'tripCount')
        .addSelect('COUNT(DISTINCT trip.vehicleId)', 'vehicleCount')
        .where('trip.travelDate = :travelDate', { travelDate });

      if (saccoId) {
        qb.andWhere('trip.saccoId = :saccoId', { saccoId });
      }

      const result = await qb.getRawOne<{
        tripCount: string;
        vehicleCount: string;
      }>();

      const trips = Number(result?.tripCount);
      const vehicles = Number(result?.vehicleCount);

      if (vehicles === 0) {
        return 0;
      }

      return trips / vehicles;
    };

    const todayAverage = await getAverage(today);
    const yesterdayAverage = await getAverage(yesterday);

    const change = todayAverage - yesterdayAverage;

    const changePercent =
      yesterdayAverage > 0
        ? (change / yesterdayAverage) * 100
        : null;

    return {
      saccoId: saccoId ?? null,
      todayAverage: Number(todayAverage.toFixed(1)),
      yesterdayAverage: Number(yesterdayAverage.toFixed(1)),
      change: Number(change.toFixed(1)),
      changePercent:
        changePercent !== null
          ? Number(changePercent.toFixed(1))
          : null,
    };
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

  // trip.service.ts — add this method



  // ── Trip Trend (for dashboard chart) ─────────────────────────────────────
  // Mirrors BookingService.getRevenueTrend — one point per day, oldest →
  // newest, gap days filled with 0 so it lines up on the same x-axis.
  async getTripTrend(days = 7, saccoId?: string): Promise<TripTrendPoint[]> {
    if (days < 1) {
      throw new BadRequestException('days must be at least 1.');
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));

    const start = this.formatDate(startDate);
    const end = this.formatDate(endDate);

    const qb = this.tripRepository
      .createQueryBuilder('trip')
      .select('trip.travelDate', 'travelDate')
      .addSelect('COUNT(*)', 'tripCount')
      .where('trip.travelDate BETWEEN :start AND :end', { start, end })
      .groupBy('trip.travelDate');

    if (saccoId) {
      qb.andWhere('trip.saccoId = :saccoId', { saccoId });
    }

    const rows = await qb.getRawMany<{ travelDate: string; tripCount: string }>();
    const tripsByDate = new Map<string, number>(rows.map((r) => [r.travelDate, Number(r.tripCount)]));

    const trend: TripTrendPoint[] = [];
    const cursor = new Date(startDate);
    while (this.formatDate(cursor) <= end) {
      const date = this.formatDate(cursor);
      trend.push({ date, trips: tripsByDate.get(date) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    return trend;
  }
}