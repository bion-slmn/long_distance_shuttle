// fleet.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';
import { VehicleStatus } from './entities/fleet.entity';
import { UserRole } from '../auth/entities/user.entity';

describe('FleetController', () => {
  let controller: FleetController;
  let service: jest.Mocked<FleetService>;

  const superAdmin = { id: 'u1', role: UserRole.SUPER_ADMIN, saccoId: null };
  const saccoAdmin = { id: 'u2', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
  const saccoAdminNoSacco = { id: 'u3', role: UserRole.SACCO_ADMIN, saccoId: null };
  const clerk = { id: 'u4', role: UserRole.CLERK, saccoId: 'sacco-1' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FleetController],
      providers: [
        {
          provide: FleetService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOneScoped: jest.fn(),
            update: jest.fn(),
            setStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(FleetController);
    service = module.get(FleetService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('passes body through unchanged for SUPER_ADMIN', () => {
      const body = { saccoId: 'sacco-9', plateNumber: 'KDA 123X' } as any;

      controller.create(body, superAdmin);

      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-9' }),
      );
    });

    it('overrides body.saccoId with the SACCO_ADMIN own saccoId', () => {
      const body = { saccoId: 'someone-elses-sacco', plateNumber: 'KDA 123X' } as any;

      controller.create(body, saccoAdmin);

      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('throws ForbiddenException if SACCO_ADMIN has no saccoId', () => {
      const body = { plateNumber: 'KDA 123X' } as any;

      expect(() => controller.create(body, saccoAdminNoSacco)).toThrow(
        ForbiddenException,
      );
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('leaves saccoId undefined for SUPER_ADMIN with no saccoId query param', () => {
      controller.findAll(superAdmin);

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined }),
      );
    });

    it('scopes to the user own saccoId for SACCO_ADMIN', () => {
      controller.findAll(saccoAdmin);

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('scopes to the user own saccoId for CLERK', () => {
      controller.findAll(clerk);

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('ignores a saccoId query param override for non-SUPER_ADMIN roles', () => {
      controller.findAll(
        clerk,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'sacco-999',
      );

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('lets SUPER_ADMIN override saccoId via query param', () => {
      controller.findAll(
        superAdmin,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'sacco-999',
      );

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-999' }),
      );
    });

    it('parses page and limit to numbers', () => {
      controller.findAll(
        superAdmin,
        undefined,
        undefined,
        '2',
        '50',
      );

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 50 }),
      );
    });

    it('leaves page/limit undefined when not provided', () => {
      controller.findAll(superAdmin);

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: undefined, limit: undefined }),
      );
    });

    it('parses withQueueStatus="true" as boolean true', () => {
      controller.findAll(
        superAdmin,
        undefined,
        undefined,
        undefined,
        undefined,
        'true',
      );

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ withQueueStatus: true }),
      );
    });

    it('parses any non-"true" withQueueStatus value as false', () => {
      controller.findAll(
        superAdmin,
        undefined,
        undefined,
        undefined,
        undefined,
        'yes',
      );

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ withQueueStatus: false }),
      );
    });

    it('passes status and search through untouched', () => {
      controller.findAll(
        superAdmin,
        VehicleStatus.ACTIVE,
        'KDA',
      );

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: VehicleStatus.ACTIVE, search: 'KDA' }),
      );
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('passes undefined saccoId for SUPER_ADMIN', () => {
      controller.findOne('vehicle-1', superAdmin);

      expect(service.findOneScoped).toHaveBeenCalledWith('vehicle-1', undefined);
    });

    it('passes the own saccoId for SACCO_ADMIN', () => {
      controller.findOne('vehicle-1', saccoAdmin);

      expect(service.findOneScoped).toHaveBeenCalledWith('vehicle-1', 'sacco-1');
    });

    it('passes the own saccoId for CLERK', () => {
      controller.findOne('vehicle-1', clerk);

      expect(service.findOneScoped).toHaveBeenCalledWith('vehicle-1', 'sacco-1');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('scopes update to undefined saccoId for SUPER_ADMIN', () => {
      const body = { plateNumber: 'KDB 456Y' } as any;

      controller.update('vehicle-1', body, superAdmin);

      expect(service.update).toHaveBeenCalledWith('vehicle-1', body, undefined);
    });

    it('scopes update to own saccoId for SACCO_ADMIN', () => {
      const body = { plateNumber: 'KDB 456Y' } as any;

      controller.update('vehicle-1', body, saccoAdmin);

      expect(service.update).toHaveBeenCalledWith('vehicle-1', body, 'sacco-1');
    });
  });

  // ── setStatus ─────────────────────────────────────────────────────────────

  describe('setStatus', () => {
    it('scopes to undefined saccoId for SUPER_ADMIN', () => {
      controller.setStatus('vehicle-1', VehicleStatus.ACTIVE, superAdmin);

      expect(service.setStatus).toHaveBeenCalledWith(
        'vehicle-1',
        VehicleStatus.ACTIVE,
        undefined,
      );
    });

    it('scopes to own saccoId for CLERK', () => {
      controller.setStatus('vehicle-1', VehicleStatus.MAINTENANCE, clerk);

      expect(service.setStatus).toHaveBeenCalledWith(
        'vehicle-1',
        VehicleStatus.MAINTENANCE,
        'sacco-1',
      );
    });
  });
});