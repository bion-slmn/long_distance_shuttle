// src/payment/mpesa/mpesa-resilience.spec.ts
//
// Daraja is the least reliable dependency in the system, and every one of
// these paths runs while a passenger is standing at the stage. What matters
// is not that calls succeed, but that each failure is classified correctly:
// a transient network blip is worth one more try, a business rejection is
// not, and "we could not find out" must never be reported as "it failed".
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { MpesaService } from './mpesa.service';

describe('MpesaService — resilience', () => {
    let service: MpesaService;
    let httpService: { get: jest.Mock; post: jest.Mock };
    let saccoSettingsService: {
        getDecryptedMpesaCredentials: jest.Mock;
        findSaccoIdByShortcode: jest.Mock;
        recordC2bRegistration: jest.Mock;
    };
    let mpesaTransactionRepo: any;

    const SACCO_ID = 'sacco-1';
    const OTHER_SACCO_ID = 'sacco-2';
    const CREDS = {
        consumerKey: 'ck',
        consumerSecret: 'cs',
        shortcode: '123456',
        passkey: 'pk',
    };

    const tokenResponse = (token = 'token-1', expiresIn = 3600) =>
        of({ data: { access_token: token, expires_in: expiresIn } });

    const stkResponse = () =>
        of({
            data: {
                MerchantRequestID: 'm1',
                CheckoutRequestID: 'c1',
                ResponseDescription: 'Success',
            },
        });

    const stkDto = {
        payerPhone: '0700000000',
        amount: 500,
        accountReference: 'ABC12345',
    };

    // Axios-shaped errors: `code` for transport failures, `response.status`
    // for anything Daraja actually answered.
    const transportError = (code: string) => Object.assign(new Error(code), { code });
    const httpError = (status: number) =>
        Object.assign(new Error(`HTTP ${status}`), { response: { status } });

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers().setSystemTime(new Date('2024-01-15T12:15:30+03:00'));

        httpService = { get: jest.fn(), post: jest.fn() };
        saccoSettingsService = {
            getDecryptedMpesaCredentials: jest.fn(),
            findSaccoIdByShortcode: jest.fn().mockResolvedValue('sacco-1'),
            recordC2bRegistration: jest.fn().mockResolvedValue(undefined),
        };
        mpesaTransactionRepo = {
            create: jest.fn((d: any) => d),
            save: jest.fn(),
            update: jest.fn(),
            findOneByOrFail: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
        };

        saccoSettingsService.getDecryptedMpesaCredentials.mockResolvedValue(CREDS);

        service = new MpesaService(
            httpService as any,
            saccoSettingsService as any,
            mpesaTransactionRepo as any,
        );
    });

    afterEach(() => jest.useRealTimers());

    // ─── Retry classification ─────────────────────────────────────────────
    describe('retry classification', () => {
        it.each([
            ['a connection timeout', transportError('ECONNABORTED')],
            ['a reset connection', transportError('ECONNRESET')],
            ['a socket timeout', transportError('ETIMEDOUT')],
            ['a 502 from Daraja', httpError(502)],
            ['a 503 from Daraja', httpError(503)],
            ['a 504 from Daraja', httpError(504)],
        ])('retries once after %s and succeeds on the second attempt', async (_label, err) => {
            httpService.get
                .mockReturnValueOnce(throwError(() => err))
                .mockReturnValueOnce(tokenResponse());
            httpService.post.mockReturnValue(stkResponse());

            const pending = service.initiateStkPush(SACCO_ID, stkDto);
            await jest.advanceTimersByTimeAsync(1000); // the backoff before retry
            const result = await pending;

            expect(result.checkoutRequestId).toBe('c1');
            expect(httpService.get).toHaveBeenCalledTimes(2);
        });

        it.each([
            ['a 400 rejection', httpError(400)],
            ['a 401 bad credential', httpError(401)],
            ['a 500 business error', httpError(500)],
        ])('does NOT retry %s — repeating it just repeats the failure', async (_label, err) => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(throwError(() => err));

            await expect(service.initiateStkPush(SACCO_ID, stkDto)).rejects.toBeInstanceOf(
                BadRequestException,
            );

            expect(httpService.post).toHaveBeenCalledTimes(1);
        });

        it('gives up after the retry budget rather than looping forever', async () => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(throwError(() => transportError('ETIMEDOUT')));

            const pending = service.initiateStkPush(SACCO_ID, stkDto);
            const assertion = expect(pending).rejects.toBeInstanceOf(BadRequestException);
            await jest.advanceTimersByTimeAsync(5000);
            await assertion;

            // One original attempt plus one retry — a passenger cannot be left
            // waiting on an unbounded chain of Daraja calls.
            expect(httpService.post).toHaveBeenCalledTimes(2);
        });

        it('retries a transient failure on the STK push itself, not just the token call', async () => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post
                .mockReturnValueOnce(throwError(() => httpError(503)))
                .mockReturnValueOnce(stkResponse());

            const pending = service.initiateStkPush(SACCO_ID, stkDto);
            await jest.advanceTimersByTimeAsync(1000);
            const result = await pending;

            expect(result.checkoutRequestId).toBe('c1');
            expect(httpService.post).toHaveBeenCalledTimes(2);
        });

        it('wraps a failed STK push in a clean, passenger-safe message', async () => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(
                throwError(() =>
                    Object.assign(new Error('boom'), {
                        response: { status: 400, data: { errorMessage: 'Invalid Access Token' } },
                    }),
                ),
            );

            await expect(service.initiateStkPush(SACCO_ID, stkDto)).rejects.toThrow(
                /Failed to initiate M-Pesa payment/i,
            );
        });

        it('KNOWN GAP: a failed OAuth call escapes unwrapped, unlike a failed push', async () => {
            // getAccessToken() is awaited on line 213, above the try/catch that
            // starts on line 233, so only the push half gets the clean
            // BadRequestException. A token failure propagates the raw Axios
            // error instead, which PaymentService then stores verbatim as
            // initiationErrorMessage — i.e. "Request failed with status code
            // 400", exactly the unhelpful string the comment on
            // payment.service.ts:369 claims to have replaced with the real
            // Daraja message.
            //
            // Pinned as-is rather than silently "fixed": the assertion below
            // will start failing the moment the token call is moved inside the
            // try, which is the change worth making.
            httpService.get.mockReturnValue(
                throwError(() =>
                    Object.assign(new Error('Request failed with status code 400'), {
                        response: { status: 400, data: { errorMessage: 'Invalid Access Token' } },
                    }),
                ),
            );

            await expect(service.initiateStkPush(SACCO_ID, stkDto)).rejects.not.toBeInstanceOf(
                BadRequestException,
            );
            expect(httpService.post).not.toHaveBeenCalled();
        });
    });

    // ─── Token cache is per sacco ─────────────────────────────────────────
    describe('token isolation', () => {
        it('never presents one sacco\'s token on another sacco\'s call', async () => {
            httpService.get
                .mockReturnValueOnce(tokenResponse('token-sacco-1'))
                .mockReturnValueOnce(tokenResponse('token-sacco-2'));
            httpService.post.mockReturnValue(stkResponse());

            await service.initiateStkPush(SACCO_ID, stkDto);
            await service.initiateStkPush(OTHER_SACCO_ID, stkDto);

            // Each sacco holds its own Daraja credentials; crossing them would
            // push a prompt against the wrong shortcode.
            const [firstPost, secondPost] = httpService.post.mock.calls;
            expect(firstPost[2].headers.Authorization).toBe('Bearer token-sacco-1');
            expect(secondPost[2].headers.Authorization).toBe('Bearer token-sacco-2');
            expect(httpService.get).toHaveBeenCalledTimes(2);
        });

        it('invalidates only the failing sacco\'s token, leaving others cached', async () => {
            httpService.get
                .mockReturnValueOnce(tokenResponse('token-sacco-1'))
                .mockReturnValueOnce(tokenResponse('token-sacco-2'));
            httpService.post
                .mockReturnValueOnce(throwError(() => httpError(400))) // sacco-1 fails
                .mockReturnValue(stkResponse());

            await expect(service.initiateStkPush(SACCO_ID, stkDto)).rejects.toThrow();
            await service.initiateStkPush(OTHER_SACCO_ID, stkDto);
            await service.initiateStkPush(OTHER_SACCO_ID, stkDto);

            // sacco-2's second call must still hit the cache: one OAuth call
            // for sacco-1, one for sacco-2, and no more.
            expect(httpService.get).toHaveBeenCalledTimes(2);
        });
    });

    // ─── queryStkStatus: "we don't know" is not "it failed" ───────────────
    describe('queryStkStatus failure semantics', () => {
        it('raises 503, not 400, when Daraja cannot be reached', async () => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(throwError(() => transportError('ETIMEDOUT')));

            const pending = service.queryStkStatus(SACCO_ID, 'ws_CO_123');
            const assertion = expect(pending).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            await jest.advanceTimersByTimeAsync(5000);
            await assertion;

            // The reconcile path distinguishes these: a 503 means "try again
            // shortly", a 400 would mean "this will never succeed" and could
            // cancel a booking that is still being paid for.
        });
    });

    // ─── Phone normalisation at the edges ─────────────────────────────────
    describe('phone normalisation', () => {
        it.each([
            ['a leading zero', '0700000000'],
            ['a +254 prefix', '+254700000000'],
            ['spaces and a plus', '+254 700 000 000'],
            ['hyphens', '0700-000-000'],
            ['a bare 254 prefix', '254700000000'],
        ])('normalises %s to a 254 MSISDN', async (_label, phone) => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(stkResponse());

            await service.initiateStkPush(SACCO_ID, { ...stkDto, payerPhone: phone });

            const payload = httpService.post.mock.calls[0][1];
            expect(payload.PartyA).toBe('254700000000');
        });

        it.each([
            ['an empty string', ''],
            ['letters only', 'not-a-phone'],
            ['a foreign format', '+1 555 0100'],
        ])('rejects %s before any Daraja call is made', async (_label, phone) => {
            httpService.get.mockReturnValue(tokenResponse());

            await expect(
                service.initiateStkPush(SACCO_ID, { ...stkDto, payerPhone: phone }),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(httpService.post).not.toHaveBeenCalled();
        });
    });

    // ─── C2B URL registration ─────────────────────────────────────────────
    describe('registerC2BUrls', () => {
        it('returns the Daraja response description on success', async () => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(
                of({ data: { ResponseDescription: 'success' } }),
            );

            const result = await service.registerC2BUrls(SACCO_ID);

            expect(result.responseDescription).toBe('success');
        });

        it('registers both confirmation and validation URLs for the sacco shortcode', async () => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(
                of({ data: { ResponseDescription: 'success' } }),
            );

            await service.registerC2BUrls(SACCO_ID);

            const payload = httpService.post.mock.calls[0][1];
            expect(payload.ShortCode).toBe(CREDS.shortcode);
            // <base>/payment/c2b/<kind>/<saccoId>/<64-hex HMAC for that sacco>
            expect(payload.ConfirmationURL).toMatch(/c2b\/confirmation\/[^/]+\/[0-9a-f]{64}$/);
            expect(payload.ValidationURL).toMatch(/c2b\/validation\/[^/]+\/[0-9a-f]{64}$/);
        });

        it('discards the cached token and throws a clean error on failure', async () => {
            httpService.get.mockReturnValue(tokenResponse());
            httpService.post.mockReturnValue(throwError(() => httpError(400)));

            await expect(service.registerC2BUrls(SACCO_ID)).rejects.toBeInstanceOf(
                BadRequestException,
            );

            // A stale token is a common cause of registration failure, so the
            // next attempt must fetch a fresh one rather than replay the bad one.
            httpService.post.mockReturnValue(
                of({ data: { ResponseDescription: 'success' } }),
            );
            await service.registerC2BUrls(SACCO_ID);
            expect(httpService.get).toHaveBeenCalledTimes(2);
        });
    });
});
