import { NotFoundException } from '@nestjs/common';
import { MpesaC2bCallbackGuard, MpesaCallbackTokenGuard } from './callback-token.guard';
import {
    c2bTokenFor,
    callbackSecret,
    isValidC2bToken,
    isValidCallbackToken,
    newCallbackNonce,
    redactCallbackUrl,
} from './callback-token';

const ctx = (params: Record<string, string | undefined>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ params }) }) }) as any;

const SECRET = 'correct-horse-battery-staple';
const OLD_SECRET = 'previous-secret-value-0001';

describe('M-Pesa callback tokens', () => {
    const ORIGINAL = process.env.MPESA_CALLBACK_SECRET;
    const ORIGINAL_PREV = process.env.MPESA_CALLBACK_SECRET_PREVIOUS;

    beforeEach(() => {
        process.env.MPESA_CALLBACK_SECRET = SECRET;
        delete process.env.MPESA_CALLBACK_SECRET_PREVIOUS;
    });
    afterAll(() => {
        process.env.MPESA_CALLBACK_SECRET = ORIGINAL;
        if (ORIGINAL_PREV) process.env.MPESA_CALLBACK_SECRET_PREVIOUS = ORIGINAL_PREV;
    });

    describe('STK guard (platform token)', () => {
        const guard = new MpesaCallbackTokenGuard();

        it('lets a request through when the path token matches the secret', () => {
            expect(guard.canActivate(ctx({ token: SECRET, nonce: 'n' }))).toBe(true);
        });

        it('SECURITY: rejects a wrong or missing token with a 404', () => {
            expect(() => guard.canActivate(ctx({ token: 'wrong' }))).toThrow(NotFoundException);
            expect(() => guard.canActivate(ctx({}))).toThrow(NotFoundException);
        });

        it('SECURITY: rejects a prefix of the secret (length is checked before compare)', () => {
            expect(isValidCallbackToken('correct-horse')).toBe(false);
        });

        it('SECURITY: denies everything when the secret is not configured — never fails open', () => {
            delete process.env.MPESA_CALLBACK_SECRET;
            expect(isValidCallbackToken('anything')).toBe(false);
            expect(() => callbackSecret()).toThrow(/MPESA_CALLBACK_SECRET/);
        });

        it('rejects a secret that is too short to be unguessable', () => {
            process.env.MPESA_CALLBACK_SECRET = 'short';
            expect(() => callbackSecret()).toThrow(/at least 16/);
        });
    });

    describe('C2B guard (per-sacco HMAC token)', () => {
        const guard = new MpesaC2bCallbackGuard();

        it("accepts a sacco's own token", () => {
            expect(guard.canActivate(ctx({ saccoId: 'sacco-a', token: c2bTokenFor('sacco-a') }))).toBe(true);
        });

        it("SECURITY: one sacco's token does not open another sacco's URL", () => {
            expect(() =>
                guard.canActivate(ctx({ saccoId: 'sacco-b', token: c2bTokenFor('sacco-a') })),
            ).toThrow(NotFoundException);
        });

        it('SECURITY: the platform secret itself is not a valid C2B token', () => {
            expect(isValidC2bToken('sacco-a', SECRET)).toBe(false);
        });

        it('SECURITY: rejects a missing saccoId or token', () => {
            expect(isValidC2bToken(undefined, c2bTokenFor('sacco-a'))).toBe(false);
            expect(isValidC2bToken('sacco-a', undefined)).toBe(false);
        });
    });

    describe('rotation', () => {
        it('accepts tokens built from the previous secret while it is configured', () => {
            process.env.MPESA_CALLBACK_SECRET_PREVIOUS = OLD_SECRET;
            expect(isValidCallbackToken(OLD_SECRET)).toBe(true);
            expect(isValidC2bToken('sacco-a', c2bTokenFor('sacco-a', OLD_SECRET))).toBe(true);
        });

        it('stops accepting the previous secret once it is removed', () => {
            expect(isValidCallbackToken(OLD_SECRET)).toBe(false);
            expect(isValidC2bToken('sacco-a', c2bTokenFor('sacco-a', OLD_SECRET))).toBe(false);
        });

        it('builds new URLs from the current secret only', () => {
            process.env.MPESA_CALLBACK_SECRET_PREVIOUS = OLD_SECRET;
            expect(c2bTokenFor('sacco-a')).toBe(c2bTokenFor('sacco-a', SECRET));
        });
    });

    describe('helpers', () => {
        it('generates unpredictable, distinct nonces', () => {
            const a = newCallbackNonce();
            const b = newCallbackNonce();
            expect(a).toMatch(/^[0-9a-f]{32}$/);
            expect(a).not.toBe(b);
        });

        it('redacts the secret-bearing tail of a callback URL for logs', () => {
            expect(redactCallbackUrl('https://h/payment/c2b/confirmation/sacco-a/abc123')).toBe(
                'https://h/payment/c2b/confirmation/***',
            );
            expect(redactCallbackUrl('https://h/payment/mpesa/callback/secret/nonce')).toBe(
                'https://h/payment/mpesa/callback/***',
            );
        });
    });
});
