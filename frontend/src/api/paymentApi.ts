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
    initiationErrorCode: string | null
    initiationErrorMessage: string | null
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
    // Only on the reconcile response. "records" means we checked what we
    // already hold (always); "mpesa" means Daraja was actually asked, which
    // happens only for a payment the automatic checks gave up on. When Daraja
    // was eligible but asked too recently, mpesaCheckAvailableInSeconds says
    // how long until a press would reach it again.
    checkedWith?: "records" | "mpesa";
    mpesaCheckAvailableInSeconds?: number | null;
}

export async function reconcilePaymentRequest(
    bookingId: string,
): Promise<PaymentStatusForBooking> {
    const res = await api.post(`/payment/booking/${bookingId}/reconcile`, {}, {
        skipAuthRefresh: true,
    });
    return res.data;
}


// ─── M-Pesa Transactions (unmatched C2B lookup for clerks) ────────────────
// Mirrors src/payment/mpesa/entities/mpesa.entity.ts on the backend

export const MpesaTransactionSource = {
    STK_PUSH: "STK_PUSH",
    C2B: "C2B",
} as const;

export type MpesaTransactionSource =
    (typeof MpesaTransactionSource)[keyof typeof MpesaTransactionSource];

export const MpesaTransactionMatchStatus = {
    UNMATCHED: "UNMATCHED",
    MATCHED: "MATCHED",
    IGNORED: "IGNORED",
} as const;

export type MpesaTransactionMatchStatus =
    (typeof MpesaTransactionMatchStatus)[keyof typeof MpesaTransactionMatchStatus];

export interface MpesaTransaction {
    id: string;
    source: MpesaTransactionSource;
    mpesaReceiptNumber: string;
    checkoutRequestId: string | null;
    amount: number;
    payerPhone: string;
    payerName: string | null;
    billRefNumber: string | null;
    businessShortCode: string | null;
    transactionTime: string;
    matchStatus: MpesaTransactionMatchStatus;
    matchedBookingId: string | null;
    matchedPaymentId: string | null;
    matchedBy: string | null;
    matchedAt: string | null;
    receivedAt: string;
}

export interface GetMpesaTransactionsByPhoneOptions {
    phone: string;
    dateFrom?: string;
    dateTo?: string;
}

export async function getMpesaTransactionsByPhoneRequest(
    options: GetMpesaTransactionsByPhoneOptions,
): Promise<MpesaTransaction[]> {
    const params = new URLSearchParams();
    params.set("phone", options.phone);
    if (options.dateFrom) params.set("dateFrom", options.dateFrom);
    if (options.dateTo) params.set("dateTo", options.dateTo);

    const res = await api.get(`/payment/mpesa/transactions?${params.toString()}`);
    return res.data;
}

// ─── C2B (direct paybill) callback registration ──────────────────────────
// Runs automatically when M-Pesa credentials are saved; this is the manual
// retry for when Daraja was unreachable at the time. SUPER_ADMIN, SACCO_ADMIN.
export async function registerSaccoC2bUrlsRequest(
    saccoId: string,
): Promise<{ responseDescription: string }> {
    const { data } = await api.post<{ responseDescription: string }>(
        `/payment/mpesa/${saccoId}/c2b/register`,
    );
    return data;
}

// ─── Unmatched C2B money ─────────────────────────────────────────────────
// Passengers who pay the paybill directly land here with nothing to attach
// the payment to. Until a clerk matches one, it's money received against no
// seat. Scoped server-side: a SACCO_ADMIN sees their own sacco, a
// SUPER_ADMIN sees every sacco (including receipts no sacco could be
// attributed to).

export interface UnmatchedMpesaSummary {
    count: number;
    totalAmount: number;
    oldestTransactionTime: string | null;
}

export async function getUnmatchedMpesaSummaryRequest(): Promise<UnmatchedMpesaSummary> {
    const { data } = await api.get<UnmatchedMpesaSummary>(
        "/payment/mpesa/transactions/unmatched-summary",
    );
    return data;
}
