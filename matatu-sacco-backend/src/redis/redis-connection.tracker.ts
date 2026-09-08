// src/redis/redis-connection.tracker.ts
import { Injectable } from '@nestjs/common';

export interface RedisConnectionSnapshot {
    /** Number of reconnect attempts since the process booted. */
    reconnects: number;
    /** Message of the most recent socket/protocol error, or null if none yet. */
    lastError: string | null;
    /** ISO timestamp of the most recent error, or null if none yet. */
    lastErrorAt: string | null;
}

/**
 * In-memory record of what the ioredis client has been through since boot.
 *
 * A single PING only tells you whether Redis is reachable *right now*. A
 * managed provider like Upstash drops idle sockets and resets plaintext
 * connections to its TLS port, and both show up as ECONNRESET followed by a
 * successful reconnect. Without this record the dashboard would say "up"
 * while the logs fill with resets, so the health endpoint exposes it.
 */
@Injectable()
export class RedisConnectionTracker {
    private reconnects = 0;
    private lastError: string | null = null;
    private lastErrorAt: string | null = null;

    recordError(error: Error): void {
        this.lastError = error.message;
        this.lastErrorAt = new Date().toISOString();
    }

    recordReconnect(): void {
        this.reconnects += 1;
    }

    snapshot(): RedisConnectionSnapshot {
        return {
            reconnects: this.reconnects,
            lastError: this.lastError,
            lastErrorAt: this.lastErrorAt,
        };
    }
}
