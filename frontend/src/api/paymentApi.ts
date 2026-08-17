// src/api/paymentApi.ts
import api from "./axios";

// ─── Types ───────────────────────────────────────────────────────────────
// Mirrors src/payment/entities/payment.entity.ts on the backend

export const PaymentMethod = {
    MPESA: "MPESA",
    CASH: "CASH",
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
    PENDING: "PENDING",
    PROCESSING: "PROCESSING",
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
    EXPIRED: "EXPIRED",
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentReferenceType = {
    BOOKING: "BOOKING",
} as const;

export type PaymentReferenceType =
    (typeof PaymentReferenceType)[keyof typeof PaymentReferenceType];

export interface Payment {
    id: string;
    referenceType: PaymentReferenceType;
    referenceId: string;
    saccoId: string;
    amount: number;
    currency: string;
    method: PaymentMethod;
    status: PaymentStatus;
    payerPhone: string | null;
    checkoutRequestId: string | null;
    merchantRequestId: string | null;
    mpesaReceiptNumber: string | null;
    resultCode: string | null;
    resultDesc: string | null;
    initiatedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface InitiateMpesaPaymentPayload {
    referenceType: PaymentReferenceType;
    referenceId: string;
    saccoId: string;
    amount: number;
    payerPhone: string;
    accountReference: string;
}

export interface InitiateMpesaPaymentResponse {
    paymentId: string;
    checkoutRequestId: string;
}

export interface RecordCashPaymentPayload {
    referenceType: PaymentReferenceType;
    referenceId: string;
    saccoId: string;
    amount: number;
}

// src/api/paymentApi.ts — add/confirm these exist

export interface GetSaccoPaymentsOptions {
    saccoId?: string; // omitted by SACCO_ADMIN/CLERK — backend derives it from the JWT
    from?: string;
    to?: string;
    status?: PaymentStatus;
    method?: PaymentMethod;
}

export async function getSaccoPaymentsRequest(
    options: GetSaccoPaymentsOptions = {},
): Promise<Payment[]> {
    const params = new URLSearchParams();
    if (options.saccoId) params.set("saccoId", options.saccoId);
    if (options.from) params.set("from", options.from);
    if (options.to) params.set("to", options.to);
    if (options.status) params.set("status", options.status);
    if (options.method) params.set("method", options.method);

    const query = params.toString();
    const res = await api.get(`/payment/sacco${query ? `?${query}` : ""}`);
    return res.data;
}

// ─── Payment Requests ──────────────────────────────────────────────────────

export async function initiateMpesaPaymentRequest(
    payload: InitiateMpesaPaymentPayload,
): Promise<InitiateMpesaPaymentResponse> {
    const res = await api.post("/payment/mpesa/initiate", payload, {
        skipAuthRefresh: true,
    });
    return res.data;
}

export async function recordCashPaymentRequest(
    payload: RecordCashPaymentPayload,
): Promise<Payment> {
    const res = await api.post("/payment/cash", payload);
    return res.data;
}

export async function getPaymentRequest(id: string): Promise<Payment> {
    const res = await api.get(`/payment/${id}`);
    return res.data;
}

export async function getPaymentForBookingRequest(
    bookingId: string,
): Promise<Payment> {
    const res = await api.get(`/payment/booking/${bookingId}`);
    return res.data;
}





export interface PaymentStatusForBooking {
    status: PaymentStatus;
    method: string;
    errorMessage: string | null;
    mpesaReceiptNumber: string | null;
}

export async function getPaymentStatusForBookingRequest(
    bookingId: string,
): Promise<PaymentStatusForBooking> {
    const res = await api.get(`/payment/booking/${bookingId}/status`, {
        skipAuthRefresh: true,
    });
    return res.data;
}

// src/api/paymentApi.ts

export interface PaymentStatusForBooking {
    paymentId: string; // ← add
    status: PaymentStatus;
    method: string;
    errorMessage: string | null;
    mpesaReceiptNumber: string | null;
}

export async function reconcilePaymentRequest(
    bookingId: string,
): Promise<PaymentStatusForBooking> {
    const res = await api.post(`/payment/booking/${bookingId}/reconcile`, {}, {
        skipAuthRefresh: true,
    });
    return res.data;
}