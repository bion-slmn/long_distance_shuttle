// src/receipts/receipt-pdf.service.ts
import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import * as QRCode from "qrcode";
import { PassThrough } from "stream";
import { Booking } from "../booking/entities/booking.entity";

interface RouteInfo {
    origin: string;
    destination: string;
    saccoName: string;
}

// ── Brand tokens (kept in sync with the frontend's CSS vars) ──
const BRAND_DEEP = "#064E3B";   // header background
const PRIMARY = "#15803D";      // accents, total row
const GOLD = "#EAB308";         // small highlight (status pill, divider)
const TEXT_MUTED = "#6b6375";
const TEXT_ON_DARK = "#ffffff";

@Injectable()
export class ReceiptPdfService {
    async generate(params: {
        booking: Booking;
        route: RouteInfo;
        travelDate: string;
        signature: string;
        verifyBaseUrl: string;
    }): Promise<Buffer> {
        const { booking, route, travelDate, signature, verifyBaseUrl } = params;

        const verifyUrl = `${verifyBaseUrl}/${booking.id}?sig=${signature}`;
        const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });
        const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

        const PAGE_WIDTH = 320;
        const MARGIN = 24;
        const doc = new PDFDocument({ size: [PAGE_WIDTH, 620], margin: 0 });
        const stream = new PassThrough();
        doc.pipe(stream);

        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(chunk));

        const contentWidth = PAGE_WIDTH - MARGIN * 2;

        // ── Header band ──
        this.drawHeader(doc, PAGE_WIDTH, route.saccoName);

        // Move cursor below header, apply left/right margin for body content
        doc.x = MARGIN;
        doc.y = 96;

        this.divider(doc, contentWidth);

        // ── Trip details ──
        this.row(doc, contentWidth, "Booking Ref", `#${booking.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`);
        this.row(doc, contentWidth, "Route", `${route.origin} -> ${route.destination}`);
        this.row(doc, contentWidth, "Travel Date", travelDate);
        if (booking.seatNumber) {
            this.row(doc, contentWidth, "Seat No.", String(booking.seatNumber));
        }
        this.row(doc, contentWidth, "Status", booking.status);
        this.divider(doc, contentWidth);

        // ── Passenger ──
        doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY).text("PASSENGER");
        doc.fillColor("#000");
        doc.moveDown(0.3);
        this.row(doc, contentWidth, "Name", booking.passengerName);
        this.row(doc, contentWidth, "Phone", booking.passengerPhone);
        this.divider(doc, contentWidth);

        // ── Payment ──
        doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY).text("PAYMENT");
        doc.fillColor("#000");
        doc.moveDown(0.3);
        this.row(doc, contentWidth, "Method", booking.paymentMethod);
        this.row(doc, contentWidth, "Payment Status", booking.paymentStatus);
        if (booking.mpesaReceiptNumber) {
            this.row(doc, contentWidth, "M-Pesa Ref", booking.mpesaReceiptNumber);
        }
        this.divider(doc, contentWidth);

        // ── Total (highlighted band) ──
        const totalBandY = doc.y;
        doc.rect(0, totalBandY, PAGE_WIDTH, 36).fill(PRIMARY);
        doc.fillColor(TEXT_ON_DARK).font("Helvetica-Bold").fontSize(12);
        doc.text("TOTAL PAID", MARGIN, totalBandY + 11);
        doc.text(`KES ${booking.fare}`, MARGIN, totalBandY + 11, { width: contentWidth, align: "right" });
        doc.fillColor("#000");
        doc.y = totalBandY + 36 + 16;
        doc.x = MARGIN;

        // ── QR + verification ──
        this.divider(doc, contentWidth);
        const qrX = (PAGE_WIDTH - 100) / 2;
        doc.image(qrBuffer, qrX, doc.y, { width: 100, height: 100 });
        doc.moveDown(7.5);
        doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED)
            .text(`Verify: ${signature}`, MARGIN, doc.y, { width: contentWidth, align: "center" });
        doc.text("Scan QR or enter code at " + verifyBaseUrl, MARGIN, doc.y, { width: contentWidth, align: "center" });
        doc.fillColor("#000");

        doc.moveDown(1);

        // ── Footer band ──
        this.drawFooter(doc, PAGE_WIDTH, doc.y + 8);

        doc.end();

        return new Promise((resolve, reject) => {
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
        });
    }

    // ── Header: dark band with logo mark + sacco name ──
    private drawHeader(doc: PDFKit.PDFDocument, pageWidth: number, saccoName: string) {
        const headerHeight = 88;
        doc.rect(0, 0, pageWidth, headerHeight).fill(BRAND_DEEP);

        // Logo mark: rounded square badge (mirrors the navbar's Bus-icon badge)
        const badgeSize = 32;
        const badgeX = (pageWidth - this.logoWidth(saccoName)) / 2;
        const badgeY = 18;

        doc.roundedRect(badgeX, badgeY, badgeSize, badgeSize, 8).fill(PRIMARY);
        // simple bus glyph: body rect + two wheel dots, drawn in white
        doc.fillColor(TEXT_ON_DARK);
        doc.roundedRect(badgeX + 6, badgeY + 8, badgeSize - 12, badgeSize - 16, 2).fill(TEXT_ON_DARK);
        doc.fillColor(PRIMARY);
        doc.circle(badgeX + 10, badgeY + badgeSize - 5, 2.2).fill(PRIMARY);
        doc.circle(badgeX + badgeSize - 10, badgeY + badgeSize - 5, 2.2).fill(PRIMARY);

        // Wordmark next to badge: "Shuttle" white + "Hub" gold, mirrors text-primary accent on site
        const wordmarkX = badgeX + badgeSize + 8;
        doc.font("Helvetica-Bold").fontSize(16).fillColor(TEXT_ON_DARK)
            .text("Shuttle", wordmarkX, badgeY + 7, { continued: true });
        doc.fillColor(GOLD).text("Hub");

        // Sacco name + subtitle
        doc.fillColor(TEXT_ON_DARK).font("Helvetica").fontSize(9)
            .text(saccoName.toUpperCase(), 0, badgeY + badgeSize + 6, { width: pageWidth, align: "center" });
        doc.font("Helvetica").fontSize(7.5).fillColor("#d1fae5")
            .text("Booking Receipt", 0, badgeY + badgeSize + 18, { width: pageWidth, align: "center" });

        doc.fillColor("#000");
    }

    // rough width estimate of badge+wordmark block, used to center the header row
    private logoWidth(_saccoName: string): number {
        return 32 + 8 + 90; // badge + gap + approx wordmark width
    }

    // ── Footer: contact strip + copyright ──
    private drawFooter(doc: PDFKit.PDFDocument, pageWidth: number, y: number) {
        const footerHeight = 56;
        const footerY = Math.max(y, doc.page.height - footerHeight);

        doc.rect(0, footerY, pageWidth, footerHeight).fill("#f4f3ec");
        doc.rect(0, footerY, pageWidth, 3).fill(PRIMARY); // top accent line

        doc.font("Helvetica").fontSize(7.5).fillColor(TEXT_MUTED)
            .text("+254 700 123 456  •  support@shuttlehub.com", 0, footerY + 12, {
                width: pageWidth,
                align: "center",
            });
        doc.text("Nairobi, Kenya", 0, footerY + 24, { width: pageWidth, align: "center" });
        doc.font("Helvetica").fontSize(7).fillColor("#9ca3af")
            .text(`© ${new Date().getFullYear()} ShuttleHub • Issued ${new Date().toLocaleString("en-KE")}`, 0, footerY + 38, {
                width: pageWidth,
                align: "center",
            });

        doc.fillColor("#000");
    }

    private row(doc: PDFKit.PDFDocument, width: number, label: string, value: string) {
        const y = doc.y;
        doc.font("Helvetica").fontSize(9).fillColor(TEXT_MUTED).text(label, 24, y);
        doc.font("Helvetica-Bold").fillColor("#000")
            .text(value, 24, y, { width, align: "right" });
        doc.moveDown(0.9);
    }

    private divider(doc: PDFKit.PDFDocument, width: number) {
        doc.moveDown(0.3);
        doc.strokeColor("#e5e4e7").dash(2, { space: 2 })
            .moveTo(24, doc.y).lineTo(24 + width, doc.y).stroke();
        doc.undash().strokeColor("#000");
        doc.moveDown(0.8);
    }
}