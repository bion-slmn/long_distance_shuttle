// route.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';
import { RouteQueueService } from './route-queue.service';
import { RouteAnalyticsService } from './route-analytics.service';
import { UserRole } from '../auth/entities/user.entity';
import { QueueEntryStatus } from './entities/queue-entry.entity';

describe('RouteController', () => {
  let controller: RouteController;
  let routeService: jest.Mocked<RouteService>;
  let routeQueueService: jest.Mocked<RouteQueueService>;
  let routeAnalyticsService: jest.Mocked<RouteAnalyticsService>;

  const superAdmin = { id: 'u1', role: UserRole.SUPER_ADMIN, saccoId: null, assignedStage: null };
  const saccoAdmin = { id: 'u2', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1', assignedStage: null };
  const saccoAdminNoSacco = { id: 'u3', role: UserRole.SACCO_ADMIN, saccoId: null, assignedStage: null };
  const clerk = { id: 'u4', role: UserRole.CLERK, saccoId: 'sacco-1', assignedStage: 'NAIROBI' };

  beforeEach(async () => {

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RouteController],
      providers: [
        {
          provide: RouteService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOneScoped: jest.fn(),
            update: jest.fn(),
            addStage: jest.fn(),
            removeStage: jest.fn(),
            getAvailableLocations: jest.fn(),
            searchRoutes: jest.fn(),
          },
        },
        {
          provide: RouteQueueService,
          useValue: {
            clockInVehicle: jest.fn(),
            findAvailableVehiclesForRoute: jest.fn(),
            findAllQueueEntries: jest.fn(),
            findOneQueueEntry: jest.fn(),
            updateQueueEntry: jest.fn(),
            removeVehicleFromQueue: jest.fn(),
          },
        },
        {
          provide: RouteAnalyticsService,
          useValue: {
            getAverageFillTimeComparison: jest.fn(),
            getFastestRoutesToday: jest.fn(),
            getRoutePerformanceVsYesterday: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(RouteController);
    routeService = module.get(RouteService);
    routeQueueService = module.get(RouteQueueService);
    routeAnalyticsService = module.get(RouteAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('passes body through unchanged for SUPER_ADMIN', () => {
      const body = { saccoId: 'sacco-9', origin: 'A', destination: 'B' } as any;

      controller.create(body, superAdmin);

      expect(routeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-9' }),
      );
    });

    it('overrides body.saccoId with the SACCO_ADMIN own saccoId', () => {
      const body = { saccoId: 'someone-elses-sacco', origin: 'A', destination: 'B' } as any;

      controller.create(body, saccoAdmin);

      expect(routeService.create).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-1' }),
      );
    });

    it('throws ForbiddenException if SACCO_ADMIN has no saccoId', () => {
      const body = { origin: 'A', destination: 'B' } as any;

      expect(() => controller.create(body, saccoAdminNoSacco)).toThrow(
        ForbiddenException,
      );
      expect(routeService.create).not.toHaveBeenCalled();
    });
  });

  // ── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('leaves saccoId undefined for SUPER_ADMIN', () => {
      controller.findAll(superAdmin);

      expect(routeService.findAll).toHaveBeenCalledWith(undefined, null);
    });

    it('scopes to own saccoId for SACCO_ADMIN', () => {
      controller.findAll(saccoAdmin);

      expect(routeService.findAll).toHaveBeenCalledWith('sacco-1', null);
    });

    it('passes assignedStage through for CLERK', () => {
      controller.findAll(clerk);

      expect(routeService.findAll).toHaveBeenCalledWith('sacco-1', 'NAIROBI');
    });
  });

  // ── analytics endpoints ─────────────────────────────────────────────────

  describe('getAverageFillTimeComparison', () => {
    it('delegates to routeAnalyticsService with resolved saccoId', () => {
      controller.getAverageFillTimeComparison(saccoAdmin);

      expect(routeAnalyticsService.getAverageFillTimeComparison).toHaveBeenCalledWith(
        'sacco-1',
      );
    });

    it('passes undefined saccoId for SUPER_ADMIN', () => {
      controller.getAverageFillTimeComparison(superAdmin);

      expect(routeAnalyticsService.getAverageFillTimeComparison).toHaveBeenCalledWith(
        undefined,
      );
    });
  });

  describe('getFastestRoutesToday', () => {
    it('delegates to routeAnalyticsService with resolved saccoId', () => {
      controller.getFastestRoutesToday(saccoAdmin);

      expect(routeAnalyticsService.getFastestRoutesToday).toHaveBeenCalledWith(
        'sacco-1',
      );
    });
  });

  describe('getRoutePerformanceVsYesterday', () => {
    it('delegates to routeAnalyticsService with resolved saccoId', () => {
      controller.getRoutePerformanceVsYesterday(superAdmin);

      expect(routeAnalyticsService.getRoutePerformanceVsYesterday).toHaveBeenCalledWith(
        undefined,
      );
    });
  });

  // ── public endpoints ────────────────────────────────────────────────────

  describe('getAvailableLocations', () => {
    it('delegates to routeService with no arguments', () => {
      controller.getAvailableLocations();

      expect(routeService.getAvailableLocations).toHaveBeenCalledWith();
    });
  });

  describe('searchRoutes', () => {
    it('passes origin and destination straight through', () => {
      controller.searchRoutes('NAIROBI', 'MOMBASA');

      expect(routeService.searchRoutes).toHaveBeenCalledWith('NAIROBI', 'MOMBASA');
    });
  });

  // ── queue endpoints ─────────────────────────────────────────────────────

  describe('clockInVehicle', () => {
    const body = { routeId: 'route-1', vehicleId: 'v1' } as any;

    it('resolves saccoId and assignedStage for CLERK', () => {
      controller.clockInVehicle(body, clerk);

      expect(routeQueueService.clockInVehicle).toHaveBeenCalledWith(
        body,
        'sacco-1',
        'NAIROBI',
      );
    });

    it('does not pass assignedStage for SACCO_ADMIN', () => {
      controller.clockInVehicle(body, saccoAdmin);

      expect(routeQueueService.clockInVehicle).toHaveBeenCalledWith(
        body,
        'sacco-1',
        undefined,
      );
    });

    it('leaves saccoId and assignedStage undefined for SUPER_ADMIN', () => {
      controller.clockInVehicle(body, superAdmin);

      expect(routeQueueService.clockInVehicle).toHaveBeenCalledWith(
        body,
        undefined,
        undefined,
      );
    });
  });

  describe('findAvailableVehicles', () => {
    it('defaults date to now when dateString is omitted', () => {
      controller.findAvailableVehicles('route-1', undefined, saccoAdmin);

      expect(routeQueueService.findAvailableVehiclesForRoute).toHaveBeenCalledWith(
        'route-1',
        expect.any(Date),
        'sacco-1',
        undefined,
      );
    });

    it('parses a provided dateString', () => {
      controller.findAvailableVehicles('route-1', '2026-08-03', saccoAdmin);

      const callArgs = routeQueueService.findAvailableVehiclesForRoute.mock.calls[0];
      expect(callArgs[1].toISOString().slice(0, 10)).toBe('2026-08-03');
    });

    it('resolves saccoId and assignedStage for CLERK', () => {
      controller.findAvailableVehicles('route-1', undefined, clerk);

      const callArgs = routeQueueService.findAvailableVehiclesForRoute.mock.calls[0];
      expect(callArgs[2]).toBe('sacco-1');
      expect(callArgs[3]).toBe('NAIROBI');
    });

    it('leaves saccoId and assignedStage undefined for SUPER_ADMIN', () => {
      controller.findAvailableVehicles('route-1', undefined, superAdmin);

      const callArgs = routeQueueService.findAvailableVehiclesForRoute.mock.calls[0];
      expect(callArgs[2]).toBeUndefined();
      expect(callArgs[3]).toBeUndefined();
    });
  });
  describe('findAllQueueEntries', () => {
    it('passes routeId, status, and parsed date through', () => {
      controller.findAllQueueEntries('route-1', QueueEntryStatus.WAITING, '2026-08-03');

      expect(routeQueueService.findAllQueueEntries).toHaveBeenCalledWith({
        routeId: 'route-1',
        routeIds: undefined,
        status: QueueEntryStatus.WAITING,
        date: expect.any(Date),
      });
    });

    it('leaves date undefined when dateString is omitted', () => {
      controller.findAllQueueEntries();

      expect(routeQueueService.findAllQueueEntries).toHaveBeenCalledWith({
        routeId: undefined,
        routeIds: undefined,
        status: undefined,
        date: undefined,
      });
    });

    it('splits the routeIds csv into a list', () => {
      controller.findAllQueueEntries(
        undefined,
        undefined,
        undefined,
        'route-1, route-2 ,route-3',
      );

      expect(routeQueueService.findAllQueueEntries).toHaveBeenCalledWith({
        routeId: undefined,
        routeIds: ['route-1', 'route-2', 'route-3'],
        status: undefined,
        date: undefined,
      });
    });

    it('treats an empty routeIds csv as absent rather than as an empty filter', () => {
      controller.findAllQueueEntries(undefined, undefined, undefined, ' , ');

      expect(routeQueueService.findAllQueueEntries).toHaveBeenCalledWith({
        routeId: undefined,
        routeIds: undefined,
        status: undefined,
        date: undefined,
      });
    });
  });

  describe('findOneQueueEntry', () => {
    it('delegates to routeQueueService with the id', () => {
      controller.findOneQueueEntry('qe1');

      expect(routeQueueService.findOneQueueEntry).toHaveBeenCalledWith('qe1');
    });
  });

  describe('updateQueueEntry', () => {
    const body = { status: QueueEntryStatus.BOARDING } as any;

    it('resolves saccoId and assignedStage for CLERK', () => {
      controller.updateQueueEntry('qe1', body, clerk);

      expect(routeQueueService.updateQueueEntry).toHaveBeenCalledWith(
        'qe1',
        body,
        'sacco-1',
        'NAIROBI',
      );
    });

    it('leaves saccoId and assignedStage undefined for SUPER_ADMIN', () => {
      controller.updateQueueEntry('qe1', body, superAdmin);

      expect(routeQueueService.updateQueueEntry).toHaveBeenCalledWith(
        'qe1',
        body,
        undefined,
        undefined,
      );
    });
  });

  describe('removeVehicleFromQueue', () => {
    it('resolves saccoId for SACCO_ADMIN', () => {
      controller.removeVehicleFromQueue('qe1', saccoAdmin);

      expect(routeQueueService.removeVehicleFromQueue).toHaveBeenCalledWith(
        'qe1',
        'sacco-1',
        undefined,
      );
    });

    it('resolves saccoId and assignedStage for CLERK', () => {
      controller.removeVehicleFromQueue('qe1', clerk);

      expect(routeQueueService.removeVehicleFromQueue).toHaveBeenCalledWith(
        'qe1',
        'sacco-1',
        'NAIROBI',
      );
    });

    it('leaves saccoId and assignedStage undefined for SUPER_ADMIN', () => {
      controller.removeVehicleFromQueue('qe1', superAdmin);

      expect(routeQueueService.removeVehicleFromQueue).toHaveBeenCalledWith(
        'qe1',
        undefined,
        undefined,
      );
    });
  });

  // ── dynamic :id endpoints ───────────────────────────────────────────────

  describe('findOne', () => {
    it('resolves saccoId based on role', () => {
      controller.findOne('route-1', saccoAdmin);

      expect(routeService.findOneScoped).toHaveBeenCalledWith('route-1', 'sacco-1');
    });

    it('leaves saccoId undefined for SUPER_ADMIN', () => {
      controller.findOne('route-1', superAdmin);

      expect(routeService.findOneScoped).toHaveBeenCalledWith('route-1', undefined);
    });
  });

  describe('update', () => {
    it('resolves saccoId and forwards the body', () => {
      const body = { description: 'updated' } as any;

      controller.update('route-1', body, saccoAdmin);

      expect(routeService.update).toHaveBeenCalledWith('route-1', body, 'sacco-1');
    });
  });

  describe('addStage', () => {
    it('resolves saccoId and forwards the stage name', () => {
      controller.addStage('route-1', 'EMALI', saccoAdmin);

      expect(routeService.addStage).toHaveBeenCalledWith('route-1', 'EMALI', 'sacco-1');
    });
  });

  describe('removeStage', () => {
    it('resolves saccoId and forwards the stage name', () => {
      controller.removeStage('route-1', 'EMALI', saccoAdmin);

      expect(routeService.removeStage).toHaveBeenCalledWith('route-1', 'EMALI', 'sacco-1');
    });
  });
});