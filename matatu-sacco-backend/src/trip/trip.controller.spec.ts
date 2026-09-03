import { ForbiddenException } from '@nestjs/common';
// trip.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TripController } from './trip.controller';
import { TripService } from './trip.service';
import { TripStatus } from './entities/trip.entity';
import { UserRole } from 'src/auth/entities/user.entity';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { RolesGuard } from 'src/guards/roles.guard';

describe('TripController', () => {
  let controller: TripController;
  let tripService: jest.Mocked<TripService>;

  const saccoAdminUser = { role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' };
  const superAdminUser = { role: UserRole.SUPER_ADMIN, saccoId: 'sacco-1' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TripController],
      providers: [
        {
          provide: TripService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOneScoped: jest.fn(),
            update: jest.fn(),
            updatePassengerCount: jest.fn(),
            markDeparted: jest.fn(),
            cancel: jest.fn(),
            remove: jest.fn(),
            getTripCountSummary: jest.fn(),
            getAverageTripsPerVehicleSummary: jest.fn(),
            getTripTrend: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TripController);
    tripService = module.get(TripService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('delegates straight to tripService.create', async () => {
      const dto = { fare: 100 } as any;
      tripService.create.mockResolvedValue({ id: 'trip-1' } as any);

      const result = await controller.create(dto, superAdminUser);

      expect(tripService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'trip-1' });
    });

    it('SECURITY: pins saccoId to the caller\'s own sacco for non-super-admins', async () => {
      const dto = { fare: 100, saccoId: 'someone-elses-sacco' } as any;
      tripService.create.mockResolvedValue({ id: 'trip-1' } as any);

      await controller.create(dto, saccoAdminUser);

      expect(tripService.create).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: saccoAdminUser.saccoId }),
      );
    });

    it('SECURITY: refuses a non-super-admin with no sacco', async () => {
      expect(() =>
        controller.create({ fare: 100 } as any, { role: UserRole.CLERK, saccoId: null }),
      ).toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('scopes to the caller sacco for a SACCO_ADMIN', async () => {
      await controller.findAll(saccoAdminUser, 'route-1', 'v1', TripStatus.BOARDING, 1, 20, '2026-08-03', 'KDA');

      expect(tripService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          saccoId: 'sacco-1',
          isSuperAdmin: false,
          routeId: 'route-1',
          vehicleId: 'v1',
          status: TripStatus.BOARDING,
          page: 1,
          limit: 20,
          plateNumber: 'KDA',
        }),
      );
    });

    it('leaves saccoId undefined for a SUPER_ADMIN', async () => {
      await controller.findAll(superAdminUser);

      expect(tripService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined, isSuperAdmin: true }),
      );
    });

    it('converts a date query param into a Date', async () => {
      await controller.findAll(saccoAdminUser, undefined, undefined, undefined, undefined, undefined, '2026-08-03');

      const arg = tripService.findAll.mock.calls[0][0];
      expect(arg.date).toBeInstanceOf(Date);
    });
  });

  describe('findOne', () => {
    it('scopes to the caller sacco for a SACCO_ADMIN', async () => {
      tripService.findOneScoped.mockResolvedValue({ id: 'trip-1' } as any);

      await controller.findOne('trip-1', saccoAdminUser);

      expect(tripService.findOneScoped).toHaveBeenCalledWith('trip-1', 'sacco-1');
    });

    it('passes saccoId undefined for a SUPER_ADMIN', async () => {
      await controller.findOne('trip-1', superAdminUser);

      expect(tripService.findOneScoped).toHaveBeenCalledWith('trip-1', undefined);
    });
  });

  describe('update', () => {
    it('scopes update to the caller sacco', async () => {
      const dto = { passengerCount: 5 } as any;

      await controller.update('trip-1', dto, saccoAdminUser);

      expect(tripService.update).toHaveBeenCalledWith('trip-1', dto, 'sacco-1');
    });

    it('does not scope update for a SUPER_ADMIN', async () => {
      const dto = { passengerCount: 5 } as any;

      await controller.update('trip-1', dto, superAdminUser);

      expect(tripService.update).toHaveBeenCalledWith('trip-1', dto, undefined);
    });
  });

  describe('updatePassengerCount', () => {
    it('scopes to the caller sacco', async () => {
      await controller.updatePassengerCount('trip-1', 10, saccoAdminUser);

      expect(tripService.updatePassengerCount).toHaveBeenCalledWith('trip-1', 10, 'sacco-1');
    });
  });

  // ── markDeparted — this is the endpoint the earlier fix targeted ────────
  describe('markDeparted', () => {
    it('passes the caller sacco through to tripService.markDeparted for a SACCO_ADMIN', async () => {
      tripService.markDeparted.mockResolvedValue({ id: 'trip-1' } as any);

      await controller.markDeparted('trip-1', saccoAdminUser);

      expect(tripService.markDeparted).toHaveBeenCalledWith('trip-1', 'sacco-1');
      expect(tripService.markDeparted).not.toHaveBeenCalledWith('trip-1', undefined);
    });

    it('passes the caller sacco through for a CLERK too, not just SACCO_ADMIN', async () => {
      const clerkUser = { role: UserRole.CLERK, saccoId: 'sacco-2' };

      await controller.markDeparted('trip-1', clerkUser);

      expect(tripService.markDeparted).toHaveBeenCalledWith('trip-1', 'sacco-2');
    });

    it('leaves saccoId undefined only for a SUPER_ADMIN', async () => {
      await controller.markDeparted('trip-1', superAdminUser);

      expect(tripService.markDeparted).toHaveBeenCalledWith('trip-1', undefined);
    });

    it('never omits the saccoId argument entirely for a non-super-admin caller', async () => {
      await controller.markDeparted('trip-1', saccoAdminUser);

      // Regression guard: catches an accidental revert to markDeparted(id) with no second arg,
      // which would silently drop tenant scoping again.
      expect(tripService.markDeparted.mock.calls[0]).toHaveLength(2);
    });
  });

  describe('cancel', () => {
    it('scopes cancel to the caller sacco', async () => {
      await controller.cancel('trip-1', saccoAdminUser);

      expect(tripService.cancel).toHaveBeenCalledWith('trip-1', 'sacco-1');
    });

    it('leaves saccoId undefined for a SUPER_ADMIN', async () => {
      await controller.cancel('trip-1', superAdminUser);

      expect(tripService.cancel).toHaveBeenCalledWith('trip-1', undefined);
    });
  });

  describe('remove', () => {
    it('scopes remove to the caller sacco', async () => {
      await controller.remove('trip-1', saccoAdminUser);

      expect(tripService.remove).toHaveBeenCalledWith('trip-1', 'sacco-1');
    });
  });

  describe('stats endpoints', () => {
    it('getTripCountSummary scopes to caller sacco for non-super-admin', async () => {
      await controller.getTripCountSummary(saccoAdminUser);
      expect(tripService.getTripCountSummary).toHaveBeenCalledWith('sacco-1');
    });

    it('getTripCountSummary is fleet-wide for SUPER_ADMIN', async () => {
      await controller.getTripCountSummary(superAdminUser);
      expect(tripService.getTripCountSummary).toHaveBeenCalledWith(undefined);
    });

    it('getAverageTripsPerVehicleSummary scopes to caller sacco', async () => {
      await controller.getAverageTripsPerVehicleSummary(saccoAdminUser);
      expect(tripService.getAverageTripsPerVehicleSummary).toHaveBeenCalledWith('sacco-1');
    });

    it('getTripTrend defaults to 7 days and scopes to caller sacco', async () => {
      await controller.getTripTrend(saccoAdminUser);
      expect(tripService.getTripTrend).toHaveBeenCalledWith(7, 'sacco-1');
    });

    it('getTripTrend respects an explicit days param', async () => {
      await controller.getTripTrend(saccoAdminUser, 30);
      expect(tripService.getTripTrend).toHaveBeenCalledWith(30, 'sacco-1');
    });

    it('getTripTrend is fleet-wide for SUPER_ADMIN', async () => {
      await controller.getTripTrend(superAdminUser);
      expect(tripService.getTripTrend).toHaveBeenCalledWith(7, undefined);
    });
  });
});