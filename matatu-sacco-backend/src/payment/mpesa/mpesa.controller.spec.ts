// src/payment/mpesa/mpesa.controller.spec.ts
import { MpesaController } from './mpesa.controller';

describe('MpesaController', () => {
    let controller: MpesaController;

    let mpesaService: {
        getTransactionsByPhone: jest.Mock;
        handleStkCallback: jest.Mock;
        handleC2BConfirmation: jest.Mock;
    };
    let paymentService: { handleMpesaCallback: jest.Mock };
    let loggerErrorSpy: jest.SpyInstance;
    let loggerLogSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        mpesaService = {
            getTransactionsByPhone: jest.fn(),
            handleStkCallback: jest.fn(),
            handleC2BConfirmation: jest.fn(),
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

    // ── GET /payment/mpesa/transactions ────────────────────────────────────
    describe('getTransactionsByPhone', () => {
        it('parses dateFrom/dateTo strings into Dates before delegating', async () => {
            mpesaService.getTransactionsByPhone.mockResolvedValue([{ id: 'tx-1' }]);

            const result = await controller.getTransactionsByPhone({
                phone: '0712345678',
                dateFrom: '2024-01-01',
                dateTo: '2024-01-31',
            } as any);

            expect(mpesaService.getTransactionsByPhone).toHaveBeenCalledWith(
                '0712345678',
                new Date('2024-01-01'),
                new Date('2024-01-31'),
            );
            expect(result).toEqual([{ id: 'tx-1' }]);
        });

        it('passes undefined for dateFrom/dateTo when omitted', async () => {
            mpesaService.getTransactionsByPhone.mockResolvedValue([]);

            await controller.getTransactionsByPhone({
                phone: '0712345678',
            } as any);

            expect(mpesaService.getTransactionsByPhone).toHaveBeenCalledWith(
                '0712345678',
                undefined,
                undefined,
            );
        });

        it('lets a service error propagate (not a Safaricom-facing endpoint)', async () => {
            mpesaService.getTransactionsByPhone.mockRejectedValue(
                new Error('lookup failed'),
            );

            await expect(
                controller.getTransactionsByPhone({ phone: '0712345678' } as any),
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

    // ── POST /payment/mpesa/c2b/validation ─────────────────────────────────
    describe('handleC2BValidation', () => {
        it('logs the incoming payload and accepts by default', async () => {
            const body = {
                TransID: 'OEI2AK4Q16',
                BillRefNumber: 'BK-42',
                MSISDN: '254712345678',
            };

            const result = await controller.handleC2BValidation(body);

            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
            expect(loggerLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('OEI2AK4Q16'),
            );
        });

        it('still accepts even with a malformed/empty body', async () => {
            const result = await controller.handleC2BValidation(undefined as any);

            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
        });
    });

    // ── POST /payment/mpesa/c2b/confirmation ───────────────────────────────
    describe('handleC2BConfirmation', () => {
        const body = {
            TransID: 'OEI2AK4Q16',
            BillRefNumber: 'BK-42',
            MSISDN: '254712345678',
            TransAmount: '500.00',
        };

        it('delegates to MpesaService and acknowledges receipt', async () => {
            mpesaService.handleC2BConfirmation.mockResolvedValue(undefined);

            const result = await controller.handleC2BConfirmation(body);

            expect(mpesaService.handleC2BConfirmation).toHaveBeenCalledWith(body);
            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
        });

        it('still acknowledges receipt when persistence throws', async () => {
            mpesaService.handleC2BConfirmation.mockRejectedValue(
                new Error('duplicate key'),
            );

            const result = await controller.handleC2BConfirmation(body);

            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
            expect(loggerErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('duplicate key'),
                expect.anything(),
            );
        });
    });
});