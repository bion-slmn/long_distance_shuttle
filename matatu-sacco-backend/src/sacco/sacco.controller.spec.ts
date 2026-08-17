// src/sacco/sacco.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SaccoController } from './sacco.controller';
import { SaccoService } from './sacco.service';
import { UserRole } from '../auth/entities/user.entity';

describe('SaccoController', () => {
  let controller: SaccoController;
  let saccoService: Partial<Record<keyof SaccoService, jest.Mock>>;

  const superAdmin = { role: UserRole.SUPER_ADMIN, saccoId: null };
  const saccoAdmin = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
  const saccoAdminNoSacco = { role: UserRole.SACCO_ADMIN, saccoId: null };
  const clerk = { role: UserRole.CLERK, saccoId: 'sacco-1' };

  const baseSacco = {
    id: 'sacco-1',
    name: 'City Shuttle',
    isActive: true,
  };

  beforeEach(async () => {
    saccoService = {
      create: jest.fn(),
      findAll: jest.fn(),
      getSaccoCountStats: jest.fn(),
      getSaccoPerformanceSummaries: jest.fn(),
      findOneScoped: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      reactivate: jest.fn(),
      addContact: jest.fn(),
      removeContact: jest.fn(),
      addEmail: jest.fn(),
      removeEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SaccoController],
      providers: [{ provide: SaccoService, useValue: saccoService }],
    }).compile();

    controller = module.get<SaccoController>(SaccoController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── create ─────────────────────────────────────────────────────────
  describe('create', () => {
    it('delegates the body directly to saccoService.create', () => {
      const dto = { name: 'New Sacco' };
      saccoService.create!.mockReturnValue(baseSacco);

      const result = controller.create(dto);

      expect(saccoService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(baseSacco);
    });
  });

  // ─── findAll ────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('SUPER_ADMIN: passes saccoId undefined (sees all saccos)', () => {
      saccoService.findAll!.mockReturnValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });

      controller.findAll(superAdmin);

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined }),
      );
    });

    it('SACCO_ADMIN/CLERK: scopes to their own saccoId', () => {
      saccoService.findAll!.mockReturnValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });

      controller.findAll(clerk);

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('coerces string query params to booleans/numbers, and passes search through', () => {
      saccoService.findAll!.mockReturnValue({});

      controller.findAll(superAdmin, 'true', '2', '10', 'true', 'city', 'true');

      expect(saccoService.findAll).toHaveBeenCalledWith({
        includeInactive: true,
        page: 2,
        limit: 10,
        minimalFields: true,
        search: 'city',
        saccoId: undefined,
        withCounts: true,
      });
    });

    it('leaves page/limit undefined when not provided (service applies its own defaults)', () => {
      saccoService.findAll!.mockReturnValue({});

      controller.findAll(superAdmin);

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: undefined, limit: undefined }),
      );
    });

    it('treats any non-"true" string as false for boolean flags', () => {
      saccoService.findAll!.mockReturnValue({});

      controller.findAll(superAdmin, 'yes', undefined, undefined, '1', undefined, 'TRUE');

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ includeInactive: false, minimalFields: false, withCounts: false }),
      );
    });
  });

  // ─── getSaccoCountStats ────────────────────────────────────────────
  describe('getSaccoCountStats', () => {
    it('defaults includeInactive to false', () => {
      saccoService.getSaccoCountStats!.mockReturnValue({});

      controller.getSaccoCountStats();

      expect(saccoService.getSaccoCountStats).toHaveBeenCalledWith(false);
    });

    it('passes includeInactive=true through', () => {
      saccoService.getSaccoCountStats!.mockReturnValue({});

      controller.getSaccoCountStats('true');

      expect(saccoService.getSaccoCountStats).toHaveBeenCalledWith(true);
    });
  });

  // ─── getSaccoPerformanceSummaries ──────────────────────────────────
  describe('getSaccoPerformanceSummaries', () => {
    it('SUPER_ADMIN: passes undefined saccoId (platform-wide)', () => {
      saccoService.getSaccoPerformanceSummaries!.mockReturnValue([]);

      controller.getSaccoPerformanceSummaries(superAdmin, 'true');

      expect(saccoService.getSaccoPerformanceSummaries).toHaveBeenCalledWith(true, undefined);
    });

    it('SACCO_ADMIN: scopes to their own saccoId', () => {
      saccoService.getSaccoPerformanceSummaries!.mockReturnValue([]);

      controller.getSaccoPerformanceSummaries(saccoAdmin);

      expect(saccoService.getSaccoPerformanceSummaries).toHaveBeenCalledWith(false, 'sacco-1');
    });

    it('throws ForbiddenException for a SACCO_ADMIN with no assigned sacco', () => {
      expect(() => controller.getSaccoPerformanceSummaries(saccoAdminNoSacco)).toThrow(
        ForbiddenException,
      );
      expect(saccoService.getSaccoPerformanceSummaries).not.toHaveBeenCalled();
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('SUPER_ADMIN: passes undefined scope (can view any sacco)', () => {
      saccoService.findOneScoped!.mockReturnValue(baseSacco);

      controller.findOne('sacco-1', superAdmin);

      expect(saccoService.findOneScoped).toHaveBeenCalledWith('sacco-1', undefined);
    });

    it('SACCO_ADMIN/CLERK: scopes to their own saccoId', () => {
      saccoService.findOneScoped!.mockReturnValue(baseSacco);

      controller.findOne('sacco-1', clerk);

      expect(saccoService.findOneScoped).toHaveBeenCalledWith('sacco-1', 'sacco-1');
    });

    it('propagates ForbiddenException from the service for out-of-scope access', () => {
      saccoService.findOneScoped!.mockImplementation(() => {
        throw new ForbiddenException('You do not have access to this sacco.');
      });

      expect(() => controller.findOne('sacco-2', clerk)).toThrow(ForbiddenException);
    });
  });

  // ─── update ─────────────────────────────────────────────────────────
  describe('update', () => {
    it('SUPER_ADMIN: can update any sacco', () => {
      saccoService.update!.mockReturnValue(baseSacco);

      controller.update('sacco-1', { name: 'New Name' }, superAdmin);

      expect(saccoService.update).toHaveBeenCalledWith('sacco-1', { name: 'New Name' });
    });

    it('SACCO_ADMIN: can update their own sacco', () => {
      saccoService.update!.mockReturnValue(baseSacco);

      controller.update('sacco-1', { name: 'New Name' }, saccoAdmin);

      expect(saccoService.update).toHaveBeenCalledWith('sacco-1', { name: 'New Name' });
    });

    it('SACCO_ADMIN: throws ForbiddenException when updating a different sacco', () => {
      expect(() => controller.update('sacco-2', { name: 'X' }, saccoAdmin)).toThrow(
        ForbiddenException,
      );
      expect(saccoService.update).not.toHaveBeenCalled();
    });
  });

  // ─── deactivate / reactivate (SUPER_ADMIN only, no scoping logic) ────
  describe('deactivate', () => {
    it('delegates to saccoService.deactivate', () => {
      saccoService.deactivate!.mockReturnValue({ success: true, message: 'ok' });

      const result = controller.deactivate('sacco-1');

      expect(saccoService.deactivate).toHaveBeenCalledWith('sacco-1');
      expect(result).toEqual({ success: true, message: 'ok' });
    });
  });

  describe('reactivate', () => {
    it('delegates to saccoService.reactivate', () => {
      saccoService.reactivate!.mockReturnValue({ success: true, message: 'ok' });

      const result = controller.reactivate('sacco-1');

      expect(saccoService.reactivate).toHaveBeenCalledWith('sacco-1');
      expect(result).toEqual({ success: true, message: 'ok' });
    });
  });

  // ─── contacts ───────────────────────────────────────────────────────
  describe('addContact', () => {
    const contact = { phone: '0712345678', name: 'Dispatch' } as any;

    it('SUPER_ADMIN: can add a contact to any sacco', () => {
      saccoService.addContact!.mockReturnValue(baseSacco);

      controller.addContact('sacco-1', contact, superAdmin);

      expect(saccoService.addContact).toHaveBeenCalledWith('sacco-1', contact);
    });

    it('SACCO_ADMIN: can add a contact to their own sacco', () => {
      saccoService.addContact!.mockReturnValue(baseSacco);

      controller.addContact('sacco-1', contact, saccoAdmin);

      expect(saccoService.addContact).toHaveBeenCalledWith('sacco-1', contact);
    });

    it('SACCO_ADMIN: throws ForbiddenException for a different sacco', () => {
      expect(() => controller.addContact('sacco-2', contact, saccoAdmin)).toThrow(
        ForbiddenException,
      );
      expect(saccoService.addContact).not.toHaveBeenCalled();
    });
  });

  describe('removeContact', () => {
    it('SACCO_ADMIN: can remove a contact from their own sacco', () => {
      saccoService.removeContact!.mockReturnValue(baseSacco);

      controller.removeContact('sacco-1', '0712345678', saccoAdmin);

      expect(saccoService.removeContact).toHaveBeenCalledWith('sacco-1', '0712345678');
    });

    it('SACCO_ADMIN: throws ForbiddenException for a different sacco', () => {
      expect(() => controller.removeContact('sacco-2', '0712345678', saccoAdmin)).toThrow(
        ForbiddenException,
      );
      expect(saccoService.removeContact).not.toHaveBeenCalled();
    });
  });

  // ─── emails ─────────────────────────────────────────────────────────
  describe('addEmail', () => {
    const email = { email: 'ops@sacco.co.ke', label: 'ops' } as any;

    it('SUPER_ADMIN: can add an email to any sacco', () => {
      saccoService.addEmail!.mockReturnValue(baseSacco);

      controller.addEmail('sacco-1', email, superAdmin);

      expect(saccoService.addEmail).toHaveBeenCalledWith('sacco-1', email);
    });

    it('SACCO_ADMIN: throws ForbiddenException for a different sacco', () => {
      expect(() => controller.addEmail('sacco-2', email, saccoAdmin)).toThrow(ForbiddenException);
      expect(saccoService.addEmail).not.toHaveBeenCalled();
    });
  });

  describe('removeEmail', () => {
    it('SACCO_ADMIN: can remove an email from their own sacco', () => {
      saccoService.removeEmail!.mockReturnValue(baseSacco);

      controller.removeEmail('sacco-1', 'ops@sacco.co.ke', saccoAdmin);

      expect(saccoService.removeEmail).toHaveBeenCalledWith('sacco-1', 'ops@sacco.co.ke');
    });

    it('SACCO_ADMIN: throws ForbiddenException for a different sacco', () => {
      expect(() => controller.removeEmail('sacco-2', 'ops@sacco.co.ke', saccoAdmin)).toThrow(
        ForbiddenException,
      );
      expect(saccoService.removeEmail).not.toHaveBeenCalled();
    });
  });
});