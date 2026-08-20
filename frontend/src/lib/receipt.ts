// src/lib/receipt.ts
import jsPDF from "jspdf";
import type { Booking } from "../api/bookingApi";
import type { RouteSearchResult } from "../api/routeApi";

interface ReceiptOptions {
    booking: Booking;
    route: RouteSearchResult;
    travelDate: string;
    transactionId?: string; // e.g. M-Pesa receipt number, if you have it
}

function formatIssuedAt(): string {
    return new Date().toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

export function generateReceiptPDF({
    booking,
    route,
    travelDate,
    transactionId,
}: ReceiptOptions): jsPDF {
    const doc = new jsPDF({ unit: "pt", format: [320, 500] }); // receipt-strip size
    const marginX = 24;
    let y = 32;

    const line = (text: string, opts?: { bold?: boolean; size?: number; center?: boolean }) => {
        doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
        doc.setFontSize(opts?.size ?? 10);
        if (opts?.center) {
            doc.text(text, 160, y, { align: "center" });
        } else {
            doc.text(text, marginX, y);
        }
        y += (opts?.size ?? 10) + 6;
    };

    const divider = () => {
        y += 2;
        doc.setLineDashPattern([2, 2], 0);
        doc.line(marginX, y, 320 - marginX, y);
        y += 14;
    };

    const row = (label: string, value: string) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(label, marginX, y);
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold");
        doc.text(value, 320 - marginX, y, { align: "right" });
        y += 16;
    };

    // ── Header ──
    line(route.saccoName.toUpperCase(), { bold: true, size: 14, center: true });
    line("Booking Receipt", { size: 9, center: true });
    y += 4;
    divider();

    // ── Trip details ──
    row("Booking Ref", `#${booking.id.slice(0, 8).toUpperCase()}`);
    row("Route", `${route.origin} -> ${route.destination}`);
    row("Travel Date", travelDate);
    if (booking.seatNumber) row("Seat No.", String(booking.seatNumber));
    row("Status", booking.status);
    divider();

    // ── Passenger details ──
    line("Passenger", { bold: true, size: 10 });
    row("Name", booking.passengerName);
    row("Phone", booking.passengerPhone);
    divider();

    // ── Payment details ──
    line("Payment", { bold: true, size: 10 });
    row("Method", booking.paymentMethod);
    row("Payment Status", booking.paymentStatus);
    if (transactionId) row("Transaction ID", transactionId);
    row("Fare", `KES ${booking.fare}`);
    divider();

    // ── Footer ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("TOTAL PAID", marginX, y);
    doc.text(`KES ${booking.fare}`, 320 - marginX, y, { align: "right" });
    y += 24;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Issued ${formatIssuedAt()}`, 160, y, { align: "center" });
    y += 12;
    doc.text("Thank you for travelling with us", 160, y, { align: "center" });

    return doc;
}

export function downloadReceipt(opts: ReceiptOptions) {
    const doc = generateReceiptPDF(opts);
    doc.save(`receipt-${opts.booking.id.slice(0, 8)}.pdf`);
}