// sacco.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SaccoController } from './sacco.controller';
import { SaccoService } from './sacco.service';
import { UserRole } from '../auth/entities/user.entity';

describe('SaccoController', () => {
  let controller: SaccoController;
  let saccoService: jest.Mocked<SaccoService>;

  const superAdmin = { id: 'u1', role: UserRole.SUPER_ADMIN, saccoId: null };
  const saccoAdmin = { id: 'u2', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
  const saccoAdminNoSacco = { id: 'u3', role: UserRole.SACCO_ADMIN, saccoId: null };
  const clerk = { id: 'u4', role: UserRole.CLERK, saccoId: 'sacco-1' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SaccoController],
      providers: [
        {
          provide: SaccoService,
          useValue: {
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
          },
        },
      ],
    }).compile();

    controller = module.get(SaccoController);
    saccoService = module.get(SaccoService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to saccoService with the body unchanged', () => {
      const body = { name: 'Metro Trans' };

      controller.create(body);

      expect(saccoService.create).toHaveBeenCalledWith(body);
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('leaves saccoId undefined for SUPER_ADMIN', () => {
      controller.findAll(superAdmin);

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined }),
      );
    });

    it('scopes to own saccoId for SACCO_ADMIN', () => {
      controller.findAll(saccoAdmin);

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });


    it('converts includeInactive query string to boolean', () => {
      controller.findAll(saccoAdmin, 'true');

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ includeInactive: true }),
      );
    });

    it('defaults includeInactive to false when omitted', () => {
      controller.findAll(saccoAdmin);

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ includeInactive: false }),
      );
    });

    it('parses page and limit as numbers', () => {
      controller.findAll(saccoAdmin, undefined, '2', '15');

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 15 }),
      );
    });

    it('leaves page and limit undefined when omitted', () => {
      controller.findAll(saccoAdmin);

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: undefined, limit: undefined }),
      );
    });

    it('converts minimalFields and withCounts query strings to booleans', () => {
      controller.findAll(
        saccoAdmin,
        undefined,
        undefined,
        undefined,
        'true',
        undefined,
        'true',
      );

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ minimalFields: true, withCounts: true }),
      );
    });

    it('passes search through unchanged', () => {
      controller.findAll(
        saccoAdmin,
        undefined,
        undefined,
        undefined,
        undefined,
        'metro',
      );

      expect(saccoService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'metro' }),
      );
    });
  });

  // ── getSaccoCountStats ──────────────────────────────────────────────────

  describe('getSaccoCountStats', () => {
    it('converts includeInactive query string to boolean', () => {
      controller.getSaccoCountStats('true');

      expect(saccoService.getSaccoCountStats).toHaveBeenCalledWith(true);
    });

    it('defaults includeInactive to false when omitted', () => {
      controller.getSaccoCountStats();

      expect(saccoService.getSaccoCountStats).toHaveBeenCalledWith(false);
    });
  });

  // ── getSaccoPerformanceSummaries ────────────────────────────────────────

  describe('getSaccoPerformanceSummaries', () => {
    it('passes undefined saccoId for SUPER_ADMIN', () => {
      controller.getSaccoPerformanceSummaries(superAdmin);

      expect(saccoService.getSaccoPerformanceSummaries).toHaveBeenCalledWith(
        false,
        undefined,
      );
    });

    it('scopes to saccoId for SACCO_ADMIN', () => {
      controller.getSaccoPerformanceSummaries(saccoAdmin);

      expect(saccoService.getSaccoPerformanceSummaries).toHaveBeenCalledWith(
        false,
        'sacco-1',
      );
    });

    it('converts includeInactive query string to boolean', () => {
      controller.getSaccoPerformanceSummaries(superAdmin, 'true');

      expect(saccoService.getSaccoPerformanceSummaries).toHaveBeenCalledWith(
        true,
        undefined,
      );
    });

    it('throws ForbiddenException when a SACCO_ADMIN has no saccoId', () => {
      expect(() =>
        controller.getSaccoPerformanceSummaries(saccoAdminNoSacco),
      ).toThrow(ForbiddenException);
      expect(saccoService.getSaccoPerformanceSummaries).not.toHaveBeenCalled();
    });
  });

  // ── findOne ─────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('scopes to the user\'s saccoId for CLERK', () => {
      controller.findOne('sacco-1', clerk);

      expect(saccoService.findOneScoped).toHaveBeenCalledWith(
        'sacco-1',
        'sacco-1',
      );
    });

    it('scopes to the user\'s saccoId for SACCO_ADMIN', () => {
      controller.findOne('sacco-1', saccoAdmin);

      expect(saccoService.findOneScoped).toHaveBeenCalledWith(
        'sacco-1',
        'sacco-1',
      );
    });

    it('leaves scopedId undefined for SUPER_ADMIN', () => {
      controller.findOne('sacco-1', superAdmin);

      expect(saccoService.findOneScoped).toHaveBeenCalledWith(
        'sacco-1',
        undefined,
      );
    });
  });

  // ── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    const body = { name: 'Updated Name' };

    it('allows SACCO_ADMIN to update their own sacco', () => {
      controller.update('sacco-1', body, saccoAdmin);

      expect(saccoService.update).toHaveBeenCalledWith('sacco-1', body);
    });

    it('throws ForbiddenException when SACCO_ADMIN targets a different sacco', () => {
      expect(() =>
        controller.update('sacco-2', body, saccoAdmin),
      ).toThrow(ForbiddenException);
      expect(saccoService.update).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to update any sacco', () => {
      controller.update('sacco-2', body, superAdmin);

      expect(saccoService.update).toHaveBeenCalledWith('sacco-2', body);
    });
  });

  // ── deactivate / reactivate ─────────────────────────────────────────────

  describe('deactivate', () => {
    it('delegates to saccoService with the id', () => {
      controller.deactivate('sacco-1');

      expect(saccoService.deactivate).toHaveBeenCalledWith('sacco-1');
    });
  });

  describe('reactivate', () => {
    it('delegates to saccoService with the id', () => {
      controller.reactivate('sacco-1');

      expect(saccoService.reactivate).toHaveBeenCalledWith('sacco-1');
    });
  });

  // ── contacts ────────────────────────────────────────────────────────────

  describe('addContact', () => {
    const contact = { phone: '0700000000', name: 'Jane' } as any;

    it('allows SACCO_ADMIN to add a contact to their own sacco', () => {
      controller.addContact('sacco-1', contact, saccoAdmin);

      expect(saccoService.addContact).toHaveBeenCalledWith(
        'sacco-1',
        contact,
      );
    });

    it('throws ForbiddenException when SACCO_ADMIN targets a different sacco', () => {
      expect(() =>
        controller.addContact('sacco-2', contact, saccoAdmin),
      ).toThrow(ForbiddenException);
      expect(saccoService.addContact).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to add a contact to any sacco', () => {
      controller.addContact('sacco-2', contact, superAdmin);

      expect(saccoService.addContact).toHaveBeenCalledWith(
        'sacco-2',
        contact,
      );
    });
  });

  describe('removeContact', () => {
    it('allows SACCO_ADMIN to remove a contact from their own sacco', () => {
      controller.removeContact('sacco-1', '0700000000', saccoAdmin);

      expect(saccoService.removeContact).toHaveBeenCalledWith(
        'sacco-1',
        '0700000000',
      );
    });

    it('throws ForbiddenException when SACCO_ADMIN targets a different sacco', () => {
      expect(() =>
        controller.removeContact('sacco-2', '0700000000', saccoAdmin),
      ).toThrow(ForbiddenException);
      expect(saccoService.removeContact).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to remove a contact from any sacco', () => {
      controller.removeContact('sacco-2', '0700000000', superAdmin);

      expect(saccoService.removeContact).toHaveBeenCalledWith(
        'sacco-2',
        '0700000000',
      );
    });
  });

  // ── emails ──────────────────────────────────────────────────────────────

  describe('addEmail', () => {
    const email = { email: 'a@b.com' } as any;

    it('allows SACCO_ADMIN to add an email to their own sacco', () => {
      controller.addEmail('sacco-1', email, saccoAdmin);

      expect(saccoService.addEmail).toHaveBeenCalledWith('sacco-1', email);
    });

    it('throws ForbiddenException when SACCO_ADMIN targets a different sacco', () => {
      expect(() =>
        controller.addEmail('sacco-2', email, saccoAdmin),
      ).toThrow(ForbiddenException);
      expect(saccoService.addEmail).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to add an email to any sacco', () => {
      controller.addEmail('sacco-2', email, superAdmin);

      expect(saccoService.addEmail).toHaveBeenCalledWith('sacco-2', email);
    });
  });

  describe('removeEmail', () => {
    it('allows SACCO_ADMIN to remove an email from their own sacco', () => {
      controller.removeEmail('sacco-1', 'a@b.com', saccoAdmin);

      expect(saccoService.removeEmail).toHaveBeenCalledWith(
        'sacco-1',
        'a@b.com',
      );
    });

    it('throws ForbiddenException when SACCO_ADMIN targets a different sacco', () => {
      expect(() =>
        controller.removeEmail('sacco-2', 'a@b.com', saccoAdmin),
      ).toThrow(ForbiddenException);
      expect(saccoService.removeEmail).not.toHaveBeenCalled();
    });

    it('allows SUPER_ADMIN to remove an email from any sacco', () => {
      controller.removeEmail('sacco-2', 'a@b.com', superAdmin);

      expect(saccoService.removeEmail).toHaveBeenCalledWith(
        'sacco-2',
        'a@b.com',
      );
    });
  });
});