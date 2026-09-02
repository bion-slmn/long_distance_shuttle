// src/payment/mpesa/mpesa.controller.spec.ts
import { MpesaController } from './mpesa.controller';

describe('MpesaController', () => {
    let controller: MpesaController;

    let mpesaService: {
        getTransactionsByPhone: jest.Mock;
        getUnmatchedSummary: jest.Mock;
        handleStkCallback: jest.Mock;
        simulateC2BPayment: jest.Mock;
    };
    let paymentService: { handleMpesaCallback: jest.Mock };
    let loggerErrorSpy: jest.SpyInstance;
    let loggerLogSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        mpesaService = {
            getTransactionsByPhone: jest.fn(),
            getUnmatchedSummary: jest.fn(),
            handleStkCallback: jest.fn(),
            simulateC2BPayment: jest.fn(),
        };
        paymentService = { handleMpesaCallback: jest.fn() };

        controller = new MpesaController(
            mpesaService as any,
            paymentService as any,
        );

        // Silence + spy on the controller's own Logger instance.
        loggerErrorSpy = jest
            .spyOn((controller as any).logger, 'error')
            .mockImplementation(() => undefined);
        loggerLogSpy = jest
            .spyOn((controller as any).logger, 'log')
            .mockImplementation(() => undefined);
    });

    const superAdmin = { role: 'SUPER_ADMIN', saccoId: null };
    const saccoAdmin = { role: 'SACCO_ADMIN', saccoId: 'sacco-1' };
    const clerk = { role: 'CLERK', saccoId: 'sacco-1' };

    // ── GET /payment/mpesa/transactions ────────────────────────────────────
    describe('getTransactionsByPhone', () => {
        it('parses dateFrom/dateTo strings into Dates before delegating', async () => {
            mpesaService.getTransactionsByPhone.mockResolvedValue([{ id: 'tx-1' }]);

            const result = await controller.getTransactionsByPhone({
                phone: '0712345678',
                dateFrom: '2024-01-01',
                dateTo: '2024-01-31',
            } as any, superAdmin);

            expect(mpesaService.getTransactionsByPhone).toHaveBeenCalledWith(
                '0712345678',
                new Date('2024-01-01'),
                new Date('2024-01-31'),
                undefined,
            );
            expect(result).toEqual([{ id: 'tx-1' }]);
        });

        it('passes undefined for dateFrom/dateTo when omitted', async () => {
            mpesaService.getTransactionsByPhone.mockResolvedValue([]);

            await controller.getTransactionsByPhone({
                phone: '0712345678',
            } as any, superAdmin);

            expect(mpesaService.getTransactionsByPhone).toHaveBeenCalledWith(
                '0712345678',
                undefined,
                undefined,
                undefined,
            );
        });

        it('scopes a clerk or sacco admin to their own sacco, ignoring ?saccoId', async () => {
            mpesaService.getTransactionsByPhone.mockResolvedValue([]);

            await controller.getTransactionsByPhone(
                { phone: '0712345678', saccoId: 'someone-elses-sacco' } as any,
                clerk,
            );

            expect(mpesaService.getTransactionsByPhone.mock.calls[0][3]).toBe('sacco-1');
        });

        it('lets a super admin narrow to one sacco via ?saccoId', async () => {
            mpesaService.getTransactionsByPhone.mockResolvedValue([]);

            await controller.getTransactionsByPhone(
                { phone: '0712345678', saccoId: 'sacco-9' } as any,
                superAdmin,
            );

            expect(mpesaService.getTransactionsByPhone.mock.calls[0][3]).toBe('sacco-9');
        });

        it('rejects a non-super-admin with no sacco assignment', async () => {
            await expect(
                controller.getTransactionsByPhone({ phone: '0712345678' } as any, {
                    role: 'CLERK',
                    saccoId: null,
                }),
            ).rejects.toThrow('not assigned to a sacco');
            expect(mpesaService.getTransactionsByPhone).not.toHaveBeenCalled();
        });

        it('lets a service error propagate (not a Safaricom-facing endpoint)', async () => {
            mpesaService.getTransactionsByPhone.mockRejectedValue(
                new Error('lookup failed'),
            );

            await expect(
                controller.getTransactionsByPhone({ phone: '0712345678' } as any, superAdmin),
            ).rejects.toThrow('lookup failed');
        });
    });

    // ── POST /payment/mpesa/callback ───────────────────────────────────────
    describe('handleCallback', () => {
        const body = {
            Body: {
                stkCallback: {
                    CheckoutRequestID: 'checkout-1',
                    ResultCode: 0,
                    ResultDesc: 'Success',
                },
            },
        } as any;

        it('parses the callback and forwards it to PaymentService', async () => {
            const parsed = {
                checkoutRequestId: 'checkout-1',
                resultCode: 0,
                resultDesc: 'Success',
                success: true,
            };
            mpesaService.handleStkCallback.mockResolvedValue(parsed);

            const result = await controller.handleCallback(body);

            expect(mpesaService.handleStkCallback).toHaveBeenCalledWith(body);
            expect(paymentService.handleMpesaCallback).toHaveBeenCalledWith(
                parsed,
                body,
            );
            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
        });

        it('still returns the Daraja ack shape when handleStkCallback throws', async () => {
            mpesaService.handleStkCallback.mockRejectedValue(
                new Error('db unavailable'),
            );

            const result = await controller.handleCallback(body);

            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
            expect(paymentService.handleMpesaCallback).not.toHaveBeenCalled();
            expect(loggerErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('db unavailable'),
                expect.anything(),
            );
        });

        it('still returns the Daraja ack shape when PaymentService throws', async () => {
            mpesaService.handleStkCallback.mockResolvedValue({
                checkoutRequestId: 'checkout-1',
                resultCode: 0,
                resultDesc: 'Success',
                success: true,
            });
            paymentService.handleMpesaCallback.mockRejectedValue(
                new Error('booking not found'),
            );

            const result = await controller.handleCallback(body);

            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
            expect(loggerErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('booking not found'),
                expect.anything(),
            );
        });

        it('never throws, regardless of downstream failures', async () => {
            mpesaService.handleStkCallback.mockRejectedValue(new Error('boom'));

            await expect(controller.handleCallback(body)).resolves.toBeDefined();
        });
    });

    // ── GET /payment/mpesa/transactions/unmatched-summary ──────────────────
    describe('getUnmatchedSummary', () => {
        it('is platform-wide for a super admin with no ?saccoId', async () => {
            mpesaService.getUnmatchedSummary.mockResolvedValue({ count: 0 });

            await controller.getUnmatchedSummary(undefined, superAdmin);

            expect(mpesaService.getUnmatchedSummary).toHaveBeenCalledWith(undefined);
        });

        it('is always the sacco admin\'s own sacco', async () => {
            mpesaService.getUnmatchedSummary.mockResolvedValue({ count: 0 });

            await controller.getUnmatchedSummary('sacco-9', saccoAdmin);

            expect(mpesaService.getUnmatchedSummary).toHaveBeenCalledWith('sacco-1');
        });
    });

    // ── POST /payment/mpesa/:saccoId/c2b/simulate ──────────────────────────
    describe('simulateC2BPayment', () => {
        it('delegates to MpesaService with the sacco id and body', async () => {
            mpesaService.simulateC2BPayment.mockResolvedValue({
                responseDescription: 'ok',
                conversationId: 'AG_1',
            });

            const dto = { amount: 1500, billRefNumber: 'NRB-MSA' };
            const result = await controller.simulateC2BPayment('sacco-1', dto as any);

            expect(mpesaService.simulateC2BPayment).toHaveBeenCalledWith('sacco-1', dto);
            expect(result).toEqual({ responseDescription: 'ok', conversationId: 'AG_1' });
        });
    });
});
