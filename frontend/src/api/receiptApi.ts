// src/api/receiptApi.ts
import api from "./axios";

// ─── Types ───────────────────────────────────────────────────────────────

export interface VerifyReceiptResult {
    valid: boolean;
    reason?: string;
    booking?: {
        id: string;
        passengerName: string;
        fare: number;
        paymentStatus: string;
        paymentMethod: string;
        status: string;
        mpesaReceiptNumber: string | null;
        paidAt: string;
    };
}

// ─── Receipt Requests ──────────────────────────────────────────────────────

/**
 * Fetches the signed receipt PDF as a raw Blob.
 * Only available once a booking's paymentStatus is PAID — the backend
 * returns 400 otherwise. Public endpoint (no staff auth), booking id
 * doubles as the access token since ids are unguessable UUIDs.
 */
export async function getReceiptPdfRequest(bookingId: string): Promise<Blob> {
    const res = await api.get(`/bookings/${bookingId}/receipt.pdf`, {
        responseType: "blob",
        skipAuthRefresh: true,
    });
    return res.data;
}

/**
 * Triggers a browser download of the receipt PDF.
 * Wraps getReceiptPdfRequest + the blob-to-anchor-click dance so callers
 * don't need to touch DOM APIs directly.
 */
export async function downloadReceiptPdf(bookingId: string): Promise<void> {
    const blob = await getReceiptPdfRequest(bookingId);
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `receipt-${bookingId.slice(0, 8)}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(url);
}

/**
 * Verifies a receipt's signature against the live booking record.
 * Matches GET /verify/:bookingId?sig=... — used by the /verify page
 * that a scanned QR code (or manually entered code) lands on.
 */
export async function verifyReceiptRequest(
    bookingId: string,
    sig: string,
): Promise<VerifyReceiptResult> {
    const params = new URLSearchParams({ sig });
    const res = await api.get(
        `/verify/${bookingId}?${params.toString()}`,
        { skipAuthRefresh: true },
    );
    return res.data;
}