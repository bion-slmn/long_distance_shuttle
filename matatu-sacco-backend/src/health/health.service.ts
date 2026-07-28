// src/health/health.service.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service';

export interface SystemHealth {
  api: {
    status: 'up' | 'down';
  };
  database: {
    status: 'up' | 'down';
    responseTime: number; // ms
  };
  failedRequests: number;
  queueJobs: number | null; // null = not tracked yet, no BullMQ wired up
  lastBackup: string | null; // null = not tracked yet, no backup automation wired up
}

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly metricsService: MetricsService,
  ) { }

  async getSystemHealth(): Promise<SystemHealth> {
    const dbStart = Date.now();
    let dbStatus: 'up' | 'down' = 'up';

    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      dbStatus = 'down';
    }

    const dbResponseTime = Date.now() - dbStart;

    const failedRequests = await this.metricsService.getFailedRequestsToday();

    return {
      api: {
        // If this handler runs at all, the API process is up — a genuinely
        // down API can't respond to this request in the first place. This
        // field is really only meaningful once you're checking it from an
        // external monitor (e.g. Grafana/Prometheus pinging you from outside),
        // not from an endpoint the API serves about itself.
        status: 'up',
      },
      database: {
        status: dbStatus,
        responseTime: dbResponseTime,
      },
      failedRequests,
      queueJobs: null,
      lastBackup: null,
    };
  }
}