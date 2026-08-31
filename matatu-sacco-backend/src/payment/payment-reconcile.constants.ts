// src/payment/payment-reconcile.constants.ts
// First check waits until 2:30 — well past normal callback latency AND
// realistic PIN-entry time, so we're not querying Daraja while the
// passenger might still be legitimately typing. Second check at 3:00
// doubles as the last chance before forcing, so there's no separate
// "force" delay tacked on afterward — the schedule and the 3-minute
// ceiling are the same deadline.
export const RECONCILE_DELAYS_MS = [
    150_000, // first check at 2:30
    30_000,  // second check at 3:00 — if still unresolved here, force-expire
];
// How long after the STK push we refuse to conclude "failed" from a status
// QUERY alone — but only for codes that describe a SYSTEM condition, which a
// query fired too early can report before the checkout has really settled.
//
// It deliberately does NOT gate the codes that describe something the
// passenger already did (see ALWAYS_TERMINAL_RESULT_CODES). Those can't
// un-happen, so waiting on them only holds a seat nobody can use.
export const RECONCILE_GRACE_MS = 150_000;

// Daraja ResultCodes that report an event that has ALREADY happened on the
// passenger's handset. There is no later state in which "cancelled by user"
// becomes "paid" — the checkout is over the moment Safaricom says this, so we
// act on it immediately, however young the push is.
//
// This used to sit behind RECONCILE_GRACE_MS on the assumption that a real
// failure always arrives on the callback within seconds, making an early query
// verdict unnecessary. Production disagreed: a cancellation was reported by the
// query at push+14s and again at push+41s while no callback ever arrived, and
// the seat stayed blocked for the full 3-minute ladder with the passenger
// standing at the counter. Callbacks are lost for failures just as readily as
// for successes.
export const ALWAYS_TERMINAL_RESULT_CODES = new Set([
    1,    // insufficient balance — the passenger's account, not our timing
    1032, // request cancelled by user
    2001, // wrong PIN
]);

// Codes that describe the system rather than the passenger. These stay behind
// the grace period: a query fired while the prompt is still live can surface a
// timing/plumbing condition that later resolves into a real payment, and
// concluding failure there cancels a booking someone is still paying for.
//
// Everything not listed in either set is treated as still in flight — the
// reconcile schedule force-expires at the 3-minute ceiling, so an unknown code
// can never leave a payment stuck, but it can never wrongly cancel one either.
export const TERMINAL_FAILURE_RESULT_CODES = new Set([
    17,   // M-Pesa internal failure for this request
    1019, // transaction expired
    1025, // push request error
]);

// How long a seat stays blocked for an in-flight M-Pesa payment.
//
// Deliberately derived from the reconcile ladder rather than hand-picked:
// the seat must stay held for exactly as long as the payment can still
// legitimately resolve. Releasing sooner would let a second passenger book a
// seat the first one is about to pay for; releasing later would leave a dead
// seat after the payment can no longer succeed. One deadline, one place to
// change it.
export const SEAT_HOLD_MS = RECONCILE_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
