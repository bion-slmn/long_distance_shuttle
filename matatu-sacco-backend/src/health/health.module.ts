// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [MetricsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule { }