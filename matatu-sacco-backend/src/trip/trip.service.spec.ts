import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TripService } from './trip.service';
import { Trip, TripStatus } from './entities/trip.entity';

// ─── Chainable TypeORM QueryBuilder mock ─────────────────────────────────
function createMockQueryBuilder() {
  const qb: any = {};
  const chainMethods = [
    'where',
    'andWhere',
    'orderBy',
    'groupBy',
    'select',
    'addSelect',
    'from',        // ← add this
    'skip',
    'take',
    'innerJoin',
  ];
  chainMethods.forEach((m) => (qb[m] = jest.fn().mockReturnValue(qb)));
  qb.getOne = jest.fn();
  qb.getCount = jest.fn();
  qb.getMany = jest.fn();
  qb.getManyAndCount = jest.fn();
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn();
  return qb;
}

describe('TripService', () => {
  let service: TripService;
  let tripRepository: any;

  const SACCO_A = 'sacco-a';
  const SACCO_B = 'sacco-b';

  const makeTrip = (overrides: Partial<Trip> = {}): Trip =>
    ({
      id: 'trip-1',
      routeId: 'route-1',
      vehicleId: 'vehicle-1',
      saccoId: SACCO_A,
      fare: 500,
      vehicleCapacity: 14,
      status: TripStatus.BOARDING,
      passengerCount: 0,
      ...overrides,
    }) as Trip;

  beforeEach(async () => {
    tripRepository = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 'trip-1', ...data })),
      findOne: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(),
        // create() checks route + vehicle ownership through the manager.
        getRepository: jest.fn(() => ({
          findOne: jest.fn(async ({ where }: any) =>
            where.id === 'route-1' ? { id: 'route-1', saccoId: SACCO_A }
            : where.id === 'v1' ? { id: 'v1', saccoId: SACCO_A, seatingCapacity: 14 }
            : where.id === 'route-b' ? { id: 'route-b', saccoId: SACCO_B }
            : where.id === 'v-b' ? { id: 'v-b', saccoId: SACCO_B, seatingCapacity: 14 }
            : null,
          ),
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TripService, { provide: getRepositoryToken(Trip), useValue: tripRepository }],
    }).compile();

    service = module.get<TripService>(TripService);
  });

  // Builds a fake EntityManager whose getRepository(Trip) returns a
  // manager-scoped repo, and whose own createQueryBuilder is what
  // `repo.manager.createQueryBuilder()` resolves to inside the service —
  // mirrors how repository.manager points back to its owning EntityManager.
  function createMockTransactionManager() {
    const managerScopedRepo: any = {
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ id: 'trip-1', ...data })),
      findOne: jest.fn(),
    };
    const managerMock: any = {
      createQueryBuilder: jest.fn(),
      getRepository: jest.fn(() => managerScopedRepo),
    };
    managerScopedRepo.manager = managerMock;
    return { managerMock, managerScopedRepo };
  }

  // ── create (manual/admin) ────────────────────────────────────────────────
  describe('create', () => {
    it('rejects a fare of 0', async () => {
      await expect(
        service.create({ routeId: 'route-1', vehicleId: 'v1', saccoId: SACCO_A, fare: 0 } as any),
      ).rejects.toThrow('Fare must be greater than 0.');
    });

    it('rejects a negative fare', async () => {
      await expect(
        service.create({ routeId: 'route-1', vehicleId: 'v1', saccoId: SACCO_A, fare: -10 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing fare', async () => {
      await expect(
        service.create({ routeId: 'route-1', vehicleId: 'v1', saccoId: SACCO_A } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a trip in BOARDING status with defaults for optional fields', async () => {
      const result = await service.create({
        routeId: 'route-1',
        vehicleId: 'v1',
        saccoId: SACCO_A,
        fare: 500,
      } as any);

      expect(tripRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TripStatus.BOARDING,
          driverId: null,
          queueEntryId: null,
        }),
      );
      expect(result.status).toBe(TripStatus.BOARDING);
    });

    it("SECURITY: rejects a route that belongs to another sacco", async () => {
      await expect(
        service.create({ routeId: 'route-b', vehicleId: 'v1', saccoId: SACCO_A, fare: 500 } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(tripRepository.save).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects a vehicle that belongs to another sacco", async () => {
      await expect(
        service.create({ routeId: 'route-1', vehicleId: 'v-b', saccoId: SACCO_A, fare: 500 } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(tripRepository.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown route or vehicle', async () => {
      await expect(
        service.create({ routeId: 'nope', vehicleId: 'v1', saccoId: SACCO_A, fare: 500 } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── createFromQueueEntry — manager threading ─────────────────────────────
  describe('createFromQueueEntry', () => {
    const params = {
      queueEntryId: 'qe-1',
      routeId: 'route-1',
      vehicleId: 'vehicle-1',
      saccoId: SACCO_A,
      fare: 500,
      vehicleCapacity: 14,
      travelDate: '2026-08-22',
    };

    it('creates the trip in BOARDING status via the injected repository when no manager is given', async () => {
      const result = await service.createFromQueueEntry(params);

      expect(tripRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ...params, status: TripStatus.BOARDING }),
      );
      expect(tripRepository.save).toHaveBeenCalled();
      expect(result.status).toBe(TripStatus.BOARDING);
    });

    it('uses the transaction manager\'s repository when a manager is provided', async () => {
      const { managerMock, managerScopedRepo } = createMockTransactionManager();

      await service.createFromQueueEntry(params, managerMock as unknown as EntityManager);

      expect(managerMock.getRepository).toHaveBeenCalledWith(Trip);
      expect(managerScopedRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: TripStatus.BOARDING }),
      );
      expect(managerScopedRepo.save).toHaveBeenCalled();
      // Must NOT fall back to the injected repository — that would write
      // outside the caller's transaction.
      expect(tripRepository.create).not.toHaveBeenCalled();
      expect(tripRepository.save).not.toHaveBeenCalled();
    });
  });

  // ── markDeparted ──────────────────────────────────────────────────────────
  describe('markDeparted', () => {
    it('transitions a BOARDING trip to DEPARTED and stamps departureTime', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ status: TripStatus.BOARDING }));

      const result = await service.markDeparted('trip-1');

      expect(result.status).toBe(TripStatus.DEPARTED);
      expect(tripRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: TripStatus.DEPARTED, departureTime: expect.any(Date) }),
      );
    });

    it('rejects marking departure on a trip that is not BOARDING', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ status: TripStatus.DEPARTED }));

      await expect(service.markDeparted('trip-1')).rejects.toThrow(
        'Trip is "DEPARTED", not BOARDING — cannot mark departed.',
      );
    });

    it('rejects for a CANCELLED trip too', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ status: TripStatus.CANCELLED }));

      await expect(service.markDeparted('trip-1')).rejects.toThrow(BadRequestException);
    });

    it('SECURITY: rejects when saccoId is provided and does not match the trip\'s sacco', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      await expect(service.markDeparted('trip-1', SACCO_B)).rejects.toThrow(ForbiddenException);
    });

    it('threads the manager through to findOne and save when provided', async () => {
      const { managerMock, managerScopedRepo } = createMockTransactionManager();
      managerScopedRepo.findOne.mockResolvedValue(makeTrip({ status: TripStatus.BOARDING }));

      await service.markDeparted('trip-1', undefined, managerMock as unknown as EntityManager);

      expect(managerScopedRepo.findOne).toHaveBeenCalled();
      expect(managerScopedRepo.save).toHaveBeenCalled();
      expect(tripRepository.findOne).not.toHaveBeenCalled();
      expect(tripRepository.save).not.toHaveBeenCalled();
    });
  });

  // ── updatePassengerCount ──────────────────────────────────────────────────
  describe('updatePassengerCount', () => {
    it('rejects a negative passenger count', async () => {
      await expect(service.updatePassengerCount('trip-1', -1)).rejects.toThrow(
        'Passenger count cannot be negative.',
      );
    });

    it('allows zero', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip());

      const result = await service.updatePassengerCount('trip-1', 0);

      expect(result.passengerCount).toBe(0);
    });

    it('updates the passenger count on the trip', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip());

      const result = await service.updatePassengerCount('trip-1', 9);

      expect(result.passengerCount).toBe(9);
    });

    it('SECURITY: rejects when saccoId is provided and mismatched', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      await expect(service.updatePassengerCount('trip-1', 5, SACCO_B)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── findByQueueEntryId — manager threading ───────────────────────────────
  describe('findByQueueEntryId', () => {
    it('returns null when not found, via the injected repository by default', async () => {
      tripRepository.findOne.mockResolvedValue(null);

      const result = await service.findByQueueEntryId('qe-1');

      expect(result).toBeNull();
      expect(tripRepository.findOne).toHaveBeenCalledWith({ where: { queueEntryId: 'qe-1' } });
    });

    it('uses the transaction manager\'s repository when a manager is provided', async () => {
      const { managerMock, managerScopedRepo } = createMockTransactionManager();
      managerScopedRepo.findOne.mockResolvedValue(makeTrip());

      const result = await service.findByQueueEntryId('qe-1', managerMock as unknown as EntityManager);

      expect(managerScopedRepo.findOne).toHaveBeenCalledWith({ where: { queueEntryId: 'qe-1' } });
      expect(tripRepository.findOne).not.toHaveBeenCalled();
      expect(result?.id).toBe('trip-1');
    });
  });

  // ── cancel ─────────────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('cancels a BOARDING trip and stamps completedAt', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ status: TripStatus.BOARDING }));

      const result = await service.cancel('trip-1');

      expect(result.status).toBe(TripStatus.CANCELLED);
      expect(tripRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: TripStatus.CANCELLED, completedAt: expect.any(Date) }),
      );
    });

    it('rejects cancelling a DEPARTED trip', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ status: TripStatus.DEPARTED }));

      await expect(service.cancel('trip-1')).rejects.toThrow(
        'A departed trip cannot be cancelled.',
      );
    });

    it('SECURITY: rejects when saccoId is provided and mismatched', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      await expect(service.cancel('trip-1', SACCO_B)).rejects.toThrow(ForbiddenException);
    });

    it('threads the manager through to findOne and save when provided', async () => {
      const { managerMock, managerScopedRepo } = createMockTransactionManager();
      managerScopedRepo.findOne.mockResolvedValue(makeTrip({ status: TripStatus.BOARDING }));

      await service.cancel('trip-1', undefined, managerMock as unknown as EntityManager);

      expect(managerScopedRepo.save).toHaveBeenCalled();
      expect(tripRepository.save).not.toHaveBeenCalled();
    });
  });

  // ── getPassengerCount / getPassengerCountsByTripIds ──────────────────────
  describe('getPassengerCount', () => {
    it('returns the CONFIRMED/BOARDED booking count for a trip', async () => {
      const rawQb = createMockQueryBuilder();
      rawQb.getRawOne.mockResolvedValue({ count: '7' });
      tripRepository.manager.createQueryBuilder.mockReturnValue(rawQb);

      const result = await service.getPassengerCount('trip-1');

      expect(result).toBe(7);
      expect(rawQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('booking.status IN'),
        expect.objectContaining({ statuses: ['CONFIRMED', 'BOARDED'] }),
      );
    });

    it('returns 0 when there are no matching bookings', async () => {
      const rawQb = createMockQueryBuilder();
      rawQb.getRawOne.mockResolvedValue(undefined);
      tripRepository.manager.createQueryBuilder.mockReturnValue(rawQb);

      const result = await service.getPassengerCount('trip-1');

      expect(result).toBe(0);
    });

    it('uses the transaction manager\'s raw query builder when a manager is provided', async () => {
      const { managerMock } = createMockTransactionManager();
      const rawQb = createMockQueryBuilder();
      rawQb.getRawOne.mockResolvedValue({ count: '3' });
      managerMock.createQueryBuilder.mockReturnValue(rawQb);

      const result = await service.getPassengerCount('trip-1', managerMock as unknown as EntityManager);

      expect(result).toBe(3);
      expect(tripRepository.manager.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getPassengerCountsByTripIds', () => {
    it('returns an empty map without querying when given an empty array', async () => {
      const result = await service.getPassengerCountsByTripIds([]);

      expect(result.size).toBe(0);
      expect(tripRepository.manager.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('maps each tripId to its CONFIRMED/BOARDED booking count', async () => {
      const rawQb = createMockQueryBuilder();
      rawQb.getRawMany.mockResolvedValue([
        { tripId: 'trip-1', count: '5' },
        { tripId: 'trip-2', count: '0' },
      ]);
      tripRepository.manager.createQueryBuilder.mockReturnValue(rawQb);

      const result = await service.getPassengerCountsByTripIds(['trip-1', 'trip-2']);

      expect(result.get('trip-1')).toBe(5);
      expect(result.get('trip-2')).toBe(0);
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────
  describe('findAll', () => {
    beforeEach(() => {
      // Isolate findAll's own logic from the passenger-count enrichment
      // helper, which is tested independently above.
      jest.spyOn(service, 'getPassengerCountsByTripIds').mockResolvedValue(
        new Map([['trip-1', 4]]),
      );
    });

    it('rejects an unscoped query from a non-super-admin caller', async () => {
      await expect(service.findAll({ isSuperAdmin: false })).rejects.toThrow(
        'saccoId is required unless the caller is a super admin.',
      );
    });

    it('rejects an unscoped query when saccoId and isSuperAdmin are both omitted', async () => {
      await expect(service.findAll({})).rejects.toThrow(ForbiddenException);
    });

    it('allows an unscoped query for a super admin', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[makeTrip()], 1]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({ isSuperAdmin: true });

      expect(result.total).toBe(1);
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('trip.saccoId'),
        expect.anything(),
      );
    });

    it('scopes by saccoId when provided', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ saccoId: SACCO_A });

      expect(qb.andWhere).toHaveBeenCalledWith('trip.saccoId = :saccoId', { saccoId: SACCO_A });
    });

    it('defaults to page 1, limit 20', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({ saccoId: SACCO_A });

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('computes skip correctly for later pages', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ saccoId: SACCO_A, page: 3, limit: 10 });

      expect(qb.skip).toHaveBeenCalledWith(20); // (3-1) * 10
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('falls back to defaults for a zero/negative page or limit', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ saccoId: SACCO_A, page: 0, limit: -5 });

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('computes totalPages correctly, rounding up', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 25]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({ saccoId: SACCO_A, limit: 10 });

      expect(result.totalPages).toBe(3); // ceil(25 / 10)
    });

    it('applies routeId, vehicleId and status filters', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({
        saccoId: SACCO_A,
        routeId: 'route-1',
        vehicleId: 'vehicle-1',
        status: TripStatus.DEPARTED,
      });

      expect(qb.andWhere).toHaveBeenCalledWith('trip.routeId = :routeId', { routeId: 'route-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('trip.vehicleId = :vehicleId', {
        vehicleId: 'vehicle-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('trip.status = :status', {
        status: TripStatus.DEPARTED,
      });
    });

    it('joins the fleet table and filters by plate number (trimmed) when given', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ saccoId: SACCO_A, plateNumber: '  KDA 123  ' });

      expect(qb.innerJoin).toHaveBeenCalledWith('fleet', 'vehicle', 'vehicle.id = trip.vehicleId');
      expect(qb.andWhere).toHaveBeenCalledWith(
        'vehicle."numberPlate" ILIKE :plateNumber',
        { plateNumber: '%KDA 123%' },
      );
    });

    it('does NOT join the fleet table when plateNumber is omitted', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ saccoId: SACCO_A });

      expect(qb.innerJoin).not.toHaveBeenCalled();
    });

    it('applies a full-day date range filter when date is given', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const date = new Date('2026-08-22T15:30:00Z');
      await service.findAll({ saccoId: SACCO_A, date });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trip.createdAt BETWEEN :startOfDay AND :endOfDay',
        expect.objectContaining({
          startOfDay: expect.any(Date),
          endOfDay: expect.any(Date),
        }),
      );
      const call = qb.andWhere.mock.calls.find((c: any[]) => c[0].includes('BETWEEN'));
      expect(call[1].startOfDay.getHours()).toBe(0);
      expect(call[1].endOfDay.getHours()).toBe(23);
    });

    it('enriches returned trips with live passenger counts', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[makeTrip({ id: 'trip-1', passengerCount: 0 })], 1]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({ saccoId: SACCO_A });

      expect(result.data[0].passengerCount).toBe(4); // from the spied helper
    });

    it('defaults passengerCount to 0 for trips missing from the counts map', async () => {
      const qb = createMockQueryBuilder();
      qb.getManyAndCount.mockResolvedValue([[makeTrip({ id: 'trip-unknown' })], 1]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({ saccoId: SACCO_A });

      expect(result.data[0].passengerCount).toBe(0);
    });
  });

  // ── findOne / findOneScoped ────────────────────────────────────────────────
  describe('findOne', () => {
    it('throws NotFoundException when the trip does not exist', async () => {
      tripRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });

    it('returns the trip via the injected repository by default', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip());

      const result = await service.findOne('trip-1');

      expect(result.id).toBe('trip-1');
    });

    it('uses the transaction manager\'s repository when a manager is provided', async () => {
      const { managerMock, managerScopedRepo } = createMockTransactionManager();
      managerScopedRepo.findOne.mockResolvedValue(makeTrip());

      await service.findOne('trip-1', managerMock as unknown as EntityManager);

      expect(managerScopedRepo.findOne).toHaveBeenCalled();
      expect(tripRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('findOneScoped', () => {
    it('returns the trip when no saccoId scope is given', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      const result = await service.findOneScoped('trip-1');

      expect(result.id).toBe('trip-1');
    });

    it('returns the trip when saccoId matches', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      const result = await service.findOneScoped('trip-1', SACCO_A);

      expect(result.id).toBe('trip-1');
    });

    it('SECURITY: throws ForbiddenException when saccoId does not match', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      await expect(service.findOneScoped('trip-1', SACCO_B)).rejects.toThrow(
        'You do not have access to this trip.',
      );
    });

    it('propagates NotFoundException for a missing trip before the sacco check', async () => {
      tripRepository.findOne.mockResolvedValue(null);

      await expect(service.findOneScoped('nope', SACCO_A)).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates passengerCount, driverId and status together', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip());

      const result = await service.update('trip-1', {
        passengerCount: 6,
        driverId: 'driver-1',
        status: TripStatus.DEPARTED,
      } as any);

      expect(result.passengerCount).toBe(6);
      expect(result.driverId).toBe('driver-1');
      expect(result.status).toBe(TripStatus.DEPARTED);
    });

    it('rejects a negative passengerCount', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip());

      await expect(
        service.update('trip-1', { passengerCount: -3 } as any),
      ).rejects.toThrow('Passenger count cannot be negative.');
    });

    it('leaves fields untouched when their DTO value is undefined', async () => {
      tripRepository.findOne.mockResolvedValue(
        makeTrip({ passengerCount: 9, driverId: 'existing-driver', status: TripStatus.BOARDING }),
      );

      const result = await service.update('trip-1', {} as any);

      expect(result.passengerCount).toBe(9);
      expect(result.driverId).toBe('existing-driver');
      expect(result.status).toBe(TripStatus.BOARDING);
    });

    it('allows explicitly clearing driverId with null', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ driverId: 'existing-driver' }));

      const result = await service.update('trip-1', { driverId: null } as any);

      expect(result.driverId).toBeNull();
    });

    it('SECURITY: rejects when saccoId is provided and mismatched', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      await expect(
        service.update('trip-1', { status: TripStatus.DEPARTED } as any, SACCO_B),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getTripCountSummary ──────────────────────────────────────────────────
  describe('getTripCountSummary', () => {
    it('computes changeCount and changePercent normally', async () => {
      const todayQb = createMockQueryBuilder();
      todayQb.getCount.mockResolvedValue(12);
      const yesterdayQb = createMockQueryBuilder();
      yesterdayQb.getCount.mockResolvedValue(8);
      tripRepository.createQueryBuilder
        .mockReturnValueOnce(todayQb)
        .mockReturnValueOnce(yesterdayQb);

      const result = await service.getTripCountSummary(SACCO_A);

      expect(result.today).toBe(12);
      expect(result.yesterday).toBe(8);
      expect(result.changeCount).toBe(4);
      expect(result.changePercent).toBe(50);
    });

    it('returns changePercent = null when yesterday was 0 (avoids divide-by-zero)', async () => {
      const todayQb = createMockQueryBuilder();
      todayQb.getCount.mockResolvedValue(5);
      const yesterdayQb = createMockQueryBuilder();
      yesterdayQb.getCount.mockResolvedValue(0);
      tripRepository.createQueryBuilder
        .mockReturnValueOnce(todayQb)
        .mockReturnValueOnce(yesterdayQb);

      const result = await service.getTripCountSummary(SACCO_A);

      expect(result.changePercent).toBeNull();
    });

    it('returns saccoId: null for a fleet-wide (unscoped) summary', async () => {
      const todayQb = createMockQueryBuilder();
      todayQb.getCount.mockResolvedValue(0);
      const yesterdayQb = createMockQueryBuilder();
      yesterdayQb.getCount.mockResolvedValue(0);
      tripRepository.createQueryBuilder
        .mockReturnValueOnce(todayQb)
        .mockReturnValueOnce(yesterdayQb);

      const result = await service.getTripCountSummary();

      expect(result.saccoId).toBeNull();
    });
  });

  // ── getAverageTripsPerVehicleSummary ─────────────────────────────────────
  describe('getAverageTripsPerVehicleSummary', () => {
    it('computes today/yesterday averages and rounds to 1 decimal', async () => {
      const todayQb = createMockQueryBuilder();
      todayQb.getRawOne.mockResolvedValue({ tripCount: '10', vehicleCount: '3' }); // 3.333...
      const yesterdayQb = createMockQueryBuilder();
      yesterdayQb.getRawOne.mockResolvedValue({ tripCount: '8', vehicleCount: '4' }); // 2

      tripRepository.createQueryBuilder
        .mockReturnValueOnce(todayQb)
        .mockReturnValueOnce(yesterdayQb);

      const result = await service.getAverageTripsPerVehicleSummary(SACCO_A);

      expect(result.todayAverage).toBe(3.3);
      expect(result.yesterdayAverage).toBe(2);
      expect(result.change).toBe(1.3);
      expect(result.changePercent).toBe(66.7);
    });

    it('returns 0 (not NaN/Infinity) when there are no vehicles for that day', async () => {
      const todayQb = createMockQueryBuilder();
      todayQb.getRawOne.mockResolvedValue({ tripCount: '0', vehicleCount: '0' });
      const yesterdayQb = createMockQueryBuilder();
      yesterdayQb.getRawOne.mockResolvedValue({ tripCount: '0', vehicleCount: '0' });

      tripRepository.createQueryBuilder
        .mockReturnValueOnce(todayQb)
        .mockReturnValueOnce(yesterdayQb);

      const result = await service.getAverageTripsPerVehicleSummary(SACCO_A);

      expect(result.todayAverage).toBe(0);
      expect(result.yesterdayAverage).toBe(0);
      expect(result.changePercent).toBeNull(); // yesterdayAverage is 0
    });

    it('returns saccoId: null for the fleet-wide summary', async () => {
      const qb = createMockQueryBuilder();
      qb.getRawOne.mockResolvedValue({ tripCount: '0', vehicleCount: '0' });
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAverageTripsPerVehicleSummary();

      expect(result.saccoId).toBeNull();
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────
  describe('remove', () => {
    it('removes a non-completed trip and returns { deleted: true }', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ status: TripStatus.CANCELLED }));

      const result = await service.remove('trip-1');

      expect(result).toEqual({ deleted: true });
      expect(tripRepository.remove).toHaveBeenCalled();
    });

    it('rejects deleting a DEPARTED trip', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ status: TripStatus.DEPARTED }));

      await expect(service.remove('trip-1')).rejects.toThrow(
        'Departed trips cannot be deleted.',
      );
      expect(tripRepository.remove).not.toHaveBeenCalled();
    });

    it('SECURITY: rejects when saccoId is provided and mismatched', async () => {
      tripRepository.findOne.mockResolvedValue(makeTrip({ saccoId: SACCO_A }));

      await expect(service.remove('trip-1', SACCO_B)).rejects.toThrow(ForbiddenException);
      expect(tripRepository.remove).not.toHaveBeenCalled();
    });
  });

  // ── getTripTrend ──────────────────────────────────────────────────────────
  describe('getTripTrend', () => {
    it('rejects days < 1', async () => {
      await expect(service.getTripTrend(0)).rejects.toThrow('days must be at least 1.');
    });

    it('returns exactly `days` points, oldest to newest', async () => {
      const qb = createMockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTripTrend(5);

      expect(result).toHaveLength(5);
      // strictly ascending dates
      for (let i = 1; i < result.length; i++) {
        expect(result[i].date > result[i - 1].date).toBe(true);
      }
    });

    it('fills gap days (no trips) with 0 rather than omitting them', async () => {
      const qb = createMockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]); // no rows at all
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTripTrend(3);

      expect(result.every((point) => point.trips === 0)).toBe(true);
    });

    it('maps DB rows onto the correct date', async () => {
      const today = new Date().toISOString().split('T')[0];
      const qb = createMockQueryBuilder();
      qb.getRawMany.mockResolvedValue([{ travelDate: today, tripCount: '9' }]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTripTrend(1);

      expect(result[0]).toEqual({ date: today, trips: 9 });
    });

    it('scopes to a single sacco when saccoId is given', async () => {
      const qb = createMockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getTripTrend(7, SACCO_A);

      expect(qb.andWhere).toHaveBeenCalledWith('trip.saccoId = :saccoId', { saccoId: SACCO_A });
    });

    it('does not scope by sacco when saccoId is omitted (fleet-wide)', async () => {
      const qb = createMockQueryBuilder();
      qb.getRawMany.mockResolvedValue([]);
      tripRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getTripTrend(7);

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('trip.saccoId'),
        expect.anything(),
      );
    });
  });
});