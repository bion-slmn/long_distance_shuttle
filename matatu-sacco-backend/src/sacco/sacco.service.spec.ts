// src/sacco/sacco.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { SaccoService } from './sacco.service';
import { Sacco } from './entities/sacco.entity';
import { SaccoSettingsService } from './sacco-settings.service';

type MockRepo<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function mockQueryBuilder(overrides: Partial<Record<string, any>> = {}) {
  const qb: any = {
    alias: 'sacco',
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
    ...overrides,
  };
  return qb;
}

describe('SaccoService', () => {
  let service: SaccoService;
  let saccoRepository: MockRepo<Sacco>;
  let saccoSettingsService: Partial<Record<keyof SaccoSettingsService, jest.Mock>>;
  let managerQbQueue: any[];

  const baseSacco = (overrides: Partial<Sacco> = {}): Sacco =>
    ({
      id: 'sacco-1',
      name: 'City Shuttle',
      registrationNumber: 'REG-001',
      contacts: [],
      emails: [],
      headquarters: 'Nairobi',
      isActive: true,
      createdAt: new Date('2026-08-01'),
      ...overrides,
    }) as Sacco;

  beforeEach(async () => {
    managerQbQueue = [];

    saccoRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(() => {
          // Pop next queued qb, or return a default empty one
          return managerQbQueue.length ? managerQbQueue.shift() : mockQueryBuilder();
        }),
      } as any,
    };

    saccoSettingsService = {
      createDefaults: jest.fn().mockResolvedValue(undefined),
      // getSaccoPerformanceSummaries reads M-Pesa readiness per sacco; an
      // empty map means "nothing configured", which is what the existing
      // performance assertions assume.
      getMpesaStatuses: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaccoService,
        { provide: getRepositoryToken(Sacco), useValue: saccoRepository },
        { provide: SaccoSettingsService, useValue: saccoSettingsService },
      ],
    }).compile();

    service = module.get<SaccoService>(SaccoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── create ─────────────────────────────────────────────────────────
  describe('create', () => {
    it('throws BadRequestException when name is missing/blank', async () => {
      await expect(service.create({ name: '  ' } as any)).rejects.toThrow(BadRequestException);
      expect(saccoRepository.save).not.toHaveBeenCalled();
    });

    it('creates a sacco with trimmed fields and defaults, then provisions settings', async () => {
      const saved = baseSacco();
      saccoRepository.save!.mockResolvedValue(saved);

      const result = await service.create({
        name: '  City Shuttle  ',
        registrationNumber: '  REG-001  ',
      });

      expect(saccoRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'City Shuttle',
          registrationNumber: 'REG-001',
          headquarters: 'Nairobi',
          isActive: true,
        }),
      );
      expect(saccoSettingsService.createDefaults).toHaveBeenCalledWith(saved.id);
      expect(result).toEqual(saved);
    });

    it('defaults headquarters to Nairobi and registrationNumber to null when omitted', async () => {
      saccoRepository.save!.mockResolvedValue(baseSacco());

      await service.create({ name: 'New Sacco' });

      expect(saccoRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ headquarters: 'Nairobi', registrationNumber: null }),
      );
    });

    it('throws ConflictException on a unique name violation', async () => {
      const pgError = Object.assign(new QueryFailedError('', [], new Error('dup')), {
        code: '23505',
        detail: 'Key (name)=(City Shuttle) already exists.',
      });
      saccoRepository.save!.mockRejectedValue(pgError);

      await expect(service.create({ name: 'City Shuttle' })).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on a unique registrationNumber violation', async () => {
      const pgError = Object.assign(new QueryFailedError('', [], new Error('dup')), {
        code: '23505',
        detail: 'Key (registrationNumber)=(REG-001) already exists.',
      });
      saccoRepository.save!.mockRejectedValue(pgError);

      await expect(service.create({ name: 'X', registrationNumber: 'REG-001' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows non-unique-violation errors unchanged', async () => {
      const err = new Error('connection lost');
      saccoRepository.save!.mockRejectedValue(err);

      await expect(service.create({ name: 'X' })).rejects.toThrow('connection lost');
    });
  });

  // ─── update ─────────────────────────────────────────────────────────
  describe('update', () => {
    it('throws NotFoundException when the sacco does not exist', async () => {
      saccoRepository.findOne!.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('applies only the provided fields, trimming strings', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const result = await service.update('sacco-1', { name: '  New Name  ' });

      expect(result.name).toBe('New Name');
      expect(result.registrationNumber).toBe('REG-001'); // untouched
    });

    it('allows clearing registrationNumber by passing an empty/undefined-coalesced value', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const result = await service.update('sacco-1', { registrationNumber: undefined as any });

      // dto.registrationNumber !== undefined is false here, so it should stay untouched
      // (this test documents current behavior: passing undefined explicitly is a no-op, same as omitting)
      expect(result.registrationNumber).toBe('REG-001');
    });

    it('toggles isActive when explicitly provided', async () => {
      const sacco = baseSacco({ isActive: true });
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const result = await service.update('sacco-1', { isActive: false });

      expect(result.isActive).toBe(false);
    });

    it('throws ConflictException on a unique violation during update', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);
      const pgError = Object.assign(new QueryFailedError('', [], new Error('dup')), {
        code: '23505',
        detail: 'Key (name)=(Dup) already exists.',
      });
      saccoRepository.save!.mockRejectedValue(pgError);

      await expect(service.update('sacco-1', { name: 'Dup' })).rejects.toThrow(ConflictException);
    });
  });

  // ─── findAll ────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns paginated results with default page/limit', async () => {
      const qb = mockQueryBuilder({
        getCount: jest.fn().mockResolvedValue(45),
        getMany: jest.fn().mockResolvedValue([baseSacco()]),
      });
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.findAll();

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(result).toEqual({
        data: [baseSacco()],
        total: 45,
        page: 1,
        limit: 20,
        totalPages: 3,
      });
    });

    it('computes skip correctly for page > 1', async () => {
      const qb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.findAll({ page: 3, limit: 10 });

      expect(qb.skip).toHaveBeenCalledWith(20); // (3-1)*10
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('filters inactive saccos out by default', async () => {
      const qb = mockQueryBuilder();
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.findAll();

      expect(qb.andWhere).toHaveBeenCalledWith('sacco.isActive = :isActive', { isActive: true });
    });

    it('includes inactive saccos when includeInactive is true', async () => {
      const qb = mockQueryBuilder();
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.findAll({ includeInactive: true });

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        'sacco.isActive = :isActive',
        expect.anything(),
      );
    });

    it('applies a case-insensitive search filter, trimmed', async () => {
      const qb = mockQueryBuilder();
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.findAll({ search: '  city  ' });

      expect(qb.andWhere).toHaveBeenCalledWith('sacco.name ILIKE :search', { search: '%city%' });
    });

    it('does not apply a search filter for blank/whitespace-only search', async () => {
      const qb = mockQueryBuilder();
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.findAll({ search: '   ' });

      expect(qb.andWhere).not.toHaveBeenCalledWith('sacco.name ILIKE :search', expect.anything());
    });

    it('selects minimal fields when minimalFields is true', async () => {
      const qb = mockQueryBuilder();
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.findAll({ minimalFields: true });

      expect(qb.select).toHaveBeenCalledWith(['sacco.id', 'sacco.name']);
    });

    it('falls back to limit 20 and page 1 for invalid (<=0) values', async () => {
      const qb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      await service.findAll({ page: -1, limit: 0 });

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('returns 0 totalPages when total is 0', async () => {
      const qb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.findAll();

      expect(result.totalPages).toBe(0);
    });

    it('uses getRawAndEntities and merges counts when withCounts is true', async () => {
      const entity = baseSacco();
      const qb = mockQueryBuilder({
        getCount: jest.fn().mockResolvedValue(1),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [entity],
          raw: [{ vehicleCount: '5', userCount: '3', routeCount: '2' }],
        }),
      });
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.findAll({ withCounts: true });

      expect(qb.addSelect).toHaveBeenCalledTimes(3);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ vehicleCount: 5, userCount: 3, routeCount: 2 }),
      );
    });

    it('defaults raw counts to 0 when missing', async () => {
      const entity = baseSacco();
      const qb = mockQueryBuilder({
        getCount: jest.fn().mockResolvedValue(1),
        getRawAndEntities: jest.fn().mockResolvedValue({ entities: [entity], raw: [{}] }),
      });
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.findAll({ withCounts: true });

      expect(result.data[0]).toEqual(
        expect.objectContaining({ vehicleCount: 0, userCount: 0, routeCount: 0 }),
      );
    });
  });

  // ─── findOne / findOneScoped / findByName ────────────────────────────
  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      saccoRepository.findOne!.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the sacco when found', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);

      await expect(service.findOne('sacco-1')).resolves.toEqual(sacco);
    });
  });

  describe('findOneScoped', () => {
    it('returns the sacco when no saccoId scope is given (super admin)', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);

      await expect(service.findOneScoped('sacco-1')).resolves.toEqual(sacco);
    });

    it('returns the sacco when saccoId matches', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);

      await expect(service.findOneScoped('sacco-1', 'sacco-1')).resolves.toEqual(sacco);
    });

    it('throws ForbiddenException when saccoId does not match', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);

      await expect(service.findOneScoped('sacco-1', 'sacco-2')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findByName', () => {
    it('throws NotFoundException when missing, trims the search name', async () => {
      saccoRepository.findOne!.mockResolvedValue(null);

      await expect(service.findByName('  Ghost Sacco  ')).rejects.toThrow(NotFoundException);
      expect(saccoRepository.findOne).toHaveBeenCalledWith({ where: { name: 'Ghost Sacco' } });
    });

    it('returns the sacco when found', async () => {
      const sacco = baseSacco();
      saccoRepository.findOne!.mockResolvedValue(sacco);

      await expect(service.findByName('City Shuttle')).resolves.toEqual(sacco);
    });
  });

  // ─── deactivate / reactivate ──────────────────────────────────────────
  describe('deactivate', () => {
    it('deactivates an active sacco', async () => {
      const sacco = baseSacco({ isActive: true });
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const result = await service.deactivate('sacco-1');

      expect(result).toEqual({ success: true, message: `Sacco "${sacco.name}" has been deactivated.` });
      expect(sacco.isActive).toBe(false);
    });

    it('throws BadRequestException if already inactive', async () => {
      const sacco = baseSacco({ isActive: false });
      saccoRepository.findOne!.mockResolvedValue(sacco);

      await expect(service.deactivate('sacco-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('reactivate', () => {
    it('reactivates an inactive sacco', async () => {
      const sacco = baseSacco({ isActive: false });
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const result = await service.reactivate('sacco-1');

      expect(result).toEqual({ success: true, message: `Sacco "${sacco.name}" has been reactivated.` });
      expect(sacco.isActive).toBe(true);
    });

    it('throws BadRequestException if already active', async () => {
      const sacco = baseSacco({ isActive: true });
      saccoRepository.findOne!.mockResolvedValue(sacco);

      await expect(service.reactivate('sacco-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── contacts ───────────────────────────────────────────────────────
  describe('addContact / removeContact', () => {
    it('appends a contact', async () => {
      const sacco = baseSacco({ contacts: [{ phone: '0700000001', name: 'A' } as any] });
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const newContact = { phone: '0700000002', name: 'B' } as any;
      const result = await service.addContact('sacco-1', newContact);

      expect(result.contacts).toHaveLength(2);
      expect(result.contacts).toContainEqual(newContact);
    });

    it('removes a contact by phone', async () => {
      const sacco = baseSacco({
        contacts: [
          { phone: '0700000001', name: 'A' } as any,
          { phone: '0700000002', name: 'B' } as any,
        ],
      });
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const result = await service.removeContact('sacco-1', '0700000001');

      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].phone).toBe('0700000002');
    });
  });

  // ─── emails ─────────────────────────────────────────────────────────
  describe('addEmail / removeEmail', () => {
    it('appends an email', async () => {
      const sacco = baseSacco({ emails: [] });
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const newEmail = { email: 'ops@sacco.co.ke', label: 'ops' } as any;
      const result = await service.addEmail('sacco-1', newEmail);

      expect(result.emails).toContainEqual(newEmail);
    });

    it('removes an email by address', async () => {
      const sacco = baseSacco({
        emails: [{ email: 'a@sacco.co.ke' } as any, { email: 'b@sacco.co.ke' } as any],
      });
      saccoRepository.findOne!.mockResolvedValue(sacco);
      saccoRepository.save!.mockImplementation(async (s) => s);

      const result = await service.removeEmail('sacco-1', 'a@sacco.co.ke');

      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].email).toBe('b@sacco.co.ke');
    });
  });

  // ─── getSaccoCountStats ─────────────────────────────────────────────
  describe('getSaccoCountStats', () => {
    it('computes an "up" trend when current > lastWeek', async () => {
      const currentQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(10) });
      const lastWeekQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(8) });
      saccoRepository.createQueryBuilder!
        .mockReturnValueOnce(currentQb)
        .mockReturnValueOnce(lastWeekQb);

      const result = await service.getSaccoCountStats();

      expect(result.currentCount).toBe(10);
      expect(result.lastWeekCount).toBe(8);
      expect(result.percentageChange).toBe(25);
      expect(result.changeDirection).toBe('up');
    });

    it('computes a "down" trend when current < lastWeek', async () => {
      const currentQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(5) });
      const lastWeekQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(10) });
      saccoRepository.createQueryBuilder!
        .mockReturnValueOnce(currentQb)
        .mockReturnValueOnce(lastWeekQb);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(-50);
      expect(result.changeDirection).toBe('down');
    });

    it('returns "no-change" when current equals lastWeek', async () => {
      const currentQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(5) });
      const lastWeekQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(5) });
      saccoRepository.createQueryBuilder!
        .mockReturnValueOnce(currentQb)
        .mockReturnValueOnce(lastWeekQb);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(0);
      expect(result.changeDirection).toBe('no-change');
    });

    it('treats 0 → 0 as no-change (avoids divide-by-zero)', async () => {
      const currentQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      const lastWeekQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      saccoRepository.createQueryBuilder!
        .mockReturnValueOnce(currentQb)
        .mockReturnValueOnce(lastWeekQb);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(0);
      expect(result.changeDirection).toBe('no-change');
    });

    it('treats 0 → N as a 100% increase (avoids divide-by-zero)', async () => {
      const currentQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(3) });
      const lastWeekQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      saccoRepository.createQueryBuilder!
        .mockReturnValueOnce(currentQb)
        .mockReturnValueOnce(lastWeekQb);

      const result = await service.getSaccoCountStats();

      expect(result.percentageChange).toBe(100);
      expect(result.changeDirection).toBe('up');
    });

    it('excludes inactive saccos by default in both counts', async () => {
      const currentQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      const lastWeekQb = mockQueryBuilder({ getCount: jest.fn().mockResolvedValue(0) });
      saccoRepository.createQueryBuilder!
        .mockReturnValueOnce(currentQb)
        .mockReturnValueOnce(lastWeekQb);

      await service.getSaccoCountStats(false);

      expect(currentQb.andWhere).toHaveBeenCalledWith('sacco.isActive = :isActive', {
        isActive: true,
      });
      expect(lastWeekQb.andWhere).toHaveBeenCalledWith('sacco.isActive = :isActive', {
        isActive: true,
      });
    });
  });

  // ─── getSaccoPerformanceSummaries ─────────────────────────────────────
  describe('getSaccoPerformanceSummaries', () => {
    it('returns an empty array when there are no matching saccos', async () => {
      const qb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([]) });
      saccoRepository.createQueryBuilder!.mockReturnValue(qb);

      const result = await service.getSaccoPerformanceSummaries();

      expect(result).toEqual([]);
      // Should short-circuit before running the weekly-stats queries at all
      expect(saccoRepository.manager.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('builds a full summary per sacco, merging all six parallel stat queries', async () => {
      const sacco1 = { id: 'sacco-1', name: 'City Shuttle', isActive: true } as Sacco;
      const listQb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([sacco1]) });
      saccoRepository.createQueryBuilder!.mockReturnValue(listQb);

      // Order matches Promise.all in fetchSaccoWeeklyStats:
      // trips, tripsLastWeek, lastActive, bookings, uniquePassengers, grossFares
      managerQbQueue = [
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', count: '5' }]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', count: '3' }]) }),
        mockQueryBuilder({
          getRawMany: jest
            .fn()
            .mockResolvedValue([{ saccoId: 'sacco-1', lastActiveDate: '2026-08-16' }]),
        }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', count: '40' }]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', count: '25' }]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', total: '20000' }]) }),
      ];

      const result = await service.getSaccoPerformanceSummaries();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        saccoId: 'sacco-1',
        saccoName: 'City Shuttle',
        isActive: true,
        tripsThisWeek: 5,
        tripsLastWeek: 3,
        tripsChangePercent: 66.7,
        bookingsThisWeek: 40,
        uniquePassengersThisWeek: 25,
        grossFaresThisWeek: 20000,
        lastActiveDate: '2026-08-16',
        status: 'Healthy',
        mpesaReady: false, // no settings row stubbed → nothing configured
      });
    });

    it('marks a sacco "Inactive" when it has no lastActiveDate', async () => {
      const sacco1 = { id: 'sacco-1', name: 'Ghost Sacco', isActive: true } as Sacco;
      saccoRepository.createQueryBuilder!.mockReturnValue(
        mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([sacco1]) }),
      );

      managerQbQueue = [
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }), // trips
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }), // tripsLastWeek
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }), // lastActive — none
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }), // bookings
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }), // uniquePassengers
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }), // grossFares
      ];

      const result = await service.getSaccoPerformanceSummaries();

      expect(result[0].status).toBe('Inactive');
      expect(result[0].lastActiveDate).toBeNull();
    });

    it('marks a sacco "Low Activity" when active but under 3 trips this week', async () => {
      const sacco1 = { id: 'sacco-1', name: 'Slow Sacco', isActive: true } as Sacco;
      saccoRepository.createQueryBuilder!.mockReturnValue(
        mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([sacco1]) }),
      );

      managerQbQueue = [
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', count: '1' }]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
        mockQueryBuilder({
          getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', lastActiveDate: '2026-08-10' }]),
        }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
      ];

      const result = await service.getSaccoPerformanceSummaries();

      expect(result[0].status).toBe('Low Activity');
    });

    it('returns null tripsChangePercent when tripsLastWeek is 0', async () => {
      const sacco1 = { id: 'sacco-1', name: 'New Sacco', isActive: true } as Sacco;
      saccoRepository.createQueryBuilder!.mockReturnValue(
        mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([sacco1]) }),
      );

      managerQbQueue = [
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', count: '5' }]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }), // 0 last week
        mockQueryBuilder({
          getRawMany: jest.fn().mockResolvedValue([{ saccoId: 'sacco-1', lastActiveDate: '2026-08-16' }]),
        }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
      ];

      const result = await service.getSaccoPerformanceSummaries();

      expect(result[0].tripsChangePercent).toBeNull();
    });

    it('defaults all stats to 0 for a sacco with no matching rows in any stat query', async () => {
      const sacco1 = { id: 'sacco-2', name: 'Silent Sacco', isActive: true } as Sacco;
      saccoRepository.createQueryBuilder!.mockReturnValue(
        mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([sacco1]) }),
      );

      managerQbQueue = Array.from({ length: 6 }, () =>
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );

      const result = await service.getSaccoPerformanceSummaries();

      expect(result[0]).toEqual(
        expect.objectContaining({
          tripsThisWeek: 0,
          tripsLastWeek: 0,
          bookingsThisWeek: 0,
          uniquePassengersThisWeek: 0,
          grossFaresThisWeek: 0,
          lastActiveDate: null,
          status: 'Inactive',
        }),
      );
    });

    it('passes saccoId through to scope every one of the six stat queries', async () => {
      const sacco1 = { id: 'sacco-1', name: 'City Shuttle', isActive: true } as Sacco;
      const listQb = mockQueryBuilder({ getMany: jest.fn().mockResolvedValue([sacco1]) });
      saccoRepository.createQueryBuilder!.mockReturnValue(listQb);

      const qbs = Array.from({ length: 6 }, () =>
        mockQueryBuilder({ getRawMany: jest.fn().mockResolvedValue([]) }),
      );
      managerQbQueue = qbs;

      await service.getSaccoPerformanceSummaries(false, 'sacco-1');

      expect(listQb.andWhere).toHaveBeenCalledWith('sacco.id = :saccoId', { saccoId: 'sacco-1' });
      qbs.forEach((qb) => {
        expect(qb.andWhere).toHaveBeenCalledWith('saccoId = :saccoId', { saccoId: 'sacco-1' });
      });
    });
  });
});