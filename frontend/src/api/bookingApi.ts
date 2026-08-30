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
    preferredBoardingFrom: string | null;
    preferredBoardingTo: string | null;
    /**
     * While an M-Pesa payment is in flight the seat is claimed but not sold.
     * Once this passes, the payment can no longer legitimately land — a row
     * still PENDING past it is a dead booking, not one to keep waiting on.
     * Null on CASH/pre-matched C2B (sold outright) and on legacy rows.
     */
    holdExpiresAt: string | null;
    createdByUserId: string | null;
    createdAt: string;
    updatedAt: string;
    route?: {
        id: string;
        origin: string;
        destination: string;
        fare: number;
        description: string;
    };
    trip?: {
        id: string;
        vehicleId: string;
        vehicleCapacity: number;
        status: string;
    } | null;
}

// A seat is unbookable for one of two different reasons, and collapsing them
// into a single "taken" is what made an in-flight payment look like a sale.
export const SeatState = {
    TAKEN: "TAKEN", // paid for — occupied permanently
    HELD: "HELD",   // payment in flight — occupied until holdExpiresAt passes
} as const;

export type SeatState = (typeof SeatState)[keyof typeof SeatState];

export interface SeatMapSeat {
    seatNumber: number;
    state: SeatState;
    /** Only set for HELD seats — when the hold lapses and the seat frees up. */
    holdExpiresAt: string | null;
}

export interface BookingSeatMap {
    hasOpenTrip: boolean;
    seatsTotal: number | null;
    /**
     * Every unbookable seat, sold and held alike. Kept for callers that only
     * need "can I click this" — prefer `seats` when the distinction matters.
     */
    takenSeatNumbers: number[];
    seats: SeatMapSeat[];
}

// Seat-count-only availability for a route/date — no seat map.
export interface BookingAvailabilityPreBooking {
    enabled: boolean;
    morningStart: string;
    morningEnd: string;
    maxMorningVehicles: number;
    maxSeatsPerTrip: number;
    maxPreBookableSeats: number;
    preBookedSeats: number;
    seatsRemaining: number;
    capReached: boolean;
    minTravelDate: string;
    maxTravelDate: string;
}

export interface BookingAvailability {
    routeId: string;
    travelDate: string;
    hasOpenTrip: boolean;
    seatsTotal: number | null;
    /** SOLD only — paid. Excludes in-flight holds. */
    seatsBooked: number;
    /** Claimed by a payment still in flight — not a sale, but not bookable either. */
    seatsHeld: number;
    /** Neither sold nor held — what can actually be handed out right now. */
    seatsAvailable: number | null;
    awaitingTripCount: number; // pre-bookings queued for the next vehicle
    preBooking: BookingAvailabilityPreBooking;
}

export const BookingSource = {
    CLERK: 'CLERK',           // recorded in-person by a sacco clerk
    PUBLIC_PORTAL: 'PUBLIC_PORTAL', // self-service by passenger
} as const;

export type BookingSource = typeof BookingSource[keyof typeof BookingSource];

export interface CreateBookingPayload {
    bookingId?: string;
    routeId: string;
    travelDate?: string;
    passengerName: string;
    passengerPhone: string;
    paymentMethod: PaymentMethod;
    source: BookingSource;
    createdByUserId?: string;
    status?: BookingStatus;
    preferredBoardingFrom?: string;
    preferredBoardingTo?: string;
    passengerEmail?: string;
    mpesaTransactionId?: string;
    seatNumber?: number; // clerk-only — the backend ignores this on public-portal bookings
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
    from?: string;
    to?: string;
    status?: BookingStatus;
    tripId?: string;
    vehicleId?: string;
}

// ─── Booking Requests ──────────────────────────────────────────────────────

export async function createBookingRequest(
    payload: CreateBookingPayload,
): Promise<Booking> {
    const res = await api.post("/bookings", payload, { skipAuthRefresh: true });
    return res.data;
}

export async function getBookingAvailabilityRequest(
    routeId: string,
    travelDate?: string,
): Promise<BookingAvailability> {
    const params = new URLSearchParams({ routeId });
    if (travelDate) params.set("travelDate", travelDate);

    const res = await api.get(`/bookings/availability?${params.toString()}`, {
        skipAuthRefresh: true,
    });
    return res.data;
}

export async function getBookingsRequest(
    options: GetBookingsOptions = {},
): Promise<Booking[]> {
    const params = new URLSearchParams();
    if (options.saccoId) params.set("saccoId", options.saccoId);
    if (options.routeId) params.set("routeId", options.routeId);
    if (options.travelDate) params.set("travelDate", options.travelDate);
    if (options.from) params.set("from", options.from);
    if (options.to) params.set("to", options.to);
    if (options.status) params.set("status", options.status);
    if (options.tripId) params.set("tripId", options.tripId);
    if (options.vehicleId) params.set("vehicleId", options.vehicleId);

    const query = params.toString();
    const res = await api.get(`/bookings${query ? `?${query}` : ""}`);
    return res.data;
}

export async function getBookingRequest(id: string): Promise<Booking> {
    const res = await api.get(`/bookings/${id}`);
    return res.data;
}

export async function createBookingByClerkRequest(
    payload: CreateBookingPayload,
): Promise<Booking> {
    const res = await api.post("/bookings/clerk", payload);
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

export interface TodayEarnings {
    date: string;
    grossRevenue: number;
    commission: number;
    /**
     * The rate the commission was computed at, as a fraction (0.1 = 10%),
     * read from the sacco's own settings. Use it to label the figure and to
     * derive a per-trip cut — never hardcode a rate alongside this. Null
     * platform-wide, where each sacco contributes at its own rate.
     */
    commissionRate: number | null;
}

export async function getTodayEarningsRequest(
    saccoId?: string,
): Promise<TodayEarnings> {
    const params = new URLSearchParams();
    if (saccoId) params.set("saccoId", saccoId);
    const query = params.toString();

    const res = await api.get(`/bookings/earnings/today${query ? `?${query}` : ""}`);
    return res.data;
}

export async function getRevenueTrendRequest(
    days = 7,
    saccoId?: string,
): Promise<{ date: string; revenue: number; commission: number }[]> {
    const params = new URLSearchParams();
    params.set("days", String(days));
    if (saccoId) params.set("saccoId", saccoId);
    const query = params.toString();

    const res = await api.get(`/bookings/earnings/trend${query ? `?${query}` : ""}`);
    return res.data;
}

export interface UniquePassengerStats {
    saccoId: string | null;
    thisWeekUnique: number;
    lastWeekUnique: number;
    newThisWeek: number;
    returningThisWeek: number;
    changePercent: number | null;
}

export async function getUniquePassengerStatsRequest(): Promise<UniquePassengerStats> {
    const { data } = await api.get<UniquePassengerStats>("/bookings/stats/unique-passengers");
    return data;
}

// ─── Booking status (public, minimal) ─────────────────────────────────────
// Matches GET /bookings/:id/status — the public polling endpoint, distinct
// from getBookingRequest which is staff-only and returns the full Booking
// (including passengerPhone). Only what the confirmation screen needs.

export interface BookingStatusSummary {
    id: string;
    status: BookingStatus;
    paymentStatus: PaymentStatus;
    seatNumber: number | null;
    mpesaReceiptNumber: string | null;
}

export async function getBookingStatusRequest(id: string): Promise<BookingStatusSummary> {
    const res = await api.get(`/bookings/${id}/status`, { skipAuthRefresh: true });
    return res.data;
}

// ─── Ticket lookup (public, email + OTP) ──────────────────────────────────
// Matches POST /bookings/tickets/request-code, POST /bookings/tickets/verify-code,
// and GET /bookings/tickets/my-tickets — the passenger-facing "view my tickets"
// flow. No staff auth involved; verify-code issues a short-lived scoped JWT
// (30 min) that my-tickets requires via TicketsAuthGuard.

export async function requestTicketCodeRequest(
    email: string,
): Promise<{ message: string }> {
    const res = await api.post(
        "/bookings/tickets/request-code",
        { email },
        { skipAuthRefresh: true },
    );
    return res.data;
}

export async function verifyTicketCodeRequest(
    email: string,
    code: string,
): Promise<{ access_token: string }> {
    const res = await api.post(
        "/bookings/tickets/verify-code",
        { email, code },
        { skipAuthRefresh: true },
    );
    return res.data;
}

export async function getMyTicketsRequest(token: string): Promise<Booking[]> {
    const res = await api.get("/bookings/tickets/my-tickets", {
        headers: { Authorization: `Bearer ${token}` },
        skipAuthRefresh: true,
    });
    return res.data;
}

export async function getBookingSeatMapRequest(
    routeId: string,
    travelDate?: string,
): Promise<BookingSeatMap> {
    const params = new URLSearchParams({ routeId });
    if (travelDate) params.set("travelDate", travelDate);

    const res = await api.get(`/bookings/seat-map?${params.toString()}`);
    return res.data;
}