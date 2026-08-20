// src/receipts/receipt-signing.service.ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHmac } from "crypto";
import { Booking } from "../booking/entities/booking.entity";

@Injectable()
export class ReceiptSigningService implements OnModuleInit {
    private secret!: string;

    onModuleInit() {
        const secret = process.env.RECEIPT_SIGNING_SECRET;
        if (!secret) {
            throw new Error(
                "RECEIPT_SIGNING_SECRET is not set. Refusing to start — receipts must not be signable without it.",
            );
        }
        this.secret = secret;
    }

    /**
     * Builds the canonical string that gets signed.
     * Only include fields that are immutable once PAID — never include
     * mutable fields like seatNumber if it can change after payment,
     * unless you want the receipt invalidated when it changes.
     */
    private canonicalPayload(booking: Booking): string {
        return [
            booking.id,
            booking.fare,
            booking.paymentStatus,
            booking.paymentMethod,
            booking.mpesaReceiptNumber ?? "",
            booking.createdAt ? new Date(booking.createdAt).toISOString() : "",
        ].join("|");
    }

    sign(booking: Booking): string {
        return createHmac("sha256", this.secret)
            .update(this.canonicalPayload(booking))
            .digest("hex")
            .slice(0, 16)
            .toUpperCase();
    }

    verify(booking: Booking, signature: string): boolean {
        if (!signature) return false;
        const expected = this.sign(booking);
        // Constant-time-ish comparison; length-checked first to avoid timingSafeEqual throwing
        if (expected.length !== signature.length) return false;
        return this.timingSafeEqual(expected, signature.toUpperCase());
    }

    private timingSafeEqual(a: string, b: string): boolean {
        let mismatch = 0;
        for (let i = 0; i < a.length; i++) {
            mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return mismatch === 0;
    }
}