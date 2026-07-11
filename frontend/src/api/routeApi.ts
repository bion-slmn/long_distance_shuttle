// src/api/routeApi.ts
import api from "./axios";
import type { Vehicle } from "./fleetApi";

// ─── Types ───────────────────────────────────────────────────────────────

export const QueueEntryStatus = {
    WAITING: "WAITING",       // In the yard, waiting for its turn
    BOARDING: "BOARDING",     // Currently in the active passenger loading bay
    DISPATCHED: "DISPATCHED", // Full and gone! Left the stage
} as const;

export type QueueEntryStatus = (typeof QueueEntryStatus)[keyof typeof QueueEntryStatus];

export const RouteQueueStatus = {
    OPEN: "OPEN",     // Accepting vehicles / actively dispatching for the day
    CLOSED: "CLOSED", // Day's queue is done, no more dispatches
} as const;

export type RouteQueueStatus = (typeof RouteQueueStatus)[keyof typeof RouteQueueStatus];

export interface Route {
    id: string;
    origin: string;
    destination: string;
    description: string;
    stages: string[];
    saccoId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    fare: number
}

// The day's queue for a route — one per route per day.
export interface RouteQueue {
    id: string;
    routeId: string;
    queueDate: string; // "2026-07-09"
    status: RouteQueueStatus;
    createdAt: string;
    updatedAt: string;
    route: {
        id: string;
        saccoId: string;
        origin: string;
        destination: string;
        description: string;
        stages: string[];
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
    };
}

// A single vehicle's slot within a RouteQueue.
export interface QueueEntry {
    id: string;
    routeQueueId: string;
    vehicleId: string;
    status: QueueEntryStatus;
    position: number;
    clockedInAt: string;
    dispatchedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    vehicle: {
        id: string;
        saccoId: string;
        numberPlate: string;
        seatingCapacity: number;
        status: string;
        notes: string;
    };
    routeQueue: RouteQueue;
}

export interface CreateRoutePayload {
    origin: string;
    destination: string;
    description: string;
    stages?: string[];
    saccoId: string;
    fare: number
    createReturnLeg?: boolean;
}

export interface UpdateRoutePayload {
    origin?: string;
    destination?: string;
    description?: string;
    stages?: string[];
    isActive?: boolean;
    fare?: number
}

export interface CreateQueuePayload {
    routeId: string;
    vehicleId: string;
    clockedInAt?: Date;
}

export interface UpdateQueuePayload {
    status?: QueueEntryStatus;
    // Moving a vehicle to a different route's queue for the same day —
    // handled server-side by finding/creating the target day-queue.
    routeId?: string;
    dispatchedAt?: Date;
}

export interface GetQueueEntriesOptions {
    routeId?: string;
    status?: QueueEntryStatus;
    date?: string; // ISO date string, e.g. "2026-07-09" — defaults to today on the backend if omitted
}

// ─── Route Requests ────────────────────────────────────────────────────────

export async function createRouteRequest(
    payload: CreateRoutePayload,
): Promise<Route> {
    const res = await api.post("/routes", payload);
    return res.data;
}

export async function getRoutesRequest(): Promise<Route[]> {
    const res = await api.get("/routes");
    return res.data;
}

export async function getRouteRequest(id: string): Promise<Route> {
    const res = await api.get(`/routes/${id}`);
    return res.data;
}

export async function updateRouteRequest(
    id: string,
    payload: UpdateRoutePayload,
): Promise<Route> {
    const res = await api.patch(`/routes/${id}`, payload);
    return res.data;
}

export async function addRouteStageRequest(
    id: string,
    stage: string,
): Promise<Route> {
    const res = await api.post(`/routes/${id}/stages`, { stage });
    return res.data;
}

export async function removeRouteStageRequest(
    id: string,
    stage: string,
): Promise<Route> {
    const res = await api.delete(`/routes/${id}/stages/${encodeURIComponent(stage)}`);
    return res.data;
}

// ─── Route Queue Requests ────────────────────────────────────────────────────

export async function clockInVehicleRequest(
    payload: CreateQueuePayload,
): Promise<QueueEntry> {
    const res = await api.post("/routes/queue/clock-in", payload);
    return res.data;
}

export async function findAvailableVehiclesRequest(
    routeId: string,
    date?: string,
): Promise<QueueEntry[]> {
    const params = new URLSearchParams({ routeId });
    if (date) params.set("date", date);

    const res = await api.get(`/routes/queue/available?${params.toString()}`);
    return res.data;
}


export async function getQueueEntriesRequest(
    options: GetQueueEntriesOptions = {},
): Promise<QueueEntry[]> {
    const params = new URLSearchParams();
    if (options.routeId) params.set("routeId", options.routeId);
    if (options.status) params.set("status", options.status);
    if (options.date) params.set("date", options.date);

    const query = params.toString();
    const res = await api.get(`/routes/queue${query ? `?${query}` : ""}`);
    return res.data;
}

export async function getQueueEntryRequest(id: string): Promise<QueueEntry> {
    const res = await api.get(`/routes/queue/${id}`);
    return res.data;
}

export async function updateQueueEntryRequest(
    id: string,
    payload: UpdateQueuePayload,
): Promise<QueueEntry> {
    const res = await api.patch(`/routes/queue/${id}`, payload);
    return res.data;
}

export async function removeVehicleFromQueueRequest(id: string): Promise<void> {
    await api.delete(`/routes/queue/${id}`);
}