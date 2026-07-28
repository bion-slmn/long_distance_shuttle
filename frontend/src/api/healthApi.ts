// src/api/healthApi.ts
import api from "./axios";

export interface SystemHealth {
    api: {
        status: 'up' | 'down';
    };
    database: {
        status: 'up' | 'down';
        responseTime: number; // ms
    };
    failedRequests: number;
    queueJobs: number | null; // null = not tracked yet
    lastBackup: string | null; // null = not tracked yet
}

export async function getSystemHealthRequest(): Promise<SystemHealth> {
    const { data } = await api.get<SystemHealth>("/health/system");
    return data;
}