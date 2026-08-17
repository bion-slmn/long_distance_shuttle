// src/booking/listeners/payment-events.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingService } from '../booking.service';
import type { PaymentSucceededEvent, PaymentFailedEvent } from '../../payment/payment.service';
import { PaymentReferenceType } from '../../payment/entities/payment.entity';

@Injectable()
export class PaymentEventsListener {
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
}