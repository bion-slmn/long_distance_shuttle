// src/payment/mpesa/mpesa.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { MpesaService } from './mpesa.service';
import {
    MpesaTransactionMatchStatus,
    MpesaTransactionSource,
} from '../entities/mpesa.entity';

describe('MpesaService', () => {
    let service: MpesaService;

    let httpService: { get: jest.Mock; post: jest.Mock };
    let saccoSettingsService: { getDecryptedMpesaCredentials: jest.Mock };
    let mpesaTransactionRepo: {
        create: jest.Mock;
        save: jest.Mock;
        update: jest.Mock;
        findOneByOrFail: jest.Mock;
        find: jest.Mock;
        createQueryBuilder: jest.Mock;
    };
    let qb: {
        where: jest.Mock;
        andWhere: jest.Mock;
        orderBy: jest.Mock;
        getMany: jest.Mock;
    };

    const SACCO_ID = 'sacco-1';
    const CREDS = {
        consumerKey: 'ck',
        consumerSecret: 'cs',
        shortcode: '123456',
        passkey: 'pk',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers().setSystemTime(new Date('2024-01-15T12:15:30+03:00'));

        httpService = { get: jest.fn(), post: jest.fn() };
        saccoSettingsService = { getDecryptedMpesaCredentials: jest.fn() };

        qb = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn(),
        };

        mpesaTransactionRepo = {
            create: jest.fn((data) => data),
            save: jest.fn(),
            update: jest.fn(),
            findOneByOrFail: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(() => qb),
        };

        saccoSettingsService.getDecryptedMpesaCredentials.mockResolvedValue(CREDS);

        service = new MpesaService(
            httpService as any,
            saccoSettingsService as any,
            mpesaTransactionRepo as any,
        );
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // ── getAccessToken (exercised via initiateStkPush) ──────────────────────
    describe('access token caching', () => {
        const push = () =>
            service.initiateStkPush(SACCO_ID, {
                payerPhone: '0712345678',
                amount: 100,
                accountReference: 'BK-1',
            } as any);

        const okPush = () =>
            of({
                data: {
                    MerchantRequestID: 'm1',
                    CheckoutRequestID: 'c1',
                    ResponseDescription: 'Success',
                },
            });

        it('fetches a token when none is cached and presents it as a bearer', async () => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'tok-1', expires_in: 3600 } }),
            );
            httpService.post.mockReturnValue(okPush());

            await push();

            expect(httpService.get).toHaveBeenCalledTimes(1);
            const [, , config] = httpService.post.mock.calls[0];
            expect(config.headers.Authorization).toBe('Bearer tok-1');
        });

        it('reuses the cached token on a second call and skips the OAuth round trip', async () => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'cached-tok', expires_in: 3600 } }),
            );
            httpService.post.mockReturnValue(okPush());

            await push();
            await push();

            expect(httpService.get).toHaveBeenCalledTimes(1);
            const [, , config] = httpService.post.mock.calls[1];
            expect(config.headers.Authorization).toBe('Bearer cached-tok');
        });

        // A stale token would otherwise keep failing every call until its TTL
        // ran out, since nothing else would evict it.
        it('discards the cached token after a failed Daraja call', async () => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'tok-1', expires_in: 3600 } }),
            );
            httpService.post.mockReturnValue(okPush());
            await push();
            expect(httpService.get).toHaveBeenCalledTimes(1);

            httpService.post.mockReturnValue(
                throwError(() => ({ response: { status: 401, data: { errorMessage: 'Invalid Access Token' } } })),
            );
            await expect(push()).rejects.toThrow(BadRequestException);

            // Cache was cleared by the failure, so this re-fetches rather than
            // presenting the same rejected token again.
            httpService.post.mockReturnValue(okPush());
            await push();

            expect(httpService.get).toHaveBeenCalledTimes(2);
        });

        it('keeps the token cached across a successful call', async () => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'tok-1', expires_in: 3600 } }),
            );
            httpService.post.mockReturnValue(okPush());

            await push();
            await push();
            await push();

            expect(httpService.get).toHaveBeenCalledTimes(1);
        });
    });

    // ── initiateStkPush ──────────────────────────────────────────────────────
    describe('initiateStkPush', () => {
        beforeEach(() => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'cached-tok', expires_in: 3600 } }),
            );
        });

        it('normalizes a 07XX phone to 2547XX and rounds the amount', async () => {
            httpService.post.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'm1',
                        CheckoutRequestID: 'c1',
                        ResponseDescription: 'Success',
                    },
                }),
            );

            await service.initiateStkPush(SACCO_ID, {
                payerPhone: '0712345678',
                amount: 99.6,
                accountReference: 'BK-1',
            } as any);

            const [, payload] = httpService.post.mock.calls[0];
            expect(payload.PhoneNumber).toBe('254712345678');
            expect(payload.PartyA).toBe('254712345678');
            expect(payload.Amount).toBe(100);
            expect(payload.TransactionType).toBe('CustomerPayBillOnline');
            expect(payload.AccountReference).toBe('BK-1');
        });

        it('accepts a phone already in 254 format', async () => {
            httpService.post.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'm1',
                        CheckoutRequestID: 'c1',
                        ResponseDescription: 'Success',
                    },
                }),
            );

            await service.initiateStkPush(SACCO_ID, {
                payerPhone: '254712345678',
                amount: 50,
                accountReference: 'BK-2',
            } as any);

            const [, payload] = httpService.post.mock.calls[0];
            expect(payload.PhoneNumber).toBe('254712345678');
        });

        it('throws BadRequestException for an unrecognized phone format', async () => {
            await expect(
                service.initiateStkPush(SACCO_ID, {
                    payerPhone: '+1-555-0100',
                    amount: 50,
                    accountReference: 'BK-3',
                } as any),
            ).rejects.toThrow(BadRequestException);

            expect(httpService.post).not.toHaveBeenCalled();
        });

        it('returns the mapped STK push result on success', async () => {
            httpService.post.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'merchant-9',
                        CheckoutRequestID: 'checkout-9',
                        ResponseDescription: 'Success. Request accepted for processing',
                    },
                }),
            );

            const result = await service.initiateStkPush(SACCO_ID, {
                payerPhone: '0712345678',
                amount: 100,
                accountReference: 'BK-9',
            } as any);

            expect(result).toEqual({
                merchantRequestId: 'merchant-9',
                checkoutRequestId: 'checkout-9',
                responseDescription: 'Success. Request accepted for processing',
            });
        });

        it('wraps a Daraja error into a BadRequestException', async () => {
            httpService.post.mockReturnValue(
                throwError(() => ({
                    response: { data: { errorMessage: 'Invalid credentials' } },
                    message: 'Request failed',
                })),
            );

            await expect(
                service.initiateStkPush(SACCO_ID, {
                    payerPhone: '0712345678',
                    amount: 100,
                    accountReference: 'BK-1',
                } as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('falls back to a default TransactionDesc when none is provided', async () => {
            httpService.post.mockReturnValue(
                of({
                    data: {
                        MerchantRequestID: 'm1',
                        CheckoutRequestID: 'c1',
                        ResponseDescription: 'Success',
                    },
                }),
            );

            await service.initiateStkPush(SACCO_ID, {
                payerPhone: '0712345678',
                amount: 100,
                accountReference: 'BK-1',
            } as any);

            const [, payload] = httpService.post.mock.calls[0];
            expect(payload.TransactionDesc).toBe('Shuttle seat booking');
        });
    });

    // ── queryStkStatus ────────────────────────────────────────────────────────
    describe('queryStkStatus', () => {
        it('returns the numeric result code and description', async () => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'cached-tok', expires_in: 3600 } }),
            );
            httpService.post.mockReturnValue(
                of({ data: { ResultCode: '0', ResultDesc: 'The service request is processed successfully.' } }),
            );

            const result = await service.queryStkStatus(SACCO_ID, 'checkout-1');

            expect(result).toEqual({
                resultCode: 0,
                resultDesc: 'The service request is processed successfully.',
                errorCode: null,
            });
        });

        // Daraja answers an in-flight query with a 200 carrying only
        // errorCode/errorMessage. Number(undefined) is NaN, which used to fall
        // through every code comparison and get read as a failure — cancelling
        // a booking while the passenger was still entering their PIN.
        it('returns a null result code when Daraja omits ResultCode entirely', async () => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'cached-tok', expires_in: 3600 } }),
            );
            httpService.post.mockReturnValue(
                of({
                    data: {
                        errorCode: '500.001.1001',
                        errorMessage: 'The transaction is being processed',
                    },
                }),
            );

            const result = await service.queryStkStatus(SACCO_ID, 'checkout-1');

            expect(result).toEqual({
                resultCode: null,
                resultDesc: 'The transaction is being processed',
                errorCode: '500.001.1001',
            });
        });

        it('returns a null result code when ResultCode is present but not numeric', async () => {
            httpService.get.mockReturnValue(
                of({ data: { access_token: 'cached-tok', expires_in: 3600 } }),
            );
            httpService.post.mockReturnValue(
                of({ data: { ResultCode: 'not-a-number', ResultDesc: 'Odd' } }),
            );

            const result = await service.queryStkStatus(SACCO_ID, 'checkout-1');

            expect(result.resultCode).toBeNull();
        });
    });

    // ── parseCallback ─────────────────────────────────────────────────────────
    describe('parseCallback', () => {
        it('parses a successful callback and pulls values out of CallbackMetadata', () => {
            const body = {
                Body: {
                    stkCallback: {
                        CheckoutRequestID: 'checkout-1',
                        ResultCode: 0,
                        ResultDesc: 'Success',
                        CallbackMetadata: {
                            Item: [
                                { Name: 'Amount', Value: 250 },
                                { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
                                { Name: 'TransactionDate', Value: 20240115121530 },
                                { Name: 'PhoneNumber', Value: 254712345678 },
                            ],
                        },
                    },
                },
            } as any;

            const result = service.parseCallback(body);

            expect(result).toEqual({
                checkoutRequestId: 'checkout-1',
                resultCode: 0,
                resultDesc: 'Success',
                success: true,
                amount: 250,
                mpesaReceiptNumber: 'NLJ7RT61SV',
                transactionDate: '20240115121530',
                payerPhone: '254712345678',
            });
        });

        it('returns only the base fields for a failed/cancelled callback', () => {
            const body = {
                Body: {
                    stkCallback: {
                        CheckoutRequestID: 'checkout-2',
                        ResultCode: 1032,
                        ResultDesc: 'Request cancelled by user',
                    },
                },
            } as any;

            const result = service.parseCallback(body);

            expect(result).toEqual({
                checkoutRequestId: 'checkout-2',
                resultCode: 1032,
                resultDesc: 'Request cancelled by user',
                success: false,
            });
        });
    });

    // ── handleStkCallback ────────────────────────────────────────────────────
    describe('handleStkCallback', () => {
        const successBody = {
            Body: {
                stkCallback: {
                    CheckoutRequestID: 'checkout-1',
                    ResultCode: 0,
                    ResultDesc: 'Success',
                    CallbackMetadata: {
                        Item: [
                            { Name: 'Amount', Value: 250 },
                            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
                            { Name: 'TransactionDate', Value: 20240115121530 },
                            { Name: 'PhoneNumber', Value: 254712345678 },
                        ],
                    },
                },
            },
        } as any;

        it('persists the transaction on a successful callback', async () => {
            mpesaTransactionRepo.save.mockResolvedValue({ id: 'tx-1' });

            const result = await service.handleStkCallback(successBody);

            expect(mpesaTransactionRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: MpesaTransactionSource.STK_PUSH,
                    mpesaReceiptNumber: 'NLJ7RT61SV',
                    checkoutRequestId: 'checkout-1',
                    amount: 250,
                    payerPhone: '254712345678',
                }),
            );
            expect(mpesaTransactionRepo.save).toHaveBeenCalled();
            expect(result.success).toBe(true);
        });

        it('parses the Daraja transaction date as EAT (UTC+3)', async () => {
            mpesaTransactionRepo.save.mockResolvedValue({ id: 'tx-1' });

            await service.handleStkCallback(successBody);

            const stored = mpesaTransactionRepo.create.mock.calls[0][0];
            expect(stored.transactionTime.toISOString()).toBe(
                new Date('2024-01-15T09:15:30.000Z').toISOString(),
            );
        });

        it('does not persist anything for a failed callback', async () => {
            const failedBody = {
                Body: {
                    stkCallback: {
                        CheckoutRequestID: 'checkout-2',
                        ResultCode: 1032,
                        ResultDesc: 'Request cancelled by user',
                    },
                },
            } as any;

            const result = await service.handleStkCallback(failedBody);

            expect(mpesaTransactionRepo.create).not.toHaveBeenCalled();
            expect(mpesaTransactionRepo.save).not.toHaveBeenCalled();
            expect(result.success).toBe(false);
        });
    });

    // ── handleC2BConfirmation ────────────────────────────────────────────────
    describe('handleC2BConfirmation', () => {
        it('maps and persists a C2B confirmation, joining the payer name', async () => {
            mpesaTransactionRepo.save.mockResolvedValue({ id: 'tx-2' });

            const body = {
                TransactionType: 'Pay Bill',
                TransID: 'OEI2AK4Q16',
                TransTime: '20240115121530',
                TransAmount: '500.00',
                BusinessShortCode: '123456',
                BillRefNumber: 'BK-42',
                MSISDN: '254712345678',
                FirstName: 'John',
                MiddleName: '',
                LastName: 'Doe',
            } as any;

            await service.handleC2BConfirmation(body);

            expect(mpesaTransactionRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: MpesaTransactionSource.C2B,
                    mpesaReceiptNumber: 'OEI2AK4Q16',
                    checkoutRequestId: undefined,
                    amount: 500,
                    payerPhone: '254712345678',
                    payerName: 'John Doe',
                    billRefNumber: 'BK-42',
                    businessShortCode: '123456',
                }),
            );
        });

        it('leaves payerName undefined when no name fields are present', async () => {
            mpesaTransactionRepo.save.mockResolvedValue({ id: 'tx-3' });

            const body = {
                TransactionType: 'Pay Bill',
                TransID: 'OEI2AK4Q17',
                TransTime: '20240115121530',
                TransAmount: '500.00',
                BusinessShortCode: '123456',
                BillRefNumber: 'BK-43',
                MSISDN: '254712345678',
            } as any;

            await service.handleC2BConfirmation(body);

            const stored = mpesaTransactionRepo.create.mock.calls[0][0];
            expect(stored.payerName).toBeUndefined();
        });
    });

    // ── storeTransaction idempotency (via handleC2BConfirmation) ────────────
    describe('duplicate transaction handling', () => {
        it('swallows a Postgres unique_violation on a resent receipt', async () => {
            mpesaTransactionRepo.save.mockRejectedValue({ code: '23505' });

            const body = {
                TransID: 'DUPLICATE1',
                TransTime: '20240115121530',
                TransAmount: '500.00',
                BusinessShortCode: '123456',
                BillRefNumber: 'BK-42',
                MSISDN: '254712345678',
            } as any;

            await expect(service.handleC2BConfirmation(body)).resolves.toBeUndefined();
        });

        it('rethrows non-duplicate persistence errors', async () => {
            mpesaTransactionRepo.save.mockRejectedValue(new Error('connection lost'));

            const body = {
                TransID: 'FAILCASE1',
                TransTime: '20240115121530',
                TransAmount: '500.00',
                BusinessShortCode: '123456',
                BillRefNumber: 'BK-42',
                MSISDN: '254712345678',
            } as any;

            await expect(service.handleC2BConfirmation(body)).rejects.toThrow(
                'connection lost',
            );
        });
    });

    // ── getTransactionsByPhone ────────────────────────────────────────────────
    describe('getTransactionsByPhone', () => {
        it('matches on the last 9 digits regardless of input format', async () => {
            qb.getMany.mockResolvedValue([{ id: 'tx-1' }]);

            const result = await service.getTransactionsByPhone('0712345678');

            expect(qb.where).toHaveBeenCalledWith('t.payerPhone LIKE :suffix', {
                suffix: '%712345678',
            });
            expect(result).toEqual([{ id: 'tx-1' }]);
        });

        it('applies dateFrom/dateTo filters when provided', async () => {
            qb.getMany.mockResolvedValue([]);
            const from = new Date('2024-01-01');
            const to = new Date('2024-01-31');

            await service.getTransactionsByPhone('254712345678', from, to);

            expect(qb.andWhere).toHaveBeenCalledWith('t.transactionTime >= :dateFrom', {
                dateFrom: from,
            });
            expect(qb.andWhere).toHaveBeenCalledWith('t.transactionTime <= :dateTo', {
                dateTo: to,
            });
        });

        it('skips date filters entirely when not provided', async () => {
            qb.getMany.mockResolvedValue([]);

            await service.getTransactionsByPhone('254712345678');

            expect(qb.andWhere).not.toHaveBeenCalled();
        });

        it('throws for an unrecognized phone format', async () => {
            await expect(
                service.getTransactionsByPhone('not-a-phone'),
            ).rejects.toThrow(BadRequestException);
        });
    });

    // ── matchTransaction ──────────────────────────────────────────────────────
    describe('matchTransaction', () => {
        it('marks an unmatched transaction as matched and returns the updated row', async () => {
            mpesaTransactionRepo.update.mockResolvedValue({ affected: 1 });
            mpesaTransactionRepo.findOneByOrFail.mockResolvedValue({
                id: 'tx-1',
                matchStatus: MpesaTransactionMatchStatus.MATCHED,
            });

            const result = await service.matchTransaction(
                'tx-1',
                'booking-1',
                'payment-1',
                'user-1',
            );

            expect(mpesaTransactionRepo.update).toHaveBeenCalledWith(
                { id: 'tx-1', matchStatus: MpesaTransactionMatchStatus.UNMATCHED },
                expect.objectContaining({
                    matchStatus: MpesaTransactionMatchStatus.MATCHED,
                    matchedBookingId: 'booking-1',
                    matchedPaymentId: 'payment-1',
                    matchedBy: 'user-1',
                }),
            );
            expect(result.matchStatus).toBe(MpesaTransactionMatchStatus.MATCHED);
        });

        it('throws when the transaction is missing or already matched', async () => {
            mpesaTransactionRepo.update.mockResolvedValue({ affected: 0 });

            await expect(
                service.matchTransaction('tx-missing', 'booking-1', 'payment-1', 'user-1'),
            ).rejects.toThrow(BadRequestException);

            expect(mpesaTransactionRepo.findOneByOrFail).not.toHaveBeenCalled();
        });
    });

    // ── getTransactionsByDateRange ────────────────────────────────────────────
    describe('getTransactionsByDateRange', () => {
        it('queries with a Between range ordered by most recent first', async () => {
            mpesaTransactionRepo.find.mockResolvedValue([{ id: 'tx-1' }]);
            const from = new Date('2024-01-01');
            const to = new Date('2024-01-31');

            const result = await service.getTransactionsByDateRange(from, to);

            expect(mpesaTransactionRepo.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    order: { transactionTime: 'DESC' },
                }),
            );
            expect(result).toEqual([{ id: 'tx-1' }]);
        });
    });
});