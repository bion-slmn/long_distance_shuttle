import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { HealthService, PAYMENT_RECONCILE_QUEUE } from './health.service';
import { MetricsService } from '../metrics/metrics.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RedisConnectionTracker } from '../redis/redis-connection.tracker';

describe('HealthService', () => {
  let service: HealthService;
  let dataSource: jest.Mocked<DataSource>;
  let metricsService: jest.Mocked<MetricsService>;
  let redis: { ping: jest.Mock; status: string };
  let queue: { getJobCounts: jest.Mock };
  let tracker: RedisConnectionTracker;

  const healthyCounts = { waiting: 2, active: 1, delayed: 3, failed: 4 };

  beforeEach(async () => {
    redis = { ping: jest.fn(), status: 'ready' };
    queue = { getJobCounts: jest.fn() };
    tracker = new RedisConnectionTracker();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: MetricsService, useValue: { getFailedRequestsToday: jest.fn() } },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: RedisConnectionTracker, useValue: tracker },
        { provide: getQueueToken(PAYMENT_RECONCILE_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get(HealthService);
    dataSource = module.get(DataSource);
    metricsService = module.get(MetricsService);

    // Everything healthy by default; individual tests break one dependency.
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    metricsService.getFailedRequestsToday.mockResolvedValue(0);
    redis.ping.mockResolvedValue('PONG');
    queue.getJobCounts.mockResolvedValue(healthyCounts);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('always reports api.status as up, since a down API could not serve this response', async () => {
    const result = await service.getSystemHealth();

    expect(result.api.status).toBe('up');
  });

  describe('database', () => {
    it('reports up when the ping query succeeds', async () => {
      const result = await service.getSystemHealth();

      expect(result.database.status).toBe('up');
      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('reports down when the ping query throws, without propagating the error', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));

      const result = await service.getSystemHealth();

      expect(result.database.status).toBe('down');
    });

    it('still returns the other fields when the DB ping fails', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));
      metricsService.getFailedRequestsToday.mockResolvedValue(7);

      const result = await service.getSystemHealth();

      expect(result.failedRequests).toBe(7);
      expect(result.redis.status).toBe('up');
      expect(result.lastBackup).toBeNull();
    });

    it('measures responseTime as a non-negative number, even on failure', async () => {
      dataSource.query.mockRejectedValue(new Error('timeout'));

      const result = await service.getSystemHealth();

      expect(typeof result.database.responseTime).toBe('number');
      expect(result.database.responseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('redis', () => {
    it('reports up with the client connection state when PING succeeds', async () => {
      const result = await service.getSystemHealth();

      expect(redis.ping).toHaveBeenCalledTimes(1);
      expect(result.redis.status).toBe('up');
      expect(result.redis.connectionState).toBe('ready');
      expect(result.redis.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('reports down when PING rejects, without propagating the error', async () => {
      redis.ping.mockRejectedValue(new Error('read ECONNRESET'));
      redis.status = 'reconnecting';

      const result = await service.getSystemHealth();

      expect(result.redis.status).toBe('down');
      expect(result.redis.connectionState).toBe('reconnecting');
    });

    it('reports down when PING hangs past the probe timeout', async () => {
      jest.useFakeTimers();
      redis.ping.mockReturnValue(new Promise(() => { }));

      const pending = service.getSystemHealth();
      await jest.advanceTimersByTimeAsync(2_500);
      const result = await pending;

      expect(result.redis.status).toBe('down');
      expect(result.database.status).toBe('up');
    });

    it('exposes the error history recorded by the connection tracker', async () => {
      tracker.recordError(new Error('read ECONNRESET'));
      tracker.recordReconnect();
      tracker.recordReconnect();

      const result = await service.getSystemHealth();

      expect(result.redis.lastError).toBe('read ECONNRESET');
      expect(result.redis.lastErrorAt).toEqual(expect.any(String));
      expect(result.redis.reconnects).toBe(2);
    });

    it('reports no error history when nothing has gone wrong since boot', async () => {
      const result = await service.getSystemHealth();

      expect(result.redis.lastError).toBeNull();
      expect(result.redis.lastErrorAt).toBeNull();
      expect(result.redis.reconnects).toBe(0);
    });
  });

  describe('queue', () => {
    it('reports up with job counts and a summed queueJobs total', async () => {
      const result = await service.getSystemHealth();

      expect(queue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'failed');
      expect(result.queue.status).toBe('up');
      expect(result.queue.jobs).toEqual(healthyCounts);
      // waiting + active + delayed; failed jobs are not "pending work"
      expect(result.queueJobs).toBe(6);
    });

    it('reports down with null counts when getJobCounts rejects', async () => {
      queue.getJobCounts.mockRejectedValue(new Error('Connection is closed.'));

      const result = await service.getSystemHealth();

      expect(result.queue.status).toBe('down');
      expect(result.queue.jobs).toBeNull();
      expect(result.queueJobs).toBeNull();
    });

    it('can be down while the main redis client is up (separate connections)', async () => {
      queue.getJobCounts.mockRejectedValue(new Error('Connection is closed.'));

      const result = await service.getSystemHealth();

      expect(result.redis.status).toBe('up');
      expect(result.queue.status).toBe('down');
    });
  });

  describe('failedRequests', () => {
    it('passes through the exact count from MetricsService', async () => {
      metricsService.getFailedRequestsToday.mockResolvedValue(42);

      const result = await service.getSystemHealth();

      expect(result.failedRequests).toBe(42);
      expect(metricsService.getFailedRequestsToday).toHaveBeenCalledTimes(1);
    });

    it('returns null instead of failing the whole response when the counter store is unreachable', async () => {
      metricsService.getFailedRequestsToday.mockRejectedValue(new Error('Redis unavailable'));

      const result = await service.getSystemHealth();

      expect(result.failedRequests).toBeNull();
      expect(result.database.status).toBe('up');
    });
  });

  it('always returns lastBackup as null (not yet wired up)', async () => {
    const result = await service.getSystemHealth();

    expect(result.lastBackup).toBeNull();
  });
});
