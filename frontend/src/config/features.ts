// src/config/features.ts
//
// Product-stage switches. Flip here, nowhere else.

// Stage 2. Passenger self-service — the "Book a seat" home page, /book and
// /ticket, and their navbar and footer links — stays hidden until sacco
// management (stage 1) has settled. Clerk-side booking and the receipt
// verification page are unaffected: those are stage 1.
export const ONLINE_BOOKING_ENABLED = false
