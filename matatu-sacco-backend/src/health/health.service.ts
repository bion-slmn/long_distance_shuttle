// src/health/health.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  RedisConnectionSnapshot,
  RedisConnectionTracker,
} from '../redis/redis-connection.tracker';

export const PAYMENT_RECONCILE_QUEUE = 'payment-reconcile';

/** Upper bound on a single dependency probe so one hung socket can't stall the whole response. */
const PROBE_TIMEOUT_MS = 2_000;

export interface QueueJobCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface SystemHealth {
  api: {
    status: 'up' | 'down';
  };
  database: {
    status: 'up' | 'down';
    responseTime: number; // ms
  };
  redis: {
    status: 'up' | 'down';
    responseTime: number; // ms
    /** ioredis's own view of the socket: 'ready', 'reconnecting', 'connecting', 'end', ... */
    connectionState: string;
  } & RedisConnectionSnapshot;
  queue: {
    status: 'up' | 'down';
    responseTime: number; // ms
    jobs: QueueJobCounts | null; // null when the queue's own Redis connection is down
  };
  failedRequests: number | null; // null when the counter's Redis store is unreachable
  queueJobs: number | null; // waiting + active + delayed, kept for the existing dashboard tile
  lastBackup: string | null; // null = not tracked yet, no backup automation wired up
}

interface Probe<T> {
  status: 'up' | 'down';
  responseTime: number;
  value: T | null;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly metricsService: MetricsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly redisTracker: RedisConnectionTracker,
    @InjectQueue(PAYMENT_RECONCILE_QUEUE) private readonly reconcileQueue: Queue,
  ) { }

  async getSystemHealth(): Promise<SystemHealth> {
    // Probes run concurrently: a slow or dead dependency shouldn't make the
    // others wait, and the response time of each is measured on its own.
    const [database, redis, queue, failedRequests] = await Promise.all([
      this.probe(() => this.dataSource.query('SELECT 1')),
      this.probe(() => this.redis.ping()),
      this.probe(() =>
        this.reconcileQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      ),
      this.metricsService.getFailedRequestsToday().catch(() => null),
    ]);

    const jobs: QueueJobCounts | null = queue.value
      ? {
        waiting: queue.value.waiting ?? 0,
        active: queue.value.active ?? 0,
        delayed: queue.value.delayed ?? 0,
        failed: queue.value.failed ?? 0,
      }
      : null;

    return {
      api: {
        // If this handler runs at all, the API process is up — a genuinely
        // down API can't respond to this request in the first place. This
        // field is really only meaningful once you're checking it from an
        // external monitor (e.g. UptimeRobot / Render health check pinging
        // you from outside), not from an endpoint the API serves about itself.
        status: 'up',
      },
      database: {
        status: database.status,
        responseTime: database.responseTime,
      },
      redis: {
        status: redis.status,
        responseTime: redis.responseTime,
        connectionState: this.redis.status,
        ...this.redisTracker.snapshot(),
      },
      queue: {
        status: queue.status,
        responseTime: queue.responseTime,
        jobs,
      },
      failedRequests,
      queueJobs: jobs ? jobs.waiting + jobs.active + jobs.delayed : null,
      lastBackup: null,
    };
  }

  /** Run one dependency check, timing it and converting any failure or timeout into 'down'. */
  private async probe<T>(check: () => Promise<T>): Promise<Probe<T>> {
    const start = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`health probe timed out after ${PROBE_TIMEOUT_MS}ms`)),
        PROBE_TIMEOUT_MS,
      );
    });

    try {
      const value = await Promise.race([check(), timeout]);
      return { status: 'up', responseTime: Date.now() - start, value };
    } catch {
      return { status: 'down', responseTime: Date.now() - start, value: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
