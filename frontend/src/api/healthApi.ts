// src/api/healthApi.ts
import api from "./axios";

export type DependencyStatus = 'up' | 'down';

export interface QueueJobCounts {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
}

export interface SystemHealth {
    api: {
        status: DependencyStatus;
    };
    database: {
        status: DependencyStatus;
        responseTime: number; // ms
    };
    redis: {
        status: DependencyStatus;
        responseTime: number; // ms
        /** ioredis socket state: 'ready', 'reconnecting', 'connecting', 'end', ... */
        connectionState: string;
        reconnects: number; // since the API process booted
        lastError: string | null;
        lastErrorAt: string | null; // ISO timestamp
    };
    queue: {
        status: DependencyStatus;
        responseTime: number; // ms
        jobs: QueueJobCounts | null; // null when the queue's Redis connection is down
    };
    failedRequests: number | null; // null when the counter store is unreachable
    queueJobs: number | null; // waiting + active + delayed
    lastBackup: string | null; // null = not tracked yet
}

export async function getSystemHealthRequest(): Promise<SystemHealth> {
    const { data } = await api.get<SystemHealth>("/health/system");
    return data;
}
