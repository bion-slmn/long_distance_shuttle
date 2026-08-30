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
// QUERY alone. Deliberately the same 2:30 as the first scheduled check: while
// the prompt is still sitting on the passenger's phone, Daraja's query API
// reports a non-zero ResultCode that means "not finished", not "failed" —
// concluding otherwise cancels a booking the passenger is still paying for.
//
// Nothing is lost by waiting: a REAL failure (user pressed cancel, wrong PIN,
// insufficient funds) arrives on the callback within seconds, and that path
// is authoritative. This only constrains what we infer from polling.
export const RECONCILE_GRACE_MS = 150_000;

// Daraja ResultCodes that genuinely mean "this checkout is over".
// Everything else non-zero is treated as still in flight — the reconcile
// schedule force-expires at the 3-minute ceiling, so an unknown code can
// never leave a payment stuck, but it can never wrongly cancel one either.
export const TERMINAL_FAILURE_RESULT_CODES = new Set([
    1,    // insufficient balance
    17,   // M-Pesa internal failure for this request
    1019, // transaction expired
    1025, // push request error
    1032, // request cancelled by user
    2001, // wrong PIN
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
