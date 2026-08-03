// fleet.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { FleetService, CreateFleetDto, UpdateFleetDto } from './fleet.service';
import { Fleet, VehicleStatus } from './entities/fleet.entity';

describe('FleetService', () => {
  let service: FleetService;
  let repo: jest.Mocked<Repository<Fleet>>;
  let qb: any;

  beforeEach(async () => {
    // Chainable query builder mock — every method returns `qb` itself
    qb = {
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getMany: jest.fn(),
      getRawAndEntities: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FleetService,
        {
          provide: getRepositoryToken(Fleet),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(qb),
          },
        },
      ],
    }).compile();

    service = module.get(FleetService);
    repo = module.get(getRepositoryToken(Fleet));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto: CreateFleetDto = {
      numberPlate: 'kda 123x',
      seatingCapacity: 14,
      saccoId: 'sacco-1',
    };

    it('trims and uppercases the number plate before saving', async () => {
      repo.create.mockReturnValue({ ...validDto } as any);
      repo.save.mockResolvedValue({ id: 'v1' } as any);

      await service.create(validDto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ numberPlate: 'KDA 123X' }),
      );
    });

    it('defaults status to ACTIVE and notes to null when omitted', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 'v1' } as any);

      await service.create(validDto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: VehicleStatus.ACTIVE, notes: null }),
      );
    });

    it('trims notes when provided', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 'v1' } as any);

      await service.create({ ...validDto, notes: '  spare tyre missing  ' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'spare tyre missing' }),
      );
    });

    it('throws BadRequestException when numberPlate is empty', async () => {
      await expect(
        service.create({ ...validDto, numberPlate: '' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when numberPlate is only whitespace', async () => {
      await expect(
        service.create({ ...validDto, numberPlate: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when seatingCapacity is 0', async () => {
      await expect(
        service.create({ ...validDto, seatingCapacity: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when seatingCapacity is negative', async () => {
      await expect(
        service.create({ ...validDto, seatingCapacity: -3 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates a unique-violation DB error into BadRequestException', async () => {
      repo.create.mockReturnValue({} as any);
      const dbError = Object.assign(
        new QueryFailedError('INSERT', [], new Error('duplicate key')),
        { code: '23505' },
      );
      repo.save.mockRejectedValue(dbError);

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(validDto)).rejects.toThrow(
        /already exists/,
      );
    });

    it('rethrows non-unique-violation DB errors untouched', async () => {
      repo.create.mockReturnValue({} as any);
      const dbError = Object.assign(
        new QueryFailedError('INSERT', [], new Error('connection lost')),
        { code: '08006' },
      );
      repo.save.mockRejectedValue(dbError);

      await expect(service.create(validDto)).rejects.toThrow(QueryFailedError);
    });

    it('rethrows non-QueryFailedError errors untouched', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockRejectedValue(new Error('unexpected'));

      await expect(service.create(validDto)).rejects.toThrow('unexpected');
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    beforeEach(() => {
      qb.getCount.mockResolvedValue(0);
      qb.getMany.mockResolvedValue([]);
    });

    it('defaults page to 1 and limit to 20 when omitted', async () => {
      await service.findAll();

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('computes skip correctly for page > 1', async () => {
      await service.findAll({ page: 3, limit: 10 });

      expect(qb.skip).toHaveBeenCalledWith(20); // (3-1)*10
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('falls back to limit 20 when limit is 0 or negative', async () => {
      await service.findAll({ limit: -5 });
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('falls back to page 1 when page is 0 or negative', async () => {
      await service.findAll({ page: -1 });
      expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('filters by saccoId when provided', async () => {
      await service.findAll({ saccoId: 'sacco-1' });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'fleet.saccoId = :saccoId',
        { saccoId: 'sacco-1' },
      );
    });

    it('does not filter by saccoId when omitted', async () => {
      await service.findAll({});
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('saccoId'),
        expect.anything(),
      );
    });

    it('filters by status when provided', async () => {
      await service.findAll({ status: VehicleStatus.MAINTENANCE });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'fleet.status = :status',
        { status: VehicleStatus.MAINTENANCE },
      );
    });

    it('applies ILIKE search filter, trimmed', async () => {
      await service.findAll({ search: '  kda  ' });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'fleet.numberPlate ILIKE :search',
        { search: '%kda%' },
      );
    });

    it('does not apply search filter for a whitespace-only search string', async () => {
      await service.findAll({ search: '   ' });
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });

    it('selects minimal fields when minimalFields is true', async () => {
      await service.findAll({ minimalFields: true });
      expect(qb.select).toHaveBeenCalledWith(['fleet.id', 'fleet.numberPlate']);
    });

    it('does not select minimal fields by default', async () => {
      await service.findAll({});
      expect(qb.select).not.toHaveBeenCalled();
    });

    it('returns totalPages 0 when total is 0', async () => {
      qb.getCount.mockResolvedValue(0);
      const result = await service.findAll({});
      expect(result.totalPages).toBe(0);
    });

    it('computes totalPages correctly, rounding up', async () => {
      qb.getCount.mockResolvedValue(45);
      const result = await service.findAll({ limit: 20 });
      expect(result.totalPages).toBe(3); // ceil(45/20)
    });

    it('uses getMany when withQueueStatus is false', async () => {
      await service.findAll({ withQueueStatus: false });
      expect(qb.getMany).toHaveBeenCalled();
      expect(qb.getRawAndEntities).not.toHaveBeenCalled();
      expect(qb.leftJoin).not.toHaveBeenCalled();
    });

    it('joins queue status and uses getRawAndEntities when withQueueStatus is true', async () => {
      qb.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] });

      await service.findAll({ withQueueStatus: true });

      expect(qb.leftJoin).toHaveBeenCalled();
      expect(qb.getRawAndEntities).toHaveBeenCalled();
      expect(qb.getMany).not.toHaveBeenCalled();
    });

    it('maps queue data onto entities when a queue row exists', async () => {
      const entity = { id: 'v1', numberPlate: 'KDA 123X' };
      const rawRow = {
        queueStatus: 'WAITING',
        queueClockedInAt: new Date('2026-08-03T06:00:00Z'),
        queueRouteId: 'route-1',
        queueOrigin: 'Nairobi',
        queueDestination: 'Mombasa',
      };
      qb.getRawAndEntities.mockResolvedValue({ entities: [entity], raw: [rawRow] });

      const result = await service.findAll({ withQueueStatus: true });

      expect(result.data[0].queue).toEqual({
        status: 'WAITING',
        clockedInAt: rawRow.queueClockedInAt,
        route: { id: 'route-1', origin: 'Nairobi', destination: 'Mombasa' },
      });
    });

    it('sets queue to null when the vehicle has no queue entry today', async () => {
      const entity = { id: 'v1', numberPlate: 'KDA 123X' };
      const rawRow = { queueStatus: null };
      qb.getRawAndEntities.mockResolvedValue({ entities: [entity], raw: [rawRow] });

      const result = await service.findAll({ withQueueStatus: true });

      expect(result.data[0].queue).toBeNull();
    });

    it('handles a missing raw row (index mismatch) gracefully as null queue', async () => {
      const entity = { id: 'v1', numberPlate: 'KDA 123X' };
      qb.getRawAndEntities.mockResolvedValue({ entities: [entity], raw: [] });

      const result = await service.findAll({ withQueueStatus: true });

      expect(result.data[0].queue).toBeNull();
    });
  });

  // ── findByStatus ────────────────────────────────────────────────────────

  describe('findByStatus', () => {
    it('queries by status only when saccoId is omitted', async () => {
      repo.find.mockResolvedValue([]);
      await service.findByStatus(VehicleStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: { status: VehicleStatus.ACTIVE },
        order: { numberPlate: 'ASC' },
      });
    });

    it('queries by status and saccoId when saccoId is provided', async () => {
      repo.find.mockResolvedValue([]);
      await service.findByStatus(VehicleStatus.ACTIVE, 'sacco-1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { status: VehicleStatus.ACTIVE, saccoId: 'sacco-1' },
        order: { numberPlate: 'ASC' },
      });
    });
  });

  // ── findOne ─────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the vehicle when found', async () => {
      const vehicle = { id: 'v1' } as any;
      repo.findOne.mockResolvedValue(vehicle);

      await expect(service.findOne('v1')).resolves.toEqual(vehicle);
    });

    it('throws NotFoundException when the vehicle does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findOneScoped ───────────────────────────────────────────────────────

  describe('findOneScoped', () => {
    it('returns the vehicle when saccoId is omitted (SUPER_ADMIN)', async () => {
      const vehicle = { id: 'v1', saccoId: 'sacco-1' } as any;
      repo.findOne.mockResolvedValue(vehicle);

      await expect(service.findOneScoped('v1')).resolves.toEqual(vehicle);
    });

    it('returns the vehicle when saccoId matches', async () => {
      const vehicle = { id: 'v1', saccoId: 'sacco-1' } as any;
      repo.findOne.mockResolvedValue(vehicle);

      await expect(
        service.findOneScoped('v1', 'sacco-1'),
      ).resolves.toEqual(vehicle);
    });

    it('throws ForbiddenException when saccoId does not match', async () => {
      const vehicle = { id: 'v1', saccoId: 'sacco-1' } as any;
      repo.findOne.mockResolvedValue(vehicle);

      await expect(
        service.findOneScoped('v1', 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException before checking sacco ownership if vehicle does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.findOneScoped('missing', 'sacco-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    const existingVehicle = () => ({
      id: 'v1',
      saccoId: 'sacco-1',
      numberPlate: 'KDA 000A',
      seatingCapacity: 14,
      status: VehicleStatus.ACTIVE,
      notes: 'old note',
    });

    it('updates only the fields provided, leaving others untouched', async () => {
      const vehicle = existingVehicle();
      repo.findOne.mockResolvedValue(vehicle as any);
      repo.save.mockImplementation(async (v) => v as any);

      const result = await service.update('v1', { seatingCapacity: 20 }, 'sacco-1');

      expect(result.seatingCapacity).toBe(20);
      expect(result.numberPlate).toBe('KDA 000A'); // untouched
    });

    it('trims and uppercases numberPlate on update', async () => {
      const vehicle = existingVehicle();
      repo.findOne.mockResolvedValue(vehicle as any);
      repo.save.mockImplementation(async (v) => v as any);

      const result = await service.update(
        'v1',
        { numberPlate: '  kdb 111z  ' },
        'sacco-1',
      );

      expect(result.numberPlate).toBe('KDB 111Z');
    });

    it('throws BadRequestException when seatingCapacity is updated below 1', async () => {
      repo.findOne.mockResolvedValue(existingVehicle() as any);

      await expect(
        service.update('v1', { seatingCapacity: 0 }, 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('sets notes to null when explicitly cleared', async () => {
      const vehicle = existingVehicle();
      repo.findOne.mockResolvedValue(vehicle as any);
      repo.save.mockImplementation(async (v) => v as any);

      const result = await service.update('v1', { notes: '   ' }, 'sacco-1');

      expect(result.notes).toBeNull();
    });

    it('throws ForbiddenException when updating a vehicle outside the caller sacco', async () => {
      repo.findOne.mockResolvedValue(existingVehicle() as any);

      await expect(
        service.update('v1', { seatingCapacity: 20 }, 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('translates a unique-violation error on save into BadRequestException', async () => {
      repo.findOne.mockResolvedValue(existingVehicle() as any);
      const dbError = Object.assign(
        new QueryFailedError('UPDATE', [], new Error('duplicate')),
        { code: '23505' },
      );
      repo.save.mockRejectedValue(dbError);

      await expect(
        service.update('v1', { numberPlate: 'KDB 111Z' }, 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── setStatus ───────────────────────────────────────────────────────────

  describe('setStatus', () => {
    it('updates the status and saves', async () => {
      const vehicle = { id: 'v1', saccoId: 'sacco-1', status: VehicleStatus.ACTIVE };
      repo.findOne.mockResolvedValue(vehicle as any);
      repo.save.mockImplementation(async (v) => v as any);

      const result = await service.setStatus(
        'v1',
        VehicleStatus.MAINTENANCE,
        'sacco-1',
      );

      expect(result.status).toBe(VehicleStatus.MAINTENANCE);
    });

    it('throws ForbiddenException for a cross-sacco status change attempt', async () => {
      const vehicle = { id: 'v1', saccoId: 'sacco-1', status: VehicleStatus.ACTIVE };
      repo.findOne.mockResolvedValue(vehicle as any);

      await expect(
        service.setStatus('v1', VehicleStatus.MAINTENANCE, 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the vehicle does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.setStatus('missing', VehicleStatus.MAINTENANCE, 'sacco-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});