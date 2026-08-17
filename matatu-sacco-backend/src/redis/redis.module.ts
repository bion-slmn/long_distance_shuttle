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
                const redisUrl = config.get<string>('REDIS_URL');

                if (redisUrl) {
                    // Upstash / any managed Redis with a full connection URL (rediss://...)
                    return new Redis(redisUrl, {
                        maxRetriesPerRequest: null, // required if BullMQ shares this connection
                    });
                }

                // Local/dev fallback
                return new Redis({
                    host: config.get<string>('REDIS_HOST', 'localhost'),
                    port: config.get<number>('REDIS_PORT', 6379),
                    password: config.get<string>('REDIS_PASSWORD') || undefined,
                });
            },
        },
    ],
    exports: [REDIS_CLIENT],
})
export class RedisModule { }