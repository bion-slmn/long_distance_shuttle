import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Safaricom does not sign its callbacks, so the URLs we hand Daraja carry
// secrets that only we and Daraja know. Three layers, so that no single leak
// unlocks everything:
//
//  1. A platform secret (MPESA_CALLBACK_SECRET) in every callback URL.
//  2. STK: a random per-payment nonce, stored on the payment row and baked
//     into that push's CallBackURL. A leaked nonce forges one callback for
//     one payment; the platform secret alone forges none.
//  3. C2B: a per-sacco token derived as HMAC(platform secret, saccoId). A
//     leak exposes one sacco's paybill URL, and rotating it means
//     re-registering that sacco's C2B URLs, not everyone's.
//
// Rotation: set MPESA_CALLBACK_SECRET to the new value and move the old one
// to MPESA_CALLBACK_SECRET_PREVIOUS. New URLs are built from the current
// secret; callbacks are accepted against either until the previous one is
// removed (after every sacco's C2B URLs have been re-registered).
const CURRENT_KEY = 'MPESA_CALLBACK_SECRET';
const PREVIOUS_KEY = 'MPESA_CALLBACK_SECRET_PREVIOUS';
const MIN_LENGTH = 16;

export function callbackSecret(): string {
    const secret = process.env[CURRENT_KEY];
    if (!secret || secret.length < MIN_LENGTH) {
        throw new Error(
            `${CURRENT_KEY} is not configured (need at least ${MIN_LENGTH} chars). ` +
            'M-Pesa callback URLs cannot be built without it.',
        );
    }
    return secret;
}

// Current secret first, then the previous one during a rotation window.
function acceptedSecrets(): string[] {
    let current: string;
    try {
        current = callbackSecret();
    } catch {
        return []; // unconfigured => nothing is accepted, never fail open
    }
    const previous = process.env[PREVIOUS_KEY];
    return previous && previous.length >= MIN_LENGTH ? [current, previous] : [current];
}

// Constant-time compare so a wrong token leaks nothing about the right one.
export function safeEqual(a: unknown, b: unknown): boolean {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0) return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isValidCallbackToken(token: unknown): boolean {
    return acceptedSecrets().some((secret) => safeEqual(token, secret));
}

// ── STK per-payment nonce ─────────────────────────────────────────────────
export function newCallbackNonce(): string {
    return randomBytes(16).toString('hex');
}

// ── C2B per-sacco token ───────────────────────────────────────────────────
export function c2bTokenFor(saccoId: string, secret: string = callbackSecret()): string {
    return createHmac('sha256', secret).update(`c2b:${saccoId}`).digest('hex');
}

export function isValidC2bToken(saccoId: unknown, token: unknown): boolean {
    if (typeof saccoId !== 'string' || saccoId.length === 0) return false;
    return acceptedSecrets().some((secret) => safeEqual(token, c2bTokenFor(saccoId, secret)));
}

// For logs: keep the route, hide the secret-bearing tail.
export function redactCallbackUrl(url: string): string {
    return url.replace(/\/(callback|confirmation|validation)\/.*$/, '/$1/***');
}
