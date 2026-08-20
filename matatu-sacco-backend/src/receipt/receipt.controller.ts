import {
    Controller,
    Get,
    Param,
    Query,
    Res,
    NotFoundException,
    BadRequestException,
} from "@nestjs/common";
import type { Response } from "express"; // ← type-only import, compiled away
import { BookingService } from "../booking/booking.service";
import { RouteService } from "../route/route.service";
import { ReceiptSigningService } from "./receipt-signing.service";
import { ReceiptPdfService } from "./receipt-pdf.service";
import { Public } from "src/decorators/public.decorator";

@Controller()
export class ReceiptController {
    constructor(
        private readonly bookingService: BookingService,
        private readonly routeService: RouteService,
        private readonly signingService: ReceiptSigningService,
        private readonly pdfService: ReceiptPdfService,
    ) { }

    @Public()
    @Get("bookings/:id/receipt.pdf")
    async downloadReceipt(@Param("id") id: string, @Res() res: Response) {
        const booking = await this.bookingService.findOne(id);
        if (!booking) throw new NotFoundException("Booking not found");

        if (booking.paymentStatus !== "PAID") {
            throw new BadRequestException("Receipt is only available once payment is confirmed");
        }

        const route = await this.routeService.findOneWithSacco(booking.routeId);
        if (!route) throw new NotFoundException("Route not found");
        if (!route.sacco) throw new NotFoundException("Sacco not found for this route");

        const signature = this.signingService.sign(booking);

        const pdfBuffer = await this.pdfService.generate({
            booking,
            route: {
                origin: route.origin,
                destination: route.destination,
                saccoName: route.sacco.name, // ← from the related Sacco entity
            },
            travelDate: booking.travelDate,
            signature,
            verifyBaseUrl: `${process.env.PUBLIC_APP_URL}/verify`,
        });

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="receipt-${booking.id.replace(/-/g, "").slice(0, 8)}.pdf"`,
            "Content-Length": pdfBuffer.length,
        });
        res.send(pdfBuffer);
    }

    @Public()
    @Get("verify/:bookingId")
    async verifyReceipt(
        @Param("bookingId") bookingId: string,
        @Query("sig") sig: string,
    ) {
        const booking = await this.bookingService.findOne(bookingId);
        if (!booking) {
            return { valid: false, reason: "Booking not found" };
        }

        const valid = this.signingService.verify(booking, sig);

        return {
            valid,
            ...(valid && {
                booking: {
                    id: booking.id,
                    passengerName: booking.passengerName,
                    fare: booking.fare,
                    paymentStatus: booking.paymentStatus,
                    paymentMethod: booking.paymentMethod,
                    status: booking.status,
                    mpesaReceiptNumber: booking.mpesaReceiptNumber,
                    paidAt: booking.createdAt,
                },
            }),
        };
    }
}