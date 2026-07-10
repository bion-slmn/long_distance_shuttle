// src/api/tripApi.ts
import api from "./axios";
import type { Vehicle } from "./fleetApi";

// ─── Types ──────────────────────────────────────────────────────────────────

export const TripStatus = {
    BOARDING: "BOARDING",
    EN_ROUTE: "EN_ROUTE",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
} as const;

export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export interface Trip {
    id: string;
    routeId: string;
    vehicleId: string;
    saccoId: string;
    fare: number;
    driverId: string | null;
    queueEntryId: string | null;
    status: TripStatus;
    passengerCount: number;
    departureTime: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PaginatedTrips {
    data: Trip[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Mirrors create-trip.dto.ts exactly — keep in sync if the DTO changes.
export interface CreateTripDto {
    saccoId: string;
    routeId: string;
    vehicleId: string;
    driverId?: string;
    queueEntryId?: string;
    departureTime?: string; // ISO date string — @IsDateString on the backend
    completedAt?: string;   // ISO date string — @IsDateString on the backend
    fare: number;           // 0–999999.99
    passengerCount?: number; // int, 0–9999
    status?: TripStatus;
}

export interface UpdateTripDto {
    passengerCount?: number;
    driverId?: string;
    status?: TripStatus;
}

export interface FindTripsParams {
    routeId?: string;
    vehicleId?: string;
    status?: TripStatus;
    page?: number;
    limit?: number;
    date?: string;
    plateNumber?: string; // add this
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function getTrips(params?: FindTripsParams): Promise<PaginatedTrips> {
    const { data } = await api.get<PaginatedTrips>("/trips", { params });
    return data;
}

export async function getTrip(id: string): Promise<Trip> {
    const { data } = await api.get<Trip>(`/trips/${id}`);
    return data;
}

export async function createTrip(dto: CreateTripDto): Promise<Trip> {
    const { data } = await api.post<Trip>("/trips", dto);
    return data;
}

export async function updateTrip(id: string, dto: UpdateTripDto): Promise<Trip> {
    const { data } = await api.patch<Trip>(`/trips/${id}`, dto);
    return data;
}

export async function updatePassengerCount(id: string, passengerCount: number): Promise<Trip> {
    const { data } = await api.patch<Trip>(`/trips/${id}/passenger-count`, { passengerCount });
    return data;
}

export async function markTripDeparted(id: string): Promise<Trip> {
    const { data } = await api.patch<Trip>(`/trips/${id}/depart`, {});
    return data;
}

export async function cancelTrip(id: string): Promise<Trip> {
    const { data } = await api.patch<Trip>(`/trips/${id}/cancel`, {});
    return data;
}

export async function deleteTrip(id: string): Promise<{ deleted: boolean }> {
    const { data } = await api.delete<{ deleted: boolean }>(`/trips/${id}`);
    return data;
}