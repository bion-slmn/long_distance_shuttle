// src/metrics/metrics.service.ts
import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class MetricsService {
    private readonly TTL_SECONDS = 60 * 60 * 24 * 90; // keep 90 days of daily counters

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) { }

    private todayKey(): string {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        return `failed_requests:${today}`;
    }

    async incrementFailedRequest(): Promise<void> {
        const key = this.todayKey();
        // INCR + EXPIRE in one round trip via pipeline — avoids a race where
        // the key gets created without a TTL if the process crashes between calls.
        const pipeline = this.redis.pipeline();
        pipeline.incr(key);
        pipeline.expire(key, this.TTL_SECONDS);
        await pipeline.exec();
    }

    async getFailedRequestsToday(): Promise<number> {
        const value = await this.redis.get(this.todayKey());
        return value ? Number(value) : 0;
    }
}