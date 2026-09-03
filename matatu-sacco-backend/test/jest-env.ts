// Process-wide env for unit tests. Specs that care about a specific value
// set/restore it themselves; this is just the baseline so code paths that
// fail fast on a missing secret (M-Pesa callback URLs) can be exercised.
process.env.MPESA_CALLBACK_SECRET ??= 'unit-test-callback-secret';
process.env.MPESA_CALLBACK_BASE_URL ??= 'https://callbacks.test';
