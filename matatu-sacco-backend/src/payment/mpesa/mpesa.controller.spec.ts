// src/payment/mpesa/mpesa.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MpesaController } from './mpesa.controller';
import { MpesaService } from './mpesa.service';
import { PaymentService } from '../payment.service';

describe('MpesaController', () => {
    let controller: MpesaController;
    let mpesaService: Partial<Record<keyof MpesaService, jest.Mock>>;
    let paymentService: Partial<Record<keyof PaymentService, jest.Mock>>;
    let loggerErrorSpy: jest.SpyInstance;
    let loggerLogSpy: jest.SpyInstance;

    const rawBody = {
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

    const parsedSuccess = {
        checkoutRequestId: 'ws_CO_1',
        resultCode: 0,
        resultDesc: 'The service request is processed successfully.',
        success: true,
        amount: 500,
        mpesaReceiptNumber: 'NLJ7RT61SV',
        transactionDate: '20260817101530',
        payerPhone: '254712345678',
    };

    beforeEach(async () => {
        mpesaService = {
            parseCallback: jest.fn(),
        };
        paymentService = {
            handleMpesaCallback: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [MpesaController],
            providers: [
                { provide: MpesaService, useValue: mpesaService },
                { provide: PaymentService, useValue: paymentService },
            ],
        }).compile();

        controller = module.get<MpesaController>(MpesaController);

        // Silence + spy on the controller's Logger instance
        loggerErrorSpy = jest
            .spyOn((controller as any).logger, 'error')
            .mockImplementation(() => undefined);
        loggerLogSpy = jest
            .spyOn((controller as any).logger, 'log')
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('handleCallback', () => {
        it('parses the body, forwards it to PaymentService, and acknowledges Daraja', async () => {
            mpesaService.parseCallback!.mockReturnValue(parsedSuccess);
            paymentService.handleMpesaCallback!.mockResolvedValue(undefined);

            const result = await controller.handleCallback(rawBody);

            expect(mpesaService.parseCallback).toHaveBeenCalledWith(rawBody);
            expect(paymentService.handleMpesaCallback).toHaveBeenCalledWith(parsedSuccess, rawBody);
            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
        });

        it('logs the parsed callback summary', async () => {
            mpesaService.parseCallback!.mockReturnValue(parsedSuccess);
            paymentService.handleMpesaCallback!.mockResolvedValue(undefined);

            await controller.handleCallback(rawBody);

            expect(loggerLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('checkoutRequestId=ws_CO_1'),
            );
            expect(loggerLogSpy).toHaveBeenCalledWith(expect.stringContaining('success=true'));
        });

        it('still returns { ResultCode: 0, ResultDesc: "Accepted" } when parseCallback throws', async () => {
            mpesaService.parseCallback!.mockImplementation(() => {
                throw new Error('Malformed callback payload');
            });

            const result = await controller.handleCallback(rawBody);

            expect(paymentService.handleMpesaCallback).not.toHaveBeenCalled();
            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
            expect(loggerErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Malformed callback payload'),
                expect.anything(),
            );
        });

        it('still returns { ResultCode: 0, ResultDesc: "Accepted" } when handleMpesaCallback rejects', async () => {
            mpesaService.parseCallback!.mockReturnValue(parsedSuccess);
            paymentService.handleMpesaCallback!.mockRejectedValue(new Error('DB connection lost'));

            const result = await controller.handleCallback(rawBody);

            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
            expect(loggerErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('DB connection lost'),
                expect.anything(),
            );
        });

        it('never throws out of handleCallback, even on unexpected errors', async () => {
            mpesaService.parseCallback!.mockImplementation(() => {
                throw new TypeError('Cannot read properties of undefined');
            });

            await expect(controller.handleCallback(rawBody)).resolves.toEqual({
                ResultCode: 0,
                ResultDesc: 'Accepted',
            });
        });

        it('handles a FAILED callback the same way — still calls through and acknowledges 200', async () => {
            const parsedFailed = {
                checkoutRequestId: 'ws_CO_2',
                resultCode: 1032,
                resultDesc: 'Request cancelled by user.',
                success: false,
            };
            mpesaService.parseCallback!.mockReturnValue(parsedFailed);
            paymentService.handleMpesaCallback!.mockResolvedValue(undefined);

            const failedRawBody = {
                Body: {
                    stkCallback: {
                        MerchantRequestID: 'mr_2',
                        CheckoutRequestID: 'ws_CO_2',
                        ResultCode: 1032,
                        ResultDesc: 'Request cancelled by user.',
                    },
                },
            } as any;

            const result = await controller.handleCallback(failedRawBody);

            expect(paymentService.handleMpesaCallback).toHaveBeenCalledWith(parsedFailed, failedRawBody);
            expect(result).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
        });
    });
});