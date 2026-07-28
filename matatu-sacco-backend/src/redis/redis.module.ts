// src/redis/redis.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                return new Redis({
                    host: config.get<string>('REDIS_HOST', 'localhost'),
                    port: config.get<number>('REDIS_PORT', 6379),
                    password: config.get<string>('REDIS_PASSWORD') || undefined,
                    // If BullMQ is already pointed at a different Redis (e.g. a managed
                    // instance), swap these three lines for the same env vars it uses,
                    // once you confirm what those are.
                });
            },
        },
    ],
    exports: [REDIS_CLIENT],
})
export class RedisModule { }