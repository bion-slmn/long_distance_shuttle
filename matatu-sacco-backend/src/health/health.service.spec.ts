// health.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';
import { MetricsService } from '../metrics/metrics.service';

describe('HealthService', () => {
  let service: HealthService;
  let dataSource: jest.Mocked<DataSource>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DataSource,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            getFailedRequestsToday: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(HealthService);
    dataSource = module.get(DataSource);
    metricsService = module.get(MetricsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('always reports api.status as up, since a down API could not serve this response', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    const result = await service.getSystemHealth();

    expect(result.api.status).toBe('up');
  });

  it('reports database.status as up when the ping query succeeds', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    const result = await service.getSystemHealth();

    expect(result.database.status).toBe('up');
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports database.status as down when the ping query throws', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    const result = await service.getSystemHealth();

    expect(result.database.status).toBe('down');
  });

  it('does not throw or propagate the DB error when the ping fails', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    await expect(service.getSystemHealth()).resolves.toBeDefined();
  });

  it('still returns failedRequests and other fields when the DB ping fails', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    metricsService.getFailedRequestsToday.mockResolvedValue(7);

    const result = await service.getSystemHealth();

    expect(result.failedRequests).toBe(7);
    expect(result.queueJobs).toBeNull();
    expect(result.lastBackup).toBeNull();
  });

  it('measures database.responseTime as a non-negative number', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    const result = await service.getSystemHealth();

    expect(typeof result.database.responseTime).toBe('number');
    expect(result.database.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('still measures responseTime even when the ping fails (time to failure)', async () => {
    dataSource.query.mockRejectedValue(new Error('timeout'));
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    const result = await service.getSystemHealth();

    expect(typeof result.database.responseTime).toBe('number');
    expect(result.database.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('passes through the exact failedRequests count from MetricsService', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockResolvedValue(42);

    const result = await service.getSystemHealth();

    expect(result.failedRequests).toBe(42);
    expect(metricsService.getFailedRequestsToday).toHaveBeenCalledTimes(1);
  });

  it('always returns queueJobs as null (not yet wired up)', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    const result = await service.getSystemHealth();

    expect(result.queueJobs).toBeNull();
  });

  it('always returns lastBackup as null (not yet wired up)', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockResolvedValue(0);

    const result = await service.getSystemHealth();

    expect(result.lastBackup).toBeNull();
  });

  it('propagates an error if metricsService.getFailedRequestsToday rejects', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockRejectedValue(
      new Error('Redis unavailable'),
    );

    await expect(service.getSystemHealth()).rejects.toThrow('Redis unavailable');
  });
});