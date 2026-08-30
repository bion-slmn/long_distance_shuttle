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

                if (redisUrl) {
                    const url = new URL(redisUrl);

                    return {
                        connection: {
                            host: url.hostname,
                            port: Number(url.port) || 6379,
                            username: url.username || undefined,
                            password: url.password || undefined,
                            maxRetriesPerRequest: null,
                        },

                        defaultJobOptions: {
                            removeOnComplete: true,
                            removeOnFail: true,
                        },
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

                    defaultJobOptions: {
                        removeOnComplete: true,
                        removeOnFail: true,
                    },
                };
            },
        }),
    ],

    exports: [BullModule],
})
export class BullmqModule { }