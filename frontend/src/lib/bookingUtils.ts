// utils/bookingUtils.ts
import { PaymentMethod, type Booking } from "@/api/bookingApi";
import { z } from "zod";

export function todayString(): string {
    return new Date().toISOString().slice(0, 10);
}

export function passengerMessage(booking: Booking): string {
    if (booking.status === "CANCELLED") return "This booking was cancelled.";
    if (booking.paymentStatus !== "PAID") {
        return booking.paymentMethod === "MPESA"
            ? "Complete the M-Pesa prompt on your phone to confirm your seat."
            : "Pay the conductor in cash to confirm your seat.";
    }
    if (booking.status === "CONFIRMED" && booking.seatNumber) {
        return `Seat ${booking.seatNumber} confirmed. We'll text you when boarding starts.`;
    }
    return "Payment received. You're on the list — we'll seat you when the shuttle boards.";
}

export type Step = "search" | "details" | "confirmed";

export const bookingFormSchema = z
    .object({
        passengerName: z
            .string()
            .trim()
            .min(1, "Passenger name is required."),
        passengerPhone: z
            .string()
            .regex(
                /^(?:\+254|0)(7|1)\d{8}$/,
                "Enter a valid Kenyan phone number (e.g. 0712345678)."
            ),
        paymentMethod: z.nativeEnum(PaymentMethod),
        preferredBoardingFrom: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time.")
            .optional()
            .or(z.literal("")),
        preferredBoardingTo: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time.")
            .optional()
            .or(z.literal("")),
    })
    .refine(
        (data) =>
            !data.preferredBoardingFrom ||
            !data.preferredBoardingTo ||
            data.preferredBoardingFrom < data.preferredBoardingTo,
        {
            message: '"From" must be earlier than "To".',
            path: ["preferredBoardingTo"],
        }
    );

export type BookingFormValues = z.infer<typeof bookingFormSchema>;

export const MPESA_TIMEOUT = 90_000;
export const AVAILABILITY_REFETCH_INTERVAL = 15_000;
export const MPESA_POLL_INTERVAL = 3_000;