// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthService, PAYMENT_RECONCILE_QUEUE } from './health.service';
import { HealthController } from './health.controller';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    MetricsModule,
    // Registers a Queue handle (not a worker) so the health probe exercises
    // BullMQ's own Redis connection, which is configured separately from
    // REDIS_CLIENT and can be broken while the main client is fine.
    BullModule.registerQueue({ name: PAYMENT_RECONCILE_QUEUE }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule { }
