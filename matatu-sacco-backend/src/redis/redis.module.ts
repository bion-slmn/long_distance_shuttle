// src/redis/redis.module.ts
import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { RedisConnectionTracker } from './redis-connection.tracker';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Attach listeners so a dropped socket is logged once and recorded for the
 * health endpoint instead of being dumped to stderr as an unhandled event.
 * ioredis reconnects on its own; without an 'error' listener it still
 * reconnects, but every drop prints a raw stack trace.
 */
export function attachRedisListeners(
    client: Redis,
    tracker: RedisConnectionTracker,
    logger: Logger,
): Redis {
    client.on('error', (error: Error) => {
        tracker.recordError(error);
        logger.warn(`Redis error: ${error.message}`);
    });
    client.on('reconnecting', () => {
        tracker.recordReconnect();
        logger.warn('Redis reconnecting');
    });
    client.on('ready', () => logger.log('Redis ready'));
    return client;
}

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        RedisConnectionTracker,
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService, RedisConnectionTracker],
            useFactory: (config: ConfigService, tracker: RedisConnectionTracker) => {
                const logger = new Logger('Redis');
                const redisUrl = config.get<string>('REDIS_URL');
                const options: RedisOptions = {
                    maxRetriesPerRequest: null, // required if BullMQ shares this connection
                };

                if (redisUrl) {
                    // Upstash / any managed Redis with a full connection URL.
                    // A rediss:// scheme turns TLS on automatically; Upstash
                    // only accepts TLS, so the URL on Render must use rediss://.
                    return attachRedisListeners(new Redis(redisUrl, options), tracker, logger);
                }

                // Local/dev fallback
                return attachRedisListeners(
                    new Redis({
                        ...options,
                        host: config.get<string>('REDIS_HOST', 'localhost'),
                        port: config.get<number>('REDIS_PORT', 6379),
                        password: config.get<string>('REDIS_PASSWORD') || undefined,
                    }),
                    tracker,
                    logger,
                );
            },
        },
    ],
    exports: [REDIS_CLIENT, RedisConnectionTracker],
})
export class RedisModule { }
