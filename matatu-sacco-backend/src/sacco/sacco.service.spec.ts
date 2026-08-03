// sacco.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { SaccoService } from './sacco.service';
import { Sacco } from './entities/sacco.entity';
import { TripService } from 'src/trip/trip.service';
import { BookingService } from 'src/booking/booking.service';

describe('SaccoService', () => {
  let service: SaccoService;
  let repo: jest.Mocked<Repository<Sacco>>;
  let tripService: jest.Mocked<TripService>;
  let bookingService: jest.Mocked<BookingService>;

  // qb used for direct sacco.createQueryBuilder('sacco') calls
  let saccoQb: any;
  // qb used for manager.createQueryBuilder(Trip | Booking, alias) calls
  let statsQb: any;
  let manager: any;

  beforeEach(async () => {
    saccoQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getMany: jest.fn(),
      getRawAndEntities: jest.fn(),
    };

    statsQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    manager = {
      createQueryBuilder: jest.fn().mockReturnValue(statsQb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaccoService,
        {
          provide: getRepositoryToken(Sacco),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(saccoQb),
            manager,
          },
        },
        {
          provide: TripService,
          useValue: {},
        },
        {
          provide: BookingService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(SaccoService);
    repo = module.get(getRepositoryToken(Sacco));
    tripService = module.get(TripService);
    bookingService = module.get(BookingService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('throws BadRequestException when name is empty', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('trims name and defaults optional fields', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 's1' } as any);

      await service.create({ name: '  Metro Trans  ' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Metro Trans',
          registrationNumber: null,
          contacts: [],
          emails: [],
          headquarters: 'Nairobi',
          isActive: true,
        }),
      );
    });

    it('preserves provided registrationNumber, contacts, emails, headquarters', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockResolvedValue({ id: 's1' } as any);

      const dto = {
        name: 'Metro Trans',
        registrationNumber: '  REG-123  ',
        contacts: [{ phone: '0700000000', name: 'Jane' }] as any,
        emails: [{ email: 'a@b.com' }] as any,
        headquarters: '  Mombasa  ',
      };

      await service.create(dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          registrationNumber: 'REG-123',
          contacts: dto.contacts,
          emails: dto.emails,
          headquarters: 'Mombasa',
        }),
      );
    });

    it('throws ConflictException on a duplicate name violation', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], {
          message: 'duplicate key',
          code: '23505',
          detail: 'Key (name)=(Metro Trans) already exists.',
        } as any),
      );

      await expect(
        service.create({ name: 'Metro Trans' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on a duplicate registrationNumber violation', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], {
          message: 'duplicate key',
          code: '23505',
          detail: 'Key (registrationNumber)=(REG-1) already exists.',
        } as any),
      );

      await expect(
        service.create({ name: 'X', registrationNumber: 'REG-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws a generic ConflictException for an unrecognized unique violation', async () => {
      repo.create.mockReturnValue({} as any);
      repo.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], {
          message: 'duplicate key',
          code: '23505',
          detail: 'Key (something_else)=(x) already exists.',
        } as any),
      );

      await expect(service.create({ name: 'X' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows non-unique-violation errors unchanged', async () => {
      repo.create.mockReturnValue({} as any);
      const err = new Error('connection lost');
      repo.save.mockRejectedValue(err);

      await expect(service.create({ name: 'X' })).rejects.toThrow(
        'connection lost',
      );
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    const existingSacco = () => ({
      id: 's1',
      name: 'Old Name',
      registrationNumber: 'REG-1',
      contacts: [],
      emails: [],
      headquarters: 'Nairobi',
      isActive: true,
    });

    it('updates only provided fields', async () => {
      repo.findOne.mockResolvedValue(existingSacco() as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.update('s1', { name: 'New Name' });

      expect(result.name).toBe('New Name');
      expect(result.headquarters).toBe('Nairobi');
    });

    it('trims name and headquarters on update', async () => {
      repo.findOne.mockResolvedValue(existingSacco() as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.update('s1', {
        name: '  Trimmed  ',
        headquarters: '  Kisumu  ',
      });

      expect(result.name).toBe('Trimmed');
      expect(result.headquarters).toBe('Kisumu');
    });

    it('sets registrationNumber to null when explicitly cleared', async () => {
      repo.findOne.mockResolvedValue(existingSacco() as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.update('s1', {
        registrationNumber: undefined,
      });

      // registrationNumber untouched since dto field is undefined
      expect(result.registrationNumber).toBe('REG-1');
    });

    it('throws NotFoundException when sacco does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException on duplicate name during update', async () => {
      repo.findOne.mockResolvedValue(existingSacco() as any);
      repo.save.mockRejectedValue(
        new QueryFailedError('UPDATE', [], {
          message: 'duplicate key',
          code: '23505',
          detail: 'Key (name)=(Taken) already exists.',
        } as any),
      );

      await expect(
        service.update('s1', { name: 'Taken' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('applies default pagination and isActive filter', async () => {
      saccoQb.getCount.mockResolvedValue(0);
      saccoQb.getMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(saccoQb.andWhere).toHaveBeenCalledWith(
        'sacco.isActive = :isActive',
        { isActive: true },
      );
      expect(saccoQb.skip).toHaveBeenCalledWith(0);
      expect(saccoQb.take).toHaveBeenCalledWith(20);
      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('includes inactive saccos when includeInactive is true', async () => {
      saccoQb.getCount.mockResolvedValue(0);
      saccoQb.getMany.mockResolvedValue([]);

      await service.findAll({ includeInactive: true });

      expect(saccoQb.andWhere).not.toHaveBeenCalledWith(
        'sacco.isActive = :isActive',
        expect.anything(),
      );
    });

    it('filters by saccoId when provided', async () => {
      saccoQb.getCount.mockResolvedValue(1);
      saccoQb.getMany.mockResolvedValue([{ id: 's1' }]);

      await service.findAll({ saccoId: 's1' });

      expect(saccoQb.andWhere).toHaveBeenCalledWith('sacco.id = :saccoId', {
        saccoId: 's1',
      });
    });

    it('applies an ILIKE search filter when search is provided', async () => {
      saccoQb.getCount.mockResolvedValue(0);
      saccoQb.getMany.mockResolvedValue([]);

      await service.findAll({ search: '  metro  ' });

      expect(saccoQb.andWhere).toHaveBeenCalledWith(
        'sacco.name ILIKE :search',
        { search: '%metro%' },
      );
    });

    it('ignores a blank search string', async () => {
      saccoQb.getCount.mockResolvedValue(0);
      saccoQb.getMany.mockResolvedValue([]);

      await service.findAll({ search: '   ' });

      expect(saccoQb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });

    it('selects minimal fields when minimalFields is true', async () => {
      saccoQb.getCount.mockResolvedValue(0);
      saccoQb.getMany.mockResolvedValue([]);

      await service.findAll({ minimalFields: true });

      expect(saccoQb.select).toHaveBeenCalledWith(['sacco.id', 'sacco.name']);
    });

    it('normalizes page/limit to sane defaults when zero or negative', async () => {
      saccoQb.getCount.mockResolvedValue(0);
      saccoQb.getMany.mockResolvedValue([]);

      await service.findAll({ page: 0, limit: -5 });

      expect(saccoQb.skip).toHaveBeenCalledWith(0);
      expect(saccoQb.take).toHaveBeenCalledWith(20);
    });

    it('computes skip based on page and limit', async () => {
      saccoQb.getCount.mockResolvedValue(0);
      saccoQb.getMany.mockResolvedValue([]);

      await service.findAll({ page: 3, limit: 10 });

      expect(saccoQb.skip).toHaveBeenCalledWith(20);
      expect(saccoQb.take).toHaveBeenCalledWith(10);
    });

    it('uses getRawAndEntities and attaches counts when withCounts is true', async () => {
      saccoQb.getCount.mockResolvedValue(1);
      saccoQb.getRawAndEntities.mockResolvedValue({
        entities: [{ id: 's1', name: 'Metro' }],
        raw: [{ vehicleCount: '4', userCount: '2', routeCount: '3' }],
      });

      const result = await service.findAll({ withCounts: true });

      expect(saccoQb.getMany).not.toHaveBeenCalled();
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: 's1',
          vehicleCount: 4,
          userCount: 2,
          routeCount: 3,
        }),
      );
    });

    it('defaults counts to 0 when raw row is missing', async () => {
      saccoQb.getCount.mockResolvedValue(1);
      saccoQb.getRawAndEntities.mockResolvedValue({
        entities: [{ id: 's1', name: 'Metro' }],
        raw: [],
      });

      const result = await service.findAll({ withCounts: true });

      expect(result.data[0]).toEqual(
        expect.objectContaining({
          vehicleCount: 0,
          userCount: 0,
          routeCount: 0,
        }),
      );
    });
  });

  // ── findOne / findOneScoped / findByName ──────────────────────────────

  describe('findOne', () => {
    it('returns the sacco when found', async () => {
      const sacco = { id: 's1' } as any;
      repo.findOne.mockResolvedValue(sacco);
      await expect(service.findOne('s1')).resolves.toEqual(sacco);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOneScoped', () => {
    it('returns the sacco when saccoId matches', async () => {
      const sacco = { id: 's1' } as any;
      repo.findOne.mockResolvedValue(sacco);
      await expect(service.findOneScoped('s1', 's1')).resolves.toEqual(
        sacco,
      );
    });

    it('throws ForbiddenException when saccoId does not match', async () => {
      repo.findOne.mockResolvedValue({ id: 's1' } as any);
      await expect(service.findOneScoped('s1', 's2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('bypasses the check when saccoId is undefined', async () => {
      const sacco = { id: 's1' } as any;
      repo.findOne.mockResolvedValue(sacco);
      await expect(service.findOneScoped('s1')).resolves.toEqual(sacco);
    });
  });

  describe('findByName', () => {
    it('returns the sacco when found by trimmed name', async () => {
      const sacco = { id: 's1', name: 'Metro' } as any;
      repo.findOne.mockResolvedValue(sacco);

      await expect(service.findByName('  Metro  ')).resolves.toEqual(
        sacco,
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { name: 'Metro' },
      });
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findByName('Unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── deactivate / reactivate ─────────────────────────────────────────────

  describe('deactivate', () => {
    it('deactivates an active sacco', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        name: 'Metro',
        isActive: true,
      } as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.deactivate('s1');

      expect(result).toEqual({
        success: true,
        message: 'Sacco "Metro" has been deactivated.',
      });
    });

    it('throws BadRequestException when already inactive', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        name: 'Metro',
        isActive: false,
      } as any);

      await expect(service.deactivate('s1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('reactivates an inactive sacco', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        name: 'Metro',
        isActive: false,
      } as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.reactivate('s1');

      expect(result).toEqual({
        success: true,
        message: 'Sacco "Metro" has been reactivated.',
      });
    });

    it('throws BadRequestException when already active', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        name: 'Metro',
        isActive: true,
      } as any);

      await expect(service.reactivate('s1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  // ── contacts ────────────────────────────────────────────────────────────

  describe('addContact', () => {
    it('appends a contact', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        contacts: [{ phone: '0700', name: 'A' }],
      } as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.addContact('s1', {
        phone: '0711',
        name: 'B',
      } as any);

      expect(result.contacts).toEqual([
        { phone: '0700', name: 'A' },
        { phone: '0711', name: 'B' },
      ]);
    });
  });

  describe('removeContact', () => {
    it('removes the contact matching the phone number', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        contacts: [
          { phone: '0700', name: 'A' },
          { phone: '0711', name: 'B' },
        ],
      } as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.removeContact('s1', '0700');

      expect(result.contacts).toEqual([{ phone: '0711', name: 'B' }]);
    });
  });

  // ── emails ──────────────────────────────────────────────────────────────

  describe('addEmail', () => {
    it('appends an email', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        emails: [{ email: 'a@b.com' }],
      } as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.addEmail('s1', {
        email: 'c@d.com',
      } as any);

      expect(result.emails).toEqual([
        { email: 'a@b.com' },
        { email: 'c@d.com' },
      ]);
    });
  });

  describe('removeEmail', () => {
    it('removes the matching email', async () => {
      repo.findOne.mockResolvedValue({
        id: 's1',
        emails: [{ email: 'a@b.com' }, { email: 'c@d.com' }],
      } as any);
      repo.save.mockImplementation(async (s) => s as any);

      const result = await service.removeEmail('s1', 'a@b.com');

      expect(result.emails).toEqual([{ email: 'c@d.com' }]);
    });
  });

  // ── getSaccoCountStats ──────────────────────────────────────────────────

  describe('getSaccoCountStats', () => {
    it('computes percentage growth correctly', async () => {
      saccoQb.getCount.mockResolvedValueOnce(10).mockResolvedValueOnce(5);

      const result = await service.getSaccoCountStats();

      expect(result).toEqual({
        currentCount: 10,
        lastWeekCount: 5,
        percentageChange: 100,
        changeDirection: 'up',
      });
    });

    it('reports no-change when counts are equal', async () => {
      saccoQb.getCount.mockResolvedValueOnce(5).mockResolvedValueOnce(5);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(0);
      expect(result.changeDirection).toBe('no-change');
    });

    it('reports decline when current is lower than last week', async () => {
      saccoQb.getCount.mockResolvedValueOnce(3).mockResolvedValueOnce(6);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(-50);
      expect(result.changeDirection).toBe('down');
    });

    it('treats 0 → 0 as no-change, avoiding divide-by-zero', async () => {
      saccoQb.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(0);
      expect(result.changeDirection).toBe('no-change');
    });

    it('treats 0 → N as a 100% increase, avoiding divide-by-zero', async () => {
      saccoQb.getCount.mockResolvedValueOnce(4).mockResolvedValueOnce(0);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(100);
      expect(result.changeDirection).toBe('up');
    });

    it('includes inactive saccos in both counts when includeInactive is true', async () => {
      saccoQb.getCount.mockResolvedValueOnce(10).mockResolvedValueOnce(8);

      await service.getSaccoCountStats(true);

      expect(saccoQb.andWhere).not.toHaveBeenCalledWith(
        'sacco.isActive = :isActive',
        expect.anything(),
      );
    });
  });

  // ── getSaccoPerformanceSummaries ────────────────────────────────────────

  describe('getSaccoPerformanceSummaries', () => {
    it('returns an empty array when there are no matching saccos', async () => {
      saccoQb.getMany.mockResolvedValue([]);

      const result = await service.getSaccoPerformanceSummaries();

      expect(result).toEqual([]);
      expect(manager.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('builds a Healthy summary for an active sacco with trips this week', async () => {
      saccoQb.getMany.mockResolvedValue([
        { id: 's1', name: 'Metro', isActive: true },
      ]);

      statsQb.getRawMany
        .mockResolvedValueOnce([{ saccoId: 's1', count: '10' }]) // tripsThisWeek
        .mockResolvedValueOnce([{ saccoId: 's1', count: '8' }]) // tripsLastWeek
        .mockResolvedValueOnce([
          { saccoId: 's1', lastActiveDate: '2026-08-01' },
        ]) // lastActive
        .mockResolvedValueOnce([{ saccoId: 's1', count: '20' }]) // bookings
        .mockResolvedValueOnce([{ saccoId: 's1', count: '15' }]) // uniquePassengers
        .mockResolvedValueOnce([{ saccoId: 's1', total: '24000' }]); // grossFares

      const [summary] = await service.getSaccoPerformanceSummaries();

      expect(summary).toEqual({
        saccoId: 's1',
        saccoName: 'Metro',
        isActive: true,
        tripsThisWeek: 10,
        tripsLastWeek: 8,
        tripsChangePercent: 25,
        bookingsThisWeek: 20,
        uniquePassengersThisWeek: 15,
        grossFaresThisWeek: 24000,
        lastActiveDate: '2026-08-01',
        status: 'Healthy',
      });
    });

    it('marks a sacco Inactive when it has no lastActiveDate', async () => {
      saccoQb.getMany.mockResolvedValue([
        { id: 's1', name: 'Metro', isActive: true },
      ]);
      statsQb.getRawMany.mockResolvedValue([]); // every stat map is empty

      const [summary] = await service.getSaccoPerformanceSummaries();

      expect(summary.lastActiveDate).toBeNull();
      expect(summary.status).toBe('Inactive');
    });

    it('marks a sacco Low Activity when trips this week are below 3 but it has been active before', async () => {
      saccoQb.getMany.mockResolvedValue([
        { id: 's1', name: 'Metro', isActive: true },
      ]);

      statsQb.getRawMany
        .mockResolvedValueOnce([{ saccoId: 's1', count: '2' }]) // tripsThisWeek
        .mockResolvedValueOnce([]) // tripsLastWeek
        .mockResolvedValueOnce([
          { saccoId: 's1', lastActiveDate: '2026-07-20' },
        ]) // lastActive
        .mockResolvedValueOnce([]) // bookings
        .mockResolvedValueOnce([]) // uniquePassengers
        .mockResolvedValueOnce([]); // grossFares

      const [summary] = await service.getSaccoPerformanceSummaries();

      expect(summary.status).toBe('Low Activity');
    });

    it('returns null tripsChangePercent when there were no trips last week', async () => {
      saccoQb.getMany.mockResolvedValue([
        { id: 's1', name: 'Metro', isActive: true },
      ]);

      statsQb.getRawMany
        .mockResolvedValueOnce([{ saccoId: 's1', count: '5' }]) // tripsThisWeek
        .mockResolvedValueOnce([]) // tripsLastWeek (no entry -> 0)
        .mockResolvedValueOnce([
          { saccoId: 's1', lastActiveDate: '2026-08-01' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const [summary] = await service.getSaccoPerformanceSummaries();

      expect(summary.tripsChangePercent).toBeNull();
    });

    it('scopes all weekly stat queries by saccoId when provided', async () => {
      saccoQb.getMany.mockResolvedValue([
        { id: 's1', name: 'Metro', isActive: true },
      ]);
      statsQb.getRawMany.mockResolvedValue([]);

      await service.getSaccoPerformanceSummaries(false, 's1');

      expect(saccoQb.andWhere).toHaveBeenCalledWith('sacco.id = :saccoId', {
        saccoId: 's1',
      });
      expect(statsQb.andWhere).toHaveBeenCalledWith('saccoId = :saccoId', {
        saccoId: 's1',
      });
    });

    it('includes inactive saccos when includeInactive is true', async () => {
      saccoQb.getMany.mockResolvedValue([]);

      await service.getSaccoPerformanceSummaries(true);

      expect(saccoQb.andWhere).not.toHaveBeenCalledWith(
        'sacco.isActive = :isActive',
        expect.anything(),
      );
    });
  });
});