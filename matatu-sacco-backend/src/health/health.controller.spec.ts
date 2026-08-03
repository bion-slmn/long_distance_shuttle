// health.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: jest.Mocked<HealthService>;

  const mockHealthResult = {
    api: { status: 'up' as const },
    database: { status: 'up' as const, responseTime: 12 },
    failedRequests: 3,
    queueJobs: null,
    lastBackup: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            getSystemHealth: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(HealthController);
    service = module.get(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to healthService.getSystemHealth and returns its result untouched', async () => {
    service.getSystemHealth.mockResolvedValue(mockHealthResult);

    const result = await controller.getSystemHealth();

    expect(service.getSystemHealth).toHaveBeenCalledTimes(1);
    expect(service.getSystemHealth).toHaveBeenCalledWith();
    expect(result).toEqual(mockHealthResult);
  });

  it('propagates an error if healthService.getSystemHealth rejects', async () => {
    service.getSystemHealth.mockRejectedValue(new Error('unexpected failure'));

    await expect(controller.getSystemHealth()).rejects.toThrow(
      'unexpected failure',
    );
  });
});