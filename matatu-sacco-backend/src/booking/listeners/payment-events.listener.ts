// src/booking/listeners/payment-events.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingService } from '../booking.service';
import {
    C2B_RECEIPT_UNMATCHED_EVENT,
    type C2BReceiptUnmatchedEvent,
    type PaymentSucceededEvent,
    type PaymentFailedEvent,
} from '../../payment/payment.service';
import { PaymentReferenceType } from '../../payment/entities/payment.entity';

@Injectable()
export class PaymentEventsListener {
    private readonly logger = new Logger(PaymentEventsListener.name);

    constructor(private readonly bookingService: BookingService) { }

    @OnEvent('payment.succeeded')
    async handlePaymentSucceeded(event: PaymentSucceededEvent) {
        if (event.referenceType !== PaymentReferenceType.BOOKING) return;
        await this.bookingService.confirmPayment(event.referenceId, {
            mpesaReceiptNumber: event.mpesaReceiptNumber,
        });
    }

    @OnEvent('payment.failed')
    async handlePaymentFailed(event: PaymentFailedEvent) {
        if (event.referenceType !== PaymentReferenceType.BOOKING) return;
        await this.bookingService.markPaymentFailed(event.referenceId);
    }

    // A paybill receipt no payment row claimed: the passenger paid by hand.
    // Fired from inside the Safaricom webhook handler, which must always
    // return 200 quickly — so this never throws, it logs.
    @OnEvent(C2B_RECEIPT_UNMATCHED_EVENT)
    async handleC2BReceiptUnmatched(event: C2BReceiptUnmatchedEvent) {
        try {
            await this.bookingService.settleFromC2BReceipt(event);
        } catch (err: any) {
            this.logger.error(
                `Auto-settling C2B receipt ${event.mpesaReceiptNumber} failed; it stays unmatched: ${err.message}`,
                err.stack,
            );
        }
    }
}
