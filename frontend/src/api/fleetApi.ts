// src/api/fleetApi.ts
import api from "./axios";
import type { QueueStatus } from "./routeApi";

// ─── Types ───────────────────────────────────────────────────────────────

export const VehicleStatus = {
    ACTIVE: "ACTIVE",
    MAINTENANCE: "MAINTENANCE",
    RETIRED: "RETIRED",
} as const;

export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export interface Vehicle {
    id: string;
    numberPlate: string;
    seatingCapacity: number;
    saccoId: string;
    status: VehicleStatus;
    notes?: string;
    createdAt: string;
    updatedAt: string;
    // Queue status fields (optional, only when withQueueStatus=true)
    queueStatus?: QueueStatus | null;
    queueRouteId?: string | null;
    queueOrigin?: string | null;
    queueDestination?: string | null;
    queueClockedInAt?: string | null;
}

export interface PaginatedFleet {
    data: Vehicle[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface CreateFleetPayload {
    numberPlate: string;
    seatingCapacity: number;
    saccoId: string;
    notes?: string;
}

export interface UpdateFleetPayload {
    numberPlate?: string;
    seatingCapacity?: number;
    status?: VehicleStatus;
    notes?: string;
}

export interface GetFleetOptions {
    status?: VehicleStatus;
    page?: number;
    limit?: number;
    search?: string;
    withQueueStatus?: boolean;
}

// ─── Requests ────────────────────────────────────────────────────────────

export async function createFleetRequest(
    payload: CreateFleetPayload,
): Promise<Vehicle> {
    const res = await api.post("/fleet", payload);
    return res.data;
}

export async function getFleetRequest(
    options: GetFleetOptions = {},
): Promise<PaginatedFleet> {
    const {
        status,
        page = 1,
        limit = 20,
        search,
        withQueueStatus = false,
    } = options;

    const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
    });

    if (status) params.set("status", status);
    if (search?.trim()) params.set("search", search.trim());
    if (withQueueStatus) params.set("withQueueStatus", "true");

    const res = await api.get(`/fleet?${params.toString()}`);
    return res.data;
}

export async function getFleetVehicleRequest(id: string): Promise<Vehicle> {
    const res = await api.get(`/fleet/${id}`);
    return res.data;
}

export async function updateFleetVehicleRequest(
    id: string,
    payload: UpdateFleetPayload,
): Promise<Vehicle> {
    const res = await api.patch(`/fleet/${id}`, payload);
    return res.data;
}

export async function setFleetVehicleStatusRequest(
    id: string,
    status: VehicleStatus,
): Promise<Vehicle> {
    const res = await api.patch(`/fleet/${id}/status?value=${status}`);
    return res.data;
}