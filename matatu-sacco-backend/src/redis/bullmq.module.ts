// src/redis/bullmq.module.ts

import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
    imports: [
        BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],

            useFactory: (config: ConfigService) => {
                const redisUrl = config.get<string>('REDIS_URL');

                const defaultJobOptions = {
                    removeOnComplete: true,
                    removeOnFail: true,
                };

                if (redisUrl) {
                    // Hand the URL straight to ioredis rather than splitting it
                    // into host/port/password. Splitting drops the scheme, so a
                    // rediss:// URL (Upstash, which is TLS-only) was being
                    // dialled in plaintext and reset on every reconnect.
                    return {
                        connection: {
                            url: redisUrl,
                            maxRetriesPerRequest: null,
                        },
                        defaultJobOptions,
                    };
                }

                return {
                    connection: {
                        host: config.get<string>('REDIS_HOST', 'localhost'),
                        port: config.get<number>('REDIS_PORT', 6379),
                        password:
                            config.get<string>('REDIS_PASSWORD') || undefined,
                        maxRetriesPerRequest: null,
                    },
                    defaultJobOptions,
                };
            },
        }),
    ],

    exports: [BullModule],
})
export class BullmqModule { }
