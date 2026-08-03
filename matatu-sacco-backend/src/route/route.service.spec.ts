// route.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { RouteService } from './route.service';
import { Route } from './entities/route.entity';

describe('RouteService', () => {
  let service: RouteService;
  let repo: jest.Mocked<Repository<Route>>;
  let qb: any;

  beforeEach(async () => {
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),   // ← add this back
      getRawMany: jest.fn(),
      // you can drop groupBy/setLock/innerJoinAndSelect/getOne/getCount/getMany —
      // RouteService never calls them, they were never needed here
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteService,
        {
          provide: getRepositoryToken(Route),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(qb),
            manager: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
          },
        },
      ],
    }).compile();

    service = module.get(RouteService);
    repo = module.get(getRepositoryToken(Route));
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = {
      origin: 'nairobi',
      destination: 'mombasa',
      description: 'via mtito andei',
      fare: 1200,
      saccoId: 'sacco-1',
    };

    it('trims and uppercases origin/destination', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 'r1' } as any);

      await service.create(validDto as any);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'NAIROBI', destination: 'MOMBASA' }),
      );
    });

    it('throws BadRequestException when origin is empty', async () => {
      await expect(
        service.create({ ...validDto, origin: '' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when destination is empty', async () => {
      await expect(
        service.create({ ...validDto, destination: '' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when description is empty', async () => {
      await expect(
        service.create({ ...validDto, description: '  ' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when origin equals destination after normalization', async () => {
      await expect(
        service.create({ ...validDto, origin: 'nairobi', destination: 'NAIROBI' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the route already exists for the sacco', async () => {
      repo.findOne.mockResolvedValue({ id: 'existing' } as any);

      await expect(service.create(validDto as any)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when fare is missing', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ ...validDto, fare: undefined } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when fare is not a number', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ ...validDto, fare: 'abc' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when fare is zero or negative', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ ...validDto, fare: 0 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('deduplicates and normalizes stages', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 'r1' } as any);

      await service.create({
        ...validDto,
        stages: [' kitengela ', 'KITENGELA', 'emali', ''],
      } as any);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ stages: ['KITENGELA', 'EMALI'] }),
      );
    });

    it('defaults isActive to true and coerces fare to a number', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 'r1' } as any);

      await service.create({ ...validDto, fare: '1200' } as any);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true, fare: 1200 }),
      );
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('always filters isActive: true', async () => {
      repo.find.mockResolvedValue([]);
      await service.findAll();

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('adds saccoId filter when provided', async () => {
      repo.find.mockResolvedValue([]);
      await service.findAll('sacco-1');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, saccoId: 'sacco-1' },
        }),
      );
    });

    it('adds origin filter when assignedStage is provided', async () => {
      repo.find.mockResolvedValue([]);
      await service.findAll(undefined, 'NAIROBI');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, origin: 'NAIROBI' },
        }),
      );
    });
  });

  // ── findOne / findOneScoped ─────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the route when found', async () => {
      const route = { id: 'r1' } as any;
      repo.findOne.mockResolvedValue(route);
      await expect(service.findOne('r1')).resolves.toEqual(route);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOneScoped', () => {
    it('returns the route when saccoId matches', async () => {
      const route = { id: 'r1', saccoId: 'sacco-1' } as any;
      repo.findOne.mockResolvedValue(route);
      await expect(
        service.findOneScoped('r1', 'sacco-1'),
      ).resolves.toEqual(route);
    });

    it('throws ForbiddenException when saccoId does not match', async () => {
      repo.findOne.mockResolvedValue({ id: 'r1', saccoId: 'sacco-1' } as any);
      await expect(
        service.findOneScoped('r1', 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('bypasses the check when saccoId is undefined', async () => {
      const route = { id: 'r1', saccoId: 'sacco-1' } as any;
      repo.findOne.mockResolvedValue(route);
      await expect(service.findOneScoped('r1')).resolves.toEqual(route);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    const existingRoute = () => ({
      id: 'r1',
      saccoId: 'sacco-1',
      origin: 'NAIROBI',
      destination: 'MOMBASA',
      description: 'old',
      stages: [],
      isActive: true,
      fare: 1000,
    });

    it('updates only provided fields', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);
      repo.save.mockImplementation(async (r) => r as any);

      const result = await service.update('r1', { description: 'new desc' }, 'sacco-1');

      expect(result.description).toBe('new desc');
      expect(result.origin).toBe('NAIROBI');
    });

    it('trims and uppercases origin/destination on update', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);
      repo.save.mockImplementation(async (r) => r as any);

      const result = await service.update(
        'r1',
        { destination: '  kisumu  ' },
        'sacco-1',
      );

      expect(result.destination).toBe('KISUMU');
    });

    it('throws BadRequestException if update makes origin equal destination', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);

      await expect(
        service.update('r1', { destination: 'NAIROBI' }, 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for cross-sacco update', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);

      await expect(
        service.update('r1', { description: 'x' }, 'sacco-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('normalizes stages when provided', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);
      repo.save.mockImplementation(async (r) => r as any);

      const result = await service.update(
        'r1',
        { stages: [' emali ', 'EMALI'] },
        'sacco-1',
      );

      expect(result.stages).toEqual(['EMALI']);
    });
  });

  // ── addStage ────────────────────────────────────────────────────────────

  describe('addStage', () => {
    const existingRoute = () => ({
      id: 'r1',
      saccoId: 'sacco-1',
      origin: 'NAIROBI',
      destination: 'MOMBASA',
      stages: ['MTITO ANDEI'],
    });

    it('adds a normalized stage', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);
      repo.save.mockImplementation(async (r) => r as any);

      const result = await service.addStage('r1', '  emali  ', 'sacco-1');

      expect(result.stages).toEqual(['MTITO ANDEI', 'EMALI']);
    });

    it('throws BadRequestException for an empty stage name', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);

      await expect(service.addStage('r1', '   ', 'sacco-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when stage equals origin', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);

      await expect(
        service.addStage('r1', 'nairobi', 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when stage equals destination', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);

      await expect(
        service.addStage('r1', 'mombasa', 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a duplicate stage', async () => {
      repo.findOne.mockResolvedValue(existingRoute() as any);

      await expect(
        service.addStage('r1', 'mtito andei', 'sacco-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── removeStage ─────────────────────────────────────────────────────────

  describe('removeStage', () => {
    it('removes the matching normalized stage', async () => {
      repo.findOne.mockResolvedValue({
        id: 'r1',
        saccoId: 'sacco-1',
        origin: 'NAIROBI',
        destination: 'MOMBASA',
        stages: ['EMALI', 'MTITO ANDEI'],
      } as any);
      repo.save.mockImplementation(async (r) => r as any);

      const result = await service.removeStage('r1', 'emali', 'sacco-1');

      expect(result.stages).toEqual(['MTITO ANDEI']);
    });

    it('is a no-op when the stage does not exist', async () => {
      const route = {
        id: 'r1',
        saccoId: 'sacco-1',
        origin: 'NAIROBI',
        destination: 'MOMBASA',
        stages: ['EMALI'],
      };
      repo.findOne.mockResolvedValue(route as any);
      repo.save.mockImplementation(async (r) => r as any);

      const result = await service.removeStage('r1', 'nonexistent', 'sacco-1');

      expect(result.stages).toEqual(['EMALI']);
    });
  });

  // ── getAvailableLocations ───────────────────────────────────────────────

  describe('getAvailableLocations', () => {
    it('returns distinct origins and destinations from active routes only', async () => {
      qb.getRawMany
        .mockResolvedValueOnce([{ origin: 'NAIROBI' }, { origin: 'KISUMU' }])
        .mockResolvedValueOnce([{ destination: 'MOMBASA' }]);

      const result = await service.getAvailableLocations();

      expect(result).toEqual({
        origins: ['NAIROBI', 'KISUMU'],
        destinations: ['MOMBASA'],
      });
      expect(qb.where).toHaveBeenCalledWith('route.isActive = :isActive', {
        isActive: true,
      });
    });
  });

  // ── searchRoutes ────────────────────────────────────────────────────────

  describe('searchRoutes', () => {
    it('throws BadRequestException when origin is missing', async () => {
      await expect(service.searchRoutes('', 'MOMBASA')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when destination is missing', async () => {
      await expect(service.searchRoutes('NAIROBI', '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('normalizes origin/destination to uppercase before querying', async () => {
      qb.getRawMany.mockResolvedValue([]);

      await service.searchRoutes('nairobi', 'mombasa');

      expect(qb.where).toHaveBeenCalledWith('route.origin = :origin', {
        origin: 'NAIROBI',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'route.destination = :destination',
        { destination: 'MOMBASA' },
      );
    });

    it('converts fare from string to number in results', async () => {
      qb.getRawMany.mockResolvedValue([
        {
          routeId: 'r1',
          saccoId: 'sacco-1',
          saccoName: 'Metro Trans',
          origin: 'NAIROBI',
          destination: 'MOMBASA',
          description: 'via Mtito Andei',
          stages: [],
          fare: '1200.50',
        },
      ]);

      const result = await service.searchRoutes('NAIROBI', 'MOMBASA');

      expect(result[0].fare).toBe(1200.5);
      expect(typeof result[0].fare).toBe('number');
    });

    it('returns an empty array when no routes service the pair', async () => {
      qb.getRawMany.mockResolvedValue([]);
      const result = await service.searchRoutes('NAIROBI', 'ELDORET');
      expect(result).toEqual([]);
    });
  });
});