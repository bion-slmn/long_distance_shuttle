// src/components/BookTicket.schema.spec.ts
//
// Requires `bookingFormSchema` to be exported from wherever it now lives
// (looks like you've since moved it to src/lib/bookingUtils.ts — good call,
// keeps the schema testable independent of the component file).

import { describe, it, expect } from "vitest";
import { PaymentMethod } from "../../api/bookingApi";
import { bookingFormSchema } from "./BookTicket";

function baseValues(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        passengerName: "Jane Wanjiru",
        passengerPhone: "0712345678",
        paymentMethod: PaymentMethod.MPESA,
        passengerEmail: "",
        preferredBoardingFrom: "",
        preferredBoardingTo: "",
        ...overrides,
    };
}

describe("bookingFormSchema", () => {
    // ── passengerName ────────────────────────────────────────────────
    describe("passengerName", () => {
        it("accepts a normal name", () => {
            expect(bookingFormSchema.safeParse(baseValues()).success).toBe(true);
        });

        it("rejects an empty string", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerName: "" }),
            );
            expect(result.success).toBe(false);
        });

        it("rejects a whitespace-only name", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerName: "   " }),
            );
            expect(result.success).toBe(false);
        });

        it("trims before validating (leading/trailing whitespace around a real name passes)", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerName: "  Jane  " }),
            );
            expect(result.success).toBe(true);
        });
    });

    // ── passengerPhone ────────────────────────────────────────────────
    describe("passengerPhone", () => {
        it.each([
            "0712345678", // 07...
            "0112345678", // 01...
            "+254712345678",
            "+254112345678",
        ])("accepts valid Kenyan number: %s", (phone: string) => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerPhone: phone }),
            );
            expect(result.success).toBe(true);
        });

        it.each([
            "071234567", // too short
            "07123456789", // too long
            "0812345678", // wrong prefix (not 7 or 1)
            "254712345678", // missing +
            "+25471234567", // too short with country code
            "abcdefghij",
            "",
        ])("rejects invalid number: %s", (phone: string) => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerPhone: phone }),
            );
            expect(result.success).toBe(false);
        });
    });

    // ── passengerEmail (optional) ────────────────────────────────────
    describe("passengerEmail", () => {
        it("accepts an empty string (optional field)", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerEmail: "" }),
            );
            expect(result.success).toBe(true);
        });

        it("accepts a valid email", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerEmail: "jane@example.com" }),
            );
            expect(result.success).toBe(true);
        });

        it("rejects a malformed email", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ passengerEmail: "not-an-email" }),
            );
            expect(result.success).toBe(false);
        });
    });

    // ── preferredBoardingFrom / preferredBoardingTo (optional, HH:mm) ──
    describe("preferredBoardingFrom / preferredBoardingTo format", () => {
        it("accepts empty strings for both (optional)", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: "", preferredBoardingTo: "" }),
            );
            expect(result.success).toBe(true);
        });

        // `preferredBoardingTo` is intentionally left empty here — the
        // .refine() ordering check (from < to) is tested separately below.
        // Pairing every `time` with a fixed `to` value would collide when
        // `time` itself equals that fixed value (e.g. both "23:59"),
        // failing the ordering rule instead of what this test is actually
        // checking: the HH:mm format regex in isolation.
        it.each(["00:00", "08:00", "23:59", "12:30"])(
            "accepts valid HH:mm: %s",
            (time: string) => {
                const result = bookingFormSchema.safeParse(
                    baseValues({ preferredBoardingFrom: time, preferredBoardingTo: "" }),
                );
                expect(result.success).toBe(true);
            },
        );

        it.each([
            "24:00", // hour out of range
            "9:00", // missing leading zero
            "08:60", // minute out of range
            "8am",
            "08-00",
        ])("rejects invalid time format: %s", (time: string) => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: time, preferredBoardingTo: "" }),
            );
            expect(result.success).toBe(false);
        });
    });

    // ── cross-field refine: from < to ────────────────────────────────
    describe("preferredBoardingFrom/To ordering (.refine)", () => {
        it("passes when from is strictly earlier than to", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: "08:00", preferredBoardingTo: "12:00" }),
            );
            expect(result.success).toBe(true);
        });

        it("fails when from equals to", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: "08:00", preferredBoardingTo: "08:00" }),
            );
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].path).toEqual(["preferredBoardingTo"]);
            }
        });

        it("fails when from is later than to", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: "17:00", preferredBoardingTo: "08:00" }),
            );
            expect(result.success).toBe(false);
        });

        it("skips the ordering check when only `from` is set", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: "08:00", preferredBoardingTo: "" }),
            );
            expect(result.success).toBe(true);
        });

        it("skips the ordering check when only `to` is set", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: "", preferredBoardingTo: "17:00" }),
            );
            expect(result.success).toBe(true);
        });

        it("skips the ordering check when both are empty", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ preferredBoardingFrom: "", preferredBoardingTo: "" }),
            );
            expect(result.success).toBe(true);
        });
    });

    // ── paymentMethod ─────────────────────────────────────────────────
    describe("paymentMethod", () => {
        it("accepts MPESA", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ paymentMethod: PaymentMethod.MPESA }),
            );
            expect(result.success).toBe(true);
        });

        it("accepts CASH", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ paymentMethod: PaymentMethod.CASH }),
            );
            expect(result.success).toBe(true);
        });

        it("rejects an unrecognized payment method", () => {
            const result = bookingFormSchema.safeParse(
                baseValues({ paymentMethod: "BITCOIN" }),
            );
            expect(result.success).toBe(false);
        });
    });
});