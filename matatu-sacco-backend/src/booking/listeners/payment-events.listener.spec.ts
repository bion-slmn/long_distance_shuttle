// src/booking/listeners/payment-events.listener.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentEventsListener } from './payment-events.listener';
import { BookingService } from '../booking.service';
import type { PaymentSucceededEvent, PaymentFailedEvent } from '../../payment/payment.service';
import { PaymentReferenceType } from '../../payment/entities/payment.entity';

describe('PaymentEventsListener', () => {
    let listener: PaymentEventsListener;
    let bookingService: Partial<Record<keyof BookingService, jest.Mock>>;

    beforeEach(async () => {
        bookingService = {
            confirmPayment: jest.fn(),
            markPaymentFailed: jest.fn(),
            settleFromC2BReceipt: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentEventsListener,
                { provide: BookingService, useValue: bookingService },
            ],
        }).compile();

        listener = module.get<PaymentEventsListener>(PaymentEventsListener);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ─── handlePaymentSucceeded ────────────────────────────────────────
    describe('handlePaymentSucceeded', () => {
        it('confirms the booking with the mpesa receipt number for a BOOKING reference', async () => {
            const event: PaymentSucceededEvent = {
                paymentId: 'payment-1',
                referenceType: PaymentReferenceType.BOOKING,
                referenceId: 'booking-1',
                saccoId: 'sacco-1',
                amount: 500,
                mpesaReceiptNumber: 'NLJ7RT61SV',
            };

            await listener.handlePaymentSucceeded(event);

            expect(bookingService.confirmPayment).toHaveBeenCalledWith('booking-1', {
                mpesaReceiptNumber: 'NLJ7RT61SV',
            });
        });

        it('does nothing when referenceType is not BOOKING', async () => {
            const event = {
                paymentId: 'payment-1',
                referenceType: 'SOME_OTHER_TYPE' as PaymentReferenceType,
                referenceId: 'other-1',
                saccoId: 'sacco-1',
                amount: 500,
                mpesaReceiptNumber: 'NLJ7RT61SV',
            };

            await listener.handlePaymentSucceeded(event);

            expect(bookingService.confirmPayment).not.toHaveBeenCalled();
        });

        it('still calls confirmPayment even when mpesaReceiptNumber is undefined (e.g. cash path)', async () => {
            const event: PaymentSucceededEvent = {
                paymentId: 'payment-1',
                referenceType: PaymentReferenceType.BOOKING,
                referenceId: 'booking-1',
                saccoId: 'sacco-1',
                amount: 500,
                mpesaReceiptNumber: undefined,
            };

            await listener.handlePaymentSucceeded(event);

            expect(bookingService.confirmPayment).toHaveBeenCalledWith('booking-1', {
                mpesaReceiptNumber: undefined,
            });
        });

        it('propagates a rejection from bookingService.confirmPayment (e.g. booking not found)', async () => {
            const event: PaymentSucceededEvent = {
                paymentId: 'payment-1',
                referenceType: PaymentReferenceType.BOOKING,
                referenceId: 'missing-booking',
                saccoId: 'sacco-1',
                amount: 500,
                mpesaReceiptNumber: 'NLJ7RT61SV',
            };
            bookingService.confirmPayment!.mockRejectedValue(new Error('Booking "missing-booking" not found.'));

            await expect(listener.handlePaymentSucceeded(event)).rejects.toThrow(
                'Booking "missing-booking" not found.',
            );
        });
    });

    // ─── handlePaymentFailed ───────────────────────────────────────────
    describe('handlePaymentFailed', () => {
        it('marks the booking payment-failed for a BOOKING reference', async () => {
            const event: PaymentFailedEvent = {
                paymentId: 'payment-1',
                referenceType: PaymentReferenceType.BOOKING,
                referenceId: 'booking-1',
                saccoId: 'sacco-1',
                reason: 'Request cancelled by user.',
            };

            await listener.handlePaymentFailed(event);

            expect(bookingService.markPaymentFailed).toHaveBeenCalledWith('booking-1');
        });

        it('does nothing when referenceType is not BOOKING', async () => {
            const event = {
                paymentId: 'payment-1',
                referenceType: 'SOME_OTHER_TYPE' as PaymentReferenceType,
                referenceId: 'other-1',
                saccoId: 'sacco-1',
                reason: 'n/a',
            };

            await listener.handlePaymentFailed(event);

            expect(bookingService.markPaymentFailed).not.toHaveBeenCalled();
        });

        it('propagates a rejection from bookingService.markPaymentFailed', async () => {
            const event: PaymentFailedEvent = {
                paymentId: 'payment-1',
                referenceType: PaymentReferenceType.BOOKING,
                referenceId: 'missing-booking',
                saccoId: 'sacco-1',
                reason: 'Insufficient funds',
            };
            bookingService.markPaymentFailed!.mockRejectedValue(
                new Error('Booking "missing-booking" not found.'),
            );

            await expect(listener.handlePaymentFailed(event)).rejects.toThrow(
                'Booking "missing-booking" not found.',
            );
        });
    });

    // ─── handleC2BReceiptUnmatched ─────────────────────────────────────
    describe('handleC2BReceiptUnmatched', () => {
        const event = {
            transactionId: 'tx-1',
            saccoId: 'sacco-1',
            amount: 500,
            payerPhone: '254712345678',
            billRefNumber: 'ABCD1234',
            mpesaReceiptNumber: 'RKT1TEST001',
            transactionTime: new Date(),
        };

        it('hands the receipt to BookingService to settle a pending booking', async () => {
            bookingService.settleFromC2BReceipt!.mockResolvedValue({ id: 'booking-1' });

            await listener.handleC2BReceiptUnmatched(event);

            expect(bookingService.settleFromC2BReceipt).toHaveBeenCalledWith(event);
        });

        it('never throws — the webhook that fired it must still return 200', async () => {
            bookingService.settleFromC2BReceipt!.mockRejectedValue(new Error('boom'));
            const errorSpy = jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);

            await expect(listener.handleC2BReceiptUnmatched(event)).resolves.toBeUndefined();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'), expect.anything());
        });
    });
});
