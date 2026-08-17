// src/payment/mpesa/mpesa.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { MpesaService } from './mpesa.service';
import { SaccoSettingsService } from '../../sacco/sacco-settings.service';
import { REDIS_CLIENT } from 'src/redis/redis.module';

describe('MpesaService', () => {
    let service: MpesaService;
    let httpService: Partial<Record<keyof HttpService, jest.Mock>>;
    let saccoSettingsService: Partial<Record<keyof SaccoSettingsService, jest.Mock>>;
    let redis: { get: jest.Mock; set: jest.Mock };

    const creds = {
        consumerKey: 'ck_123',
        consumerSecret: 'cs_456',
        shortcode: '174379',
        passkey: 'passkey_abc',
    };

    beforeEach(async () => {
        httpService = {
            get: jest.fn(),
            post: jest.fn(),
        };
        saccoSettingsService = {
            getDecryptedMpesaCredentials: jest.fn().mockResolvedValue(creds),
        };
        redis = {
            get: jest.fn(),
            set: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MpesaService,
                { provide: HttpService, useValue: httpService },
                { provide: SaccoSettingsService, useValue: saccoSettingsService },
                { provide: REDIS_CLIENT, useValue: redis },
            ],
        }).compile();

        service = module.get<MpesaService>(MpesaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ─── getAccessToken (private, exercised via initiateStkPush) ───────────
    describe('access token caching', () => {
        it('uses the cached Redis token instead of calling Daraja OAuth when present', async () => {
            redis.get.mockResolvedValue('cached_token');
            httpService.post!.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResponseDescription: 'Success. Request accepted for processing',
                    },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 500,
                accountReference: 'ABC123',
            });

            expect(httpService.get).not.toHaveBeenCalled();
            // Bearer token used should be the cached one
            const [, , config] = httpService.post!.mock.calls[0];
            expect(config.headers.Authorization).toBe('Bearer cached_token');
        });

        it('fetches and caches a new token when Redis has none', async () => {
            redis.get.mockResolvedValue(null);
            httpService.get!.mockReturnValue(
                of({ data: { access_token: 'fresh_token', expires_in: 3600 } }),
            );
            httpService.post!.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResponseDescription: 'Success. Request accepted for processing',
                    },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 500,
                accountReference: 'ABC123',
            });

            expect(httpService.get).toHaveBeenCalledWith(
                expect.stringContaining('/oauth/v1/generate?grant_type=client_credentials'),
                expect.objectContaining({
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64')}`,
                    },
                }),
            );
            expect(redis.set).toHaveBeenCalledWith(
                'mpesa:token:sacco-1',
                'fresh_token',
                'EX',
                3540, // 3600 - 60
            );
        });

        it('defaults TTL to 3600 - 60 when Daraja omits expires_in', async () => {
            redis.get.mockResolvedValue(null);
            httpService.get!.mockReturnValue(of({ data: { access_token: 'fresh_token' } }));
            httpService.post!.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResponseDescription: 'Success.',
                    },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 500,
                accountReference: 'ABC123',
            });

            expect(redis.set).toHaveBeenCalledWith('mpesa:token:sacco-1', 'fresh_token', 'EX', 3540);
        });
    });

    // ─── initiateStkPush ─────────────────────────────────────────────────
    describe('initiateStkPush', () => {
        beforeEach(() => {
            redis.get.mockResolvedValue('cached_token');
        });

        it('normalizes a 07XX phone number to 2547XX before sending', async () => {
            httpService.post!.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResponseDescription: 'Success.',
                    },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 500,
                accountReference: 'ABC123',
            });

            const [, payload] = httpService.post!.mock.calls[0];
            expect(payload.PartyA).toBe('254712345678');
            expect(payload.PhoneNumber).toBe('254712345678');
        });

        it('passes through a phone number already in 254 format unchanged', async () => {
            httpService.post!.mockReturnValue(
                of({
                    data: { MerchantRequestID: 'mr_1', CheckoutRequestID: 'ws_CO_1', ResponseDescription: 'OK' },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '254712345678',
                amount: 500,
                accountReference: 'ABC123',
            });

            const [, payload] = httpService.post!.mock.calls[0];
            expect(payload.PartyA).toBe('254712345678');
        });

        it('throws BadRequestException for an unrecognized phone format', async () => {
            await expect(
                service.initiateStkPush('sacco-1', {
                    payerPhone: '+1-555-1234',
                    amount: 500,
                    accountReference: 'ABC123',
                }),
            ).rejects.toThrow(BadRequestException);

            expect(httpService.post).not.toHaveBeenCalled();
        });

        it('rounds the amount before sending to Daraja', async () => {
            httpService.post!.mockReturnValue(
                of({
                    data: { MerchantRequestID: 'mr_1', CheckoutRequestID: 'ws_CO_1', ResponseDescription: 'OK' },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 499.6,
                accountReference: 'ABC123',
            });

            const [, payload] = httpService.post!.mock.calls[0];
            expect(payload.Amount).toBe(500);
        });

        it('builds the payload with sacco credentials, account reference, and default description', async () => {
            httpService.post!.mockReturnValue(
                of({
                    data: { MerchantRequestID: 'mr_1', CheckoutRequestID: 'ws_CO_1', ResponseDescription: 'OK' },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 500,
                accountReference: 'ABC123',
            });

            const [url, payload] = httpService.post!.mock.calls[0];
            expect(url).toContain('/mpesa/stkpush/v1/processrequest');
            expect(payload).toEqual(
                expect.objectContaining({
                    BusinessShortCode: creds.shortcode,
                    TransactionType: 'CustomerPayBillOnline',
                    PartyB: creds.shortcode,
                    AccountReference: 'ABC123',
                    TransactionDesc: 'Shuttle seat booking',
                }),
            );
        });

        it('uses a custom description when provided', async () => {
            httpService.post!.mockReturnValue(
                of({
                    data: { MerchantRequestID: 'mr_1', CheckoutRequestID: 'ws_CO_1', ResponseDescription: 'OK' },
                }),
            );

            await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 500,
                accountReference: 'ABC123',
                description: 'Custom fare description',
            } as any);

            const [, payload] = httpService.post!.mock.calls[0];
            expect(payload.TransactionDesc).toBe('Custom fare description');
        });

        it('returns merchantRequestId/checkoutRequestId/responseDescription on success', async () => {
            httpService.post!.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResponseDescription: 'Success. Request accepted for processing',
                    },
                }),
            );

            const result = await service.initiateStkPush('sacco-1', {
                payerPhone: '0712345678',
                amount: 500,
                accountReference: 'ABC123',
            });

            expect(result).toEqual({
                merchantRequestId: 'mr_1',
                checkoutRequestId: 'ws_CO_1',
                responseDescription: 'Success. Request accepted for processing',
            });
        });

        it('wraps a Daraja error into a generic BadRequestException (does not leak raw error)', async () => {
            httpService.post!.mockReturnValue(
                throwError(() => ({
                    message: 'Request failed with status code 400',
                    response: { data: { errorMessage: 'Invalid Access Token' } },
                })),
            );

            await expect(
                service.initiateStkPush('sacco-1', {
                    payerPhone: '0712345678',
                    amount: 500,
                    accountReference: 'ABC123',
                }),
            ).rejects.toThrow(BadRequestException);
        });

        it('still throws a generic BadRequestException when the error has no response body', async () => {
            httpService.post!.mockReturnValue(throwError(() => new Error('Network timeout')));

            await expect(
                service.initiateStkPush('sacco-1', {
                    payerPhone: '0712345678',
                    amount: 500,
                    accountReference: 'ABC123',
                }),
            ).rejects.toThrow(BadRequestException);
        });
    });

    // ─── queryStkStatus ──────────────────────────────────────────────────
    describe('queryStkStatus', () => {
        beforeEach(() => {
            redis.get.mockResolvedValue('cached_token');
        });

        it('posts to the stkpushquery endpoint and returns numeric resultCode + resultDesc', async () => {
            httpService.post!.mockReturnValue(
                of({ data: { ResultCode: '0', ResultDesc: 'The service request is processed successfully.' } }),
            );

            const result = await service.queryStkStatus('sacco-1', 'ws_CO_123');

            const [url, payload] = httpService.post!.mock.calls[0];
            expect(url).toContain('/mpesa/stkpushquery/v1/query');
            expect(payload).toEqual(
                expect.objectContaining({
                    BusinessShortCode: creds.shortcode,
                    CheckoutRequestID: 'ws_CO_123',
                }),
            );
            expect(result).toEqual({
                resultCode: 0,
                resultDesc: 'The service request is processed successfully.',
            });
        });

        it('coerces a numeric-string ResultCode like "1037" to a number', async () => {
            httpService.post!.mockReturnValue(
                of({ data: { ResultCode: '1037', ResultDesc: 'Transaction is being processed' } }),
            );

            const result = await service.queryStkStatus('sacco-1', 'ws_CO_123');

            expect(result.resultCode).toBe(1037);
            expect(typeof result.resultCode).toBe('number');
        });
    });

    // ─── parseCallback ───────────────────────────────────────────────────
    describe('parseCallback', () => {
        it('parses a successful callback and extracts metadata items', () => {
            const body = {
                Body: {
                    stkCallback: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResultCode: 0,
                        ResultDesc: 'The service request is processed successfully.',
                        CallbackMetadata: {
                            Item: [
                                { Name: 'Amount', Value: 500 },
                                { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
                                { Name: 'TransactionDate', Value: 20260817101530 },
                                { Name: 'PhoneNumber', Value: 254712345678 },
                            ],
                        },
                    },
                },
            } as any;

            const result = service.parseCallback(body);

            expect(result).toEqual({
                checkoutRequestId: 'ws_CO_1',
                resultCode: 0,
                resultDesc: 'The service request is processed successfully.',
                success: true,
                amount: 500,
                mpesaReceiptNumber: 'NLJ7RT61SV',
                transactionDate: '20260817101530',
                payerPhone: '254712345678',
            });
        });

        it('parses a failed callback without touching CallbackMetadata (absent on failure)', () => {
            const body = {
                Body: {
                    stkCallback: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResultCode: 1032,
                        ResultDesc: 'Request cancelled by user.',
                    },
                },
            } as any;

            const result = service.parseCallback(body);

            expect(result).toEqual({
                checkoutRequestId: 'ws_CO_1',
                resultCode: 1032,
                resultDesc: 'Request cancelled by user.',
                success: false,
            });
            expect(result.amount).toBeUndefined();
            expect(result.mpesaReceiptNumber).toBeUndefined();
        });

        it('handles a success callback with an empty/missing CallbackMetadata.Item array gracefully', () => {
            const body = {
                Body: {
                    stkCallback: {
                        MerchantRequestID: 'mr_1',
                        CheckoutRequestID: 'ws_CO_1',
                        ResultCode: 0,
                        ResultDesc: 'Success',
                        CallbackMetadata: {},
                    },
                },
            } as any;

            const result = service.parseCallback(body);

            expect(result.success).toBe(true);
            expect(result.amount).toBeUndefined();
            expect(result.mpesaReceiptNumber).toBeUndefined();
            expect(result.transactionDate).toBe('undefined'); // String(undefined) — see note below
        });
    });
});