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

@Injectable()
export class ReceiptPdfService {
    async generate(params: {
        booking: Booking;
        route: RouteInfo;
        travelDate: string;
        signature: string;
        verifyBaseUrl: string; // e.g. https://yourapp.com/verify
    }): Promise<Buffer> {
        const { booking, route, travelDate, signature, verifyBaseUrl } = params;

        const verifyUrl = `${verifyBaseUrl}/${booking.id}?sig=${signature}`;
        const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });
        const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");

        const doc = new PDFDocument({ size: [320, 560], margin: 24 });
        const stream = new PassThrough();
        doc.pipe(stream);

        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(chunk));

        const pageWidth = 320 - 48; // minus margins

        // ── Header ──
        doc.font("Helvetica-Bold").fontSize(14)
            .text(route.saccoName.toUpperCase(), { align: "center" });
        doc.font("Helvetica").fontSize(9).fillColor("#666")
            .text("Booking Receipt", { align: "center" });
        doc.fillColor("#000");
        doc.moveDown(0.8);
        this.divider(doc, pageWidth);

        // ── Trip details ──
        this.row(doc, pageWidth, "Booking Ref", `#${booking.id.slice(0, 8).toUpperCase()}`);
        this.row(doc, pageWidth, "Route", `${route.origin} -> ${route.destination}`);
        this.row(doc, pageWidth, "Travel Date", travelDate);
        if (booking.seatNumber) {
            this.row(doc, pageWidth, "Seat No.", String(booking.seatNumber));
        }
        this.row(doc, pageWidth, "Status", booking.status);
        this.divider(doc, pageWidth);

        // ── Passenger ──
        doc.font("Helvetica-Bold").fontSize(10).text("Passenger");
        doc.moveDown(0.3);
        this.row(doc, pageWidth, "Name", booking.passengerName);
        this.row(doc, pageWidth, "Phone", booking.passengerPhone);
        this.divider(doc, pageWidth);

        // ── Payment ──
        doc.font("Helvetica-Bold").fontSize(10).text("Payment");
        doc.moveDown(0.3);
        this.row(doc, pageWidth, "Method", booking.paymentMethod);
        this.row(doc, pageWidth, "Payment Status", booking.paymentStatus);
        if (booking.mpesaReceiptNumber) {
            this.row(doc, pageWidth, "M-Pesa Ref", booking.mpesaReceiptNumber);
        }
        this.divider(doc, pageWidth);

        // ── Total ──
        doc.font("Helvetica-Bold").fontSize(12);
        const y = doc.y;
        doc.text("TOTAL PAID", 24, y);
        doc.text(`KES ${booking.fare}`, 24, y, { width: pageWidth, align: "right" });
        doc.moveDown(1.2);

        // ── QR + verification ──
        this.divider(doc, pageWidth);
        const qrX = (320 - 100) / 2;
        doc.image(qrBuffer, qrX, doc.y, { width: 100, height: 100 });
        doc.moveDown(7.5);
        doc.font("Helvetica").fontSize(8).fillColor("#666")
            .text(`Verify: ${signature}`, { align: "center" });
        doc.text("Scan QR or enter code at " + verifyBaseUrl, { align: "center" });
        doc.fillColor("#000");

        doc.moveDown(1);
        doc.font("Helvetica").fontSize(7).fillColor("#999")
            .text(`Issued ${new Date().toLocaleString("en-KE")}`, { align: "center" });

        doc.end();

        return new Promise((resolve, reject) => {
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
        });
    }

    private row(doc: PDFKit.PDFDocument, width: number, label: string, value: string) {
        const y = doc.y;
        doc.font("Helvetica").fontSize(9).fillColor("#666").text(label, 24, y);
        doc.font("Helvetica-Bold").fillColor("#000")
            .text(value, 24, y, { width, align: "right" });
        doc.moveDown(0.9);
    }

    private divider(doc: PDFKit.PDFDocument, width: number) {
        doc.moveDown(0.3);
        doc.strokeColor("#ccc").dash(2, { space: 2 })
            .moveTo(24, doc.y).lineTo(24 + width, doc.y).stroke();
        doc.undash().strokeColor("#000");
        doc.moveDown(0.8);
    }
}