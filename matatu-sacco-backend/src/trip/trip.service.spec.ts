// trip.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { TripService } from './trip.service';
import { Trip, TripStatus } from './entities/trip.entity';

describe('TripService', () => {
  let service: TripService;
  let repo: jest.Mocked<Repository<Trip>>;
  let qb: any;
  let manager: any;
  let managerRepo: jest.Mocked<Repository<Trip>>;

  beforeEach(async () => {
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getManyAndCount: jest.fn(),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
    };

    managerRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    } as any;

    manager = {
      getRepository: jest.fn().mockReturnValue(managerRepo),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TripService,
        {
          provide: getRepositoryToken(Trip),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(qb),
          },
        },
      ],
    }).compile();

    service = module.get(TripService);
    repo = module.get(getRepositoryToken(Trip));
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = {
      routeId: 'route-1',
      vehicleId: 'v1',
      saccoId: 'sacco-1',
      fare: 1200,
    };

    it('throws BadRequestException when fare is missing', async () => {
      await expect(
        service.create({ ...validDto, fare: undefined } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when fare is zero or negative', async () => {
      await expect(
        service.create({ ...validDto, fare: 0 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a trip with BOARDING status', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 't1' } as any);

      await service.create(validDto as any);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          routeId: 'route-1',
          vehicleId: 'v1',
          saccoId: 'sacco-1',
          fare: 1200,
          driverId: null,
          queueEntryId: null,
          status: TripStatus.BOARDING,
        }),
      );
    });

    it('preserves provided driverId and queueEntryId', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 't1' } as any);

      await service.create({
        ...validDto,
        driverId: 'driver-1',
        queueEntryId: 'qe-1',
      } as any);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 'driver-1', queueEntryId: 'qe-1' }),
      );
    });
  });

  // ── createFromQueueEntry ────────────────────────────────────────────────

  describe('createFromQueueEntry', () => {
    const params = {
      queueEntryId: 'qe-1',
      routeId: 'route-1',
      vehicleId: 'v1',
      saccoId: 'sacco-1',
      fare: 1200,
      vehicleCapacity: 14,
      travelDate: '2026-08-03',
    };

    it('uses the injected repository when no manager is passed', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 't1' } as any);

      await service.createFromQueueEntry(params);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...params, status: TripStatus.BOARDING }),
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('uses manager.getRepository when a manager is passed', async () => {
      managerRepo.create.mockReturnValue({} as any);
      managerRepo.save.mockResolvedValue({ id: 't1' } as any);

      await service.createFromQueueEntry(params, manager);

      expect(manager.getRepository).toHaveBeenCalledWith(Trip);
      expect(managerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...params, status: TripStatus.BOARDING }),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── markDeparted ────────────────────────────────────────────────────────

  describe('markDeparted', () => {
    it('transitions a BOARDING trip to EN_ROUTE and sets departureTime', async () => {
      const trip = { id: 't1', status: TripStatus.BOARDING } as any;
      repo.findOne.mockResolvedValue(trip);
      repo.save.mockImplementation(async (t: any) => t);

      const result = await service.markDeparted('t1');

      expect(result.status).toBe(TripStatus.EN_ROUTE);
      expect(result.departureTime).toBeInstanceOf(Date);
    });

    it('throws BadRequestException when trip is not BOARDING', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        status: TripStatus.EN_ROUTE,
      } as any);

      await expect(service.markDeparted('t1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when trip does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.markDeparted('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('uses the manager-scoped repository when passed', async () => {
      const trip = { id: 't1', status: TripStatus.BOARDING } as any;
      managerRepo.findOne.mockResolvedValue(trip);
      managerRepo.save.mockImplementation(async (t: any) => t);

      await service.markDeparted('t1', undefined, manager);

      expect(managerRepo.findOne).toHaveBeenCalled();
      expect(managerRepo.save).toHaveBeenCalled();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── closeActiveTripForVehicle ───────────────────────────────────────────

  describe('closeActiveTripForVehicle', () => {
    it('returns null when there is no active trip for the vehicle', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.closeActiveTripForVehicle('v1');

      expect(result).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('marks the active trip COMPLETED and sets completedAt', async () => {
      const trip = { id: 't1', vehicleId: 'v1', status: TripStatus.EN_ROUTE } as any;
      repo.findOne.mockResolvedValue(trip);
      repo.save.mockImplementation(async (t: any) => t);

      const result = await service.closeActiveTripForVehicle('v1');

      expect(result?.status).toBe(TripStatus.COMPLETED);
      expect(result?.completedAt).toBeInstanceOf(Date);
    });

    it('searches for both BOARDING and EN_ROUTE statuses', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.closeActiveTripForVehicle('v1');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: [
          { vehicleId: 'v1', status: TripStatus.BOARDING },
          { vehicleId: 'v1', status: TripStatus.EN_ROUTE },
        ],
      });
    });
  });

  // ── updatePassengerCount ────────────────────────────────────────────────

  describe('updatePassengerCount', () => {
    it('throws BadRequestException for a negative count', async () => {
      await expect(
        service.updatePassengerCount('t1', -1, 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the passenger count when valid', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', saccoId: 'sacco-1' } as any);
      repo.save.mockImplementation(async (t: any) => t);

      const result = await service.updatePassengerCount('t1', 10, 'sacco-1');

      expect(result.passengerCount).toBe(10);
    });

    it('throws ForbiddenException for cross-sacco access', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', saccoId: 'sacco-1' } as any);

      await expect(
        service.updatePassengerCount('t1', 5, 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── findByQueueEntryId ──────────────────────────────────────────────────

  describe('findByQueueEntryId', () => {
    it('returns the trip when found via the injected repository', async () => {
      const trip = { id: 't1' } as any;
      repo.findOne.mockResolvedValue(trip);

      await expect(service.findByQueueEntryId('qe-1')).resolves.toEqual(trip);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { queueEntryId: 'qe-1' } });
    });

    it('returns null when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findByQueueEntryId('missing')).resolves.toBeNull();
    });

    it('uses the manager-scoped repository when passed', async () => {
      managerRepo.findOne.mockResolvedValue({ id: 't1' } as any);

      await service.findByQueueEntryId('qe-1', manager);

      expect(managerRepo.findOne).toHaveBeenCalledWith({ where: { queueEntryId: 'qe-1' } });
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── cancel ──────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('cancels a non-completed trip and sets completedAt', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.BOARDING,
      } as any);
      repo.save.mockImplementation(async (t: any) => t);

      const result = await service.cancel('t1', 'sacco-1');

      expect(result.status).toBe(TripStatus.CANCELLED);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('throws BadRequestException when trip is already COMPLETED', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.COMPLETED,
      } as any);

      await expect(service.cancel('t1', 'sacco-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException for cross-sacco cancel', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.BOARDING,
      } as any);

      await expect(service.cancel('t1', 'sacco-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('uses the manager-scoped repository when passed', async () => {
      managerRepo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.BOARDING,
      } as any);
      managerRepo.save.mockImplementation(async (t: any) => t);

      await service.cancel('t1', 'sacco-1', manager);

      expect(managerRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('throws ForbiddenException when neither saccoId nor isSuperAdmin is provided', async () => {
      await expect(service.findAll()).rejects.toThrow(ForbiddenException);
    });

    it('allows an unscoped query for a super admin', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await expect(
        service.findAll({ isSuperAdmin: true }),
      ).resolves.toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('filters by saccoId, routeId, vehicleId, and status when provided', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        saccoId: 'sacco-1',
        routeId: 'route-1',
        vehicleId: 'v1',
        status: TripStatus.BOARDING,
      });

      expect(qb.andWhere).toHaveBeenCalledWith('trip.saccoId = :saccoId', {
        saccoId: 'sacco-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('trip.routeId = :routeId', {
        routeId: 'route-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('trip.vehicleId = :vehicleId', {
        vehicleId: 'v1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('trip.status = :status', {
        status: TripStatus.BOARDING,
      });
    });

    it('joins fleet and filters by plateNumber when provided', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ saccoId: 'sacco-1', plateNumber: '  KDA 123  ' });

      expect(qb.innerJoin).toHaveBeenCalledWith(
        'fleet',
        'vehicle',
        'vehicle.id = trip.vehicleId',
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'vehicle."numberPlate" ILIKE :plateNumber',
        { plateNumber: '%KDA 123%' },
      );
    });

    it('filters by a date range spanning the full day when date is provided', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ saccoId: 'sacco-1', date: new Date('2026-08-03') });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trip.createdAt BETWEEN :startOfDay AND :endOfDay',
        expect.objectContaining({
          startOfDay: expect.any(Date),
          endOfDay: expect.any(Date),
        }),
      );
    });

    it('normalizes page/limit to sane defaults when zero or negative', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ saccoId: 'sacco-1', page: 0, limit: -5 });

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('computes skip based on page and limit', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ saccoId: 'sacco-1', page: 3, limit: 10 });

      expect(qb.skip).toHaveBeenCalledWith(20);
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('returns paginated data with computed totalPages', async () => {
      qb.getManyAndCount.mockResolvedValue([[{ id: 't1' }], 25]);

      const result = await service.findAll({ saccoId: 'sacco-1', page: 1, limit: 10 });

      expect(result).toEqual({
        data: [{ id: 't1' }],
        total: 25,
        page: 1,
        limit: 10,
        totalPages: 3,
      });
    });
  });

  // ── findOne / findOneScoped ─────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the trip when found', async () => {
      const trip = { id: 't1' } as any;
      repo.findOne.mockResolvedValue(trip);
      await expect(service.findOne('t1')).resolves.toEqual(trip);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('uses the manager-scoped repository when passed', async () => {
      managerRepo.findOne.mockResolvedValue({ id: 't1' } as any);
      await service.findOne('t1', manager);
      expect(managerRepo.findOne).toHaveBeenCalled();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('findOneScoped', () => {
    it('returns the trip when saccoId matches', async () => {
      const trip = { id: 't1', saccoId: 'sacco-1' } as any;
      repo.findOne.mockResolvedValue(trip);
      await expect(service.findOneScoped('t1', 'sacco-1')).resolves.toEqual(trip);
    });

    it('throws ForbiddenException when saccoId does not match', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', saccoId: 'sacco-1' } as any);
      await expect(service.findOneScoped('t1', 'sacco-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('bypasses the check when saccoId is undefined', async () => {
      const trip = { id: 't1', saccoId: 'sacco-1' } as any;
      repo.findOne.mockResolvedValue(trip);
      await expect(service.findOneScoped('t1')).resolves.toEqual(trip);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates only provided fields', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        passengerCount: 5,
        driverId: 'driver-1',
        status: TripStatus.BOARDING,
      } as any);
      repo.save.mockImplementation(async (t: any) => t);

      const result = await service.update('t1', { driverId: 'driver-2' }, 'sacco-1');

      expect(result.driverId).toBe('driver-2');
      expect(result.passengerCount).toBe(5);
    });

    it('throws BadRequestException for a negative passengerCount', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.BOARDING,
      } as any);

      await expect(
        service.update('t1', { passengerCount: -1 }, 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for cross-sacco update', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', saccoId: 'sacco-1' } as any);

      await expect(
        service.update('t1', { driverId: 'x' }, 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates status when provided', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.BOARDING,
      } as any);
      repo.save.mockImplementation(async (t: any) => t);

      const result = await service.update(
        't1',
        { status: TripStatus.EN_ROUTE },
        'sacco-1',
      );

      expect(result.status).toBe(TripStatus.EN_ROUTE);
    });
  });

  // ── getTripCountSummary ─────────────────────────────────────────────────

  describe('getTripCountSummary', () => {
    it('computes changeCount and changePercent correctly', async () => {
      qb.getCount.mockResolvedValueOnce(10).mockResolvedValueOnce(5);

      const result = await service.getTripCountSummary();

      expect(result).toEqual({
        saccoId: null,
        today: 10,
        yesterday: 5,
        changeCount: 5,
        changePercent: 100,
      });
    });

    it('returns null changePercent when yesterday is 0', async () => {
      qb.getCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

      const result = await service.getTripCountSummary();

      expect(result.changePercent).toBeNull();
      expect(result.changeCount).toBe(3);
    });

    it('scopes both queries by saccoId when provided', async () => {
      qb.getCount.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const result = await service.getTripCountSummary('sacco-1');

      expect(qb.andWhere).toHaveBeenCalledWith('trip.saccoId = :saccoId', {
        saccoId: 'sacco-1',
      });
      expect(result.saccoId).toBe('sacco-1');
    });
  });

  // ── getAverageTripsPerVehicleSummary ────────────────────────────────────

  describe('getAverageTripsPerVehicleSummary', () => {
    it('computes averages and percent change', async () => {
      qb.getRawOne
        .mockResolvedValueOnce({ tripCount: '20', vehicleCount: '4' }) // today: avg 5
        .mockResolvedValueOnce({ tripCount: '10', vehicleCount: '4' }); // yesterday: avg 2.5

      const result = await service.getAverageTripsPerVehicleSummary();

      expect(result).toEqual({
        saccoId: null,
        todayAverage: 5,
        yesterdayAverage: 2.5,
        change: 2.5,
        changePercent: 100,
      });
    });

    it('returns 0 average when there are no vehicles for that day', async () => {
      qb.getRawOne
        .mockResolvedValueOnce({ tripCount: '0', vehicleCount: '0' })
        .mockResolvedValueOnce({ tripCount: '0', vehicleCount: '0' });

      const result = await service.getAverageTripsPerVehicleSummary();

      expect(result.todayAverage).toBe(0);
      expect(result.yesterdayAverage).toBe(0);
    });

    it('returns null changePercent when yesterdayAverage is 0', async () => {
      qb.getRawOne
        .mockResolvedValueOnce({ tripCount: '10', vehicleCount: '2' }) // today: avg 5
        .mockResolvedValueOnce({ tripCount: '0', vehicleCount: '0' }); // yesterday: avg 0

      const result = await service.getAverageTripsPerVehicleSummary();

      expect(result.changePercent).toBeNull();
    });

    it('scopes both day queries by saccoId when provided', async () => {
      qb.getRawOne
        .mockResolvedValueOnce({ tripCount: '4', vehicleCount: '2' })
        .mockResolvedValueOnce({ tripCount: '2', vehicleCount: '2' });

      await service.getAverageTripsPerVehicleSummary('sacco-1');

      expect(qb.andWhere).toHaveBeenCalledWith('trip.saccoId = :saccoId', {
        saccoId: 'sacco-1',
      });
    });

    it('rounds averages, change, and changePercent to 1 decimal place', async () => {
      qb.getRawOne
        .mockResolvedValueOnce({ tripCount: '10', vehicleCount: '3' }) // 3.333...
        .mockResolvedValueOnce({ tripCount: '5', vehicleCount: '3' }); // 1.666...

      const result = await service.getAverageTripsPerVehicleSummary();

      expect(result.todayAverage).toBe(3.3);
      expect(result.yesterdayAverage).toBe(1.7);
    });
  });

  // ── remove ──────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes a non-completed trip', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.BOARDING,
      } as any);

      const result = await service.remove('t1', 'sacco-1');

      expect(repo.remove).toHaveBeenCalled();
      expect(result).toEqual({ deleted: true });
    });

    it('throws BadRequestException for a COMPLETED trip', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.COMPLETED,
      } as any);

      await expect(service.remove('t1', 'sacco-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for cross-sacco removal', async () => {
      repo.findOne.mockResolvedValue({
        id: 't1',
        saccoId: 'sacco-1',
        status: TripStatus.BOARDING,
      } as any);

      await expect(service.remove('t1', 'sacco-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  // ── getTripTrend ────────────────────────────────────────────────────────

  describe('getTripTrend', () => {
    it('throws BadRequestException when days is less than 1', async () => {
      await expect(service.getTripTrend(0)).rejects.toThrow(BadRequestException);
    });

    it('fills gap days with 0 trips', async () => {
      qb.getRawMany.mockResolvedValue([]);

      const result = await service.getTripTrend(3);

      expect(result).toHaveLength(3);
      expect(result.every((p) => p.trips === 0)).toBe(true);
    });

    it('populates counts for days that have data', async () => {
      const today = new Date().toISOString().split('T')[0];
      qb.getRawMany.mockResolvedValue([{ travelDate: today, tripCount: '7' }]);

      const result = await service.getTripTrend(1);

      expect(result).toEqual([{ date: today, trips: 7 }]);
    });

    it('scopes the query by saccoId when provided', async () => {
      qb.getRawMany.mockResolvedValue([]);

      await service.getTripTrend(7, 'sacco-1');

      expect(qb.andWhere).toHaveBeenCalledWith('trip.saccoId = :saccoId', {
        saccoId: 'sacco-1',
      });
    });

    it('returns points ordered oldest to newest', async () => {
      qb.getRawMany.mockResolvedValue([]);

      const result = await service.getTripTrend(5);

      const dates = result.map((p) => p.date);
      const sorted = [...dates].sort();
      expect(dates).toEqual(sorted);
    });
  });
});