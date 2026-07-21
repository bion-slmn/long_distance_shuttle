// src/api/bookingApi.ts
import api from "./axios";

// ─── Types ───────────────────────────────────────────────────────────────

export const BookingStatus = {
    AWAITING_TRIP: "AWAITING_TRIP", // booked ahead against a route/date, no vehicle/seat yet
    CONFIRMED: "CONFIRMED",         // assigned to a real trip + seat
    BOARDED: "BOARDED",             // passenger physically got on
    CANCELLED: "CANCELLED",         // refunded or voided before travel
    NO_SHOW: "NO_SHOW",             // trip departed, passenger never boarded
} as const;

export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const PaymentMethod = {
    CASH: "CASH",
    MPESA: "MPESA",
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
    PENDING: "PENDING",
    PAID: "PAID",
    FAILED: "FAILED",
    REFUNDED: "REFUNDED",
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface Booking {
    id: string;
    routeId: string;
    travelDate: string; // "2026-07-13"
    tripId: string | null;
    seatNumber: number | null;
    saccoId: string;
    passengerName: string;
    passengerPhone: string;
    fare: number;
    status: BookingStatus;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    mpesaCheckoutRequestId: string | null;
    mpesaReceiptNumber: string | null;
    createdByUserId: string | null;
    createdAt: string;
    updatedAt: string;
    route?: {
        id: string;
        origin: string;
        destination: string;
        fare: number;
    };
    trip?: {
        id: string;
        vehicleId: string;
        vehicleCapacity: number;
        status: string;
    } | null;
}

// Seat-count-only availability for a route/date — no seat map.
export interface BookingAvailability {
    routeId: string;
    travelDate: string;
    hasOpenTrip: boolean;
    seatsTotal: number | null;
    seatsBooked: number;
    seatsAvailable: number | null;
    awaitingTripCount: number; // pre-bookings queued for the next vehicle
}

export interface CreateBookingPayload {
    routeId: string;
    travelDate?: string; // omit = today, on the backend
    passengerName: string;
    passengerPhone: string;
    paymentMethod: PaymentMethod;
    createdByUserId?: string;
}

export interface UpdateBookingPayload {
    status?: BookingStatus;
}

export interface ConfirmPaymentPayload {
    mpesaReceiptNumber?: string;
    mpesaCheckoutRequestId?: string;
}

export interface GetBookingsOptions {
    saccoId?: string;
    routeId?: string;
    travelDate?: string;
    status?: BookingStatus;
    tripId?: string;
}

// ─── Booking Requests ──────────────────────────────────────────────────────

export async function createBookingRequest(
    payload: CreateBookingPayload,
): Promise<Booking> {
    const res = await api.post("/bookings", payload);
    return res.data;
}

export async function getBookingsRequest(
    options: GetBookingsOptions = {},
): Promise<Booking[]> {
    const params = new URLSearchParams();
    if (options.saccoId) params.set("saccoId", options.saccoId);
    if (options.routeId) params.set("routeId", options.routeId);
    if (options.travelDate) params.set("travelDate", options.travelDate);
    if (options.status) params.set("status", options.status);
    if (options.tripId) params.set("tripId", options.tripId);

    const query = params.toString();
    const res = await api.get(`/bookings${query ? `?${query}` : ""}`);
    return res.data;
}

export async function getBookingAvailabilityRequest(
    routeId: string,
    travelDate?: string,
): Promise<BookingAvailability> {
    const params = new URLSearchParams({ routeId });
    if (travelDate) params.set("travelDate", travelDate);

    const res = await api.get(`/bookings/availability?${params.toString()}`);
    return res.data;
}

export async function getBookingRequest(id: string): Promise<Booking> {
    const res = await api.get(`/bookings/${id}`);
    return res.data;
}

export async function updateBookingRequest(
    id: string,
    payload: UpdateBookingPayload,
    saccoId?: string,
): Promise<Booking> {
    const params = new URLSearchParams();
    if (saccoId) params.set("saccoId", saccoId);
    const query = params.toString();

    const res = await api.patch(`/bookings/${id}${query ? `?${query}` : ""}`, payload);
    return res.data;
}

export async function confirmBookingPaymentRequest(
    id: string,
    payload: ConfirmPaymentPayload,
): Promise<Booking> {
    const res = await api.patch(`/bookings/${id}/confirm-payment`, payload);
    return res.data;
}

export async function markBookingPaymentFailedRequest(id: string): Promise<Booking> {
    const res = await api.patch(`/bookings/${id}/payment-failed`, {});
    return res.data;
}

export async function cancelBookingRequest(
    id: string,
    saccoId?: string,
): Promise<Booking> {
    const params = new URLSearchParams();
    if (saccoId) params.set("saccoId", saccoId);
    const query = params.toString();

    const res = await api.delete(`/bookings/${id}${query ? `?${query}` : ""}`);
    return res.data;
}