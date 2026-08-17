// src/payment/mpesa/mpesa.controller.ts
import {
    Body,
    Controller,
    HttpCode,
    Logger,
    Param,
    Post,
} from '@nestjs/common';
import { MpesaService } from './mpesa.service';
import { InitiateStkPushDto } from '../dto/initiate-stk-push.dto';
import { MpesaCallbackDto } from '../dto/mpesa-callback.dto';
import { Public } from 'src/decorators/public.decorator';
import { PaymentService } from '../payment.service';

// ─── Controller ─────────────────────────────────────────────────────────
// Two very different endpoints living here:
//  - POST /payment/mpesa/stk-push/:saccoId  → called by our own frontend,
//    protected, validated via InitiateStkPushDto.
//  - POST /payment/mpesa/callback           → called by Safaricom, public,
//    unauthenticated, must always return 200 quickly or Daraja retries.

@Controller('payment/mpesa')
export class MpesaController {
    private readonly logger = new Logger(MpesaController.name);

    constructor(
        private readonly mpesaService: MpesaService,
        private readonly paymentService: PaymentService,
    ) { }


    // ── Safaricom's async callback ──────────────────────────────────────
    // Public, unauthenticated (Safaricom doesn't sign these). Must always
    // return 200 with ResultCode 0 quickly, or Daraja will retry the callback.
    // Never throw here — log and swallow instead.
    @Public()
    @Post('callback')
    @HttpCode(200)
    async handleCallback(@Body() body: MpesaCallbackDto) {
        try {
            const parsed = this.mpesaService.parseCallback(body);

            this.logger.log(
                `Callback received: checkoutRequestId=${parsed.checkoutRequestId} success=${parsed.success} resultCode=${parsed.resultCode}`,
            );

            await this.paymentService.handleMpesaCallback(parsed, body);
        } catch (err: any) {
            // Never let this bubble into a non-200 response — Safaricom will just
            // retry the same callback repeatedly if we do. Log loudly instead.
            this.logger.error(`Failed to process M-Pesa callback: ${err.message}`, err.stack);
        }

        // Daraja expects this exact shape acknowledging receipt.
        return { ResultCode: 0, ResultDesc: 'Accepted' };
    }
}