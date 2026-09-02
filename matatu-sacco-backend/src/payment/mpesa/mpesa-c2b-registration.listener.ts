// src/payment/mpesa/mpesa-c2b-registration.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MpesaService } from './mpesa.service';
import {
    SACCO_MPESA_CONFIGURED_EVENT,
    type SaccoMpesaConfiguredEvent,
} from '../../sacco/sacco-settings.service';

// Registers a sacco's C2B (direct paybill) callback URLs with Daraja as soon
// as its M-Pesa credentials are saved, so "pay the paybill directly" works
// without an admin remembering a separate setup step.
//
// Never throws: SaccoSettingsService awaits this via emitAsync, and a Daraja
// outage must not turn a successful credential save into an error. The
// outcome is persisted on the settings row by registerC2BUrls() itself
// (mpesaC2bRegisteredAt / mpesaC2bRegistrationError), and an admin can retry
// through POST /payment/mpesa/:saccoId/c2b/register.
@Injectable()
export class MpesaC2bRegistrationListener {
    private readonly logger = new Logger(MpesaC2bRegistrationListener.name);

    constructor(private readonly mpesaService: MpesaService) { }

    @OnEvent(SACCO_MPESA_CONFIGURED_EVENT)
    async handleMpesaConfigured(event: SaccoMpesaConfiguredEvent): Promise<void> {
        try {
            await this.mpesaService.registerC2BUrls(event.saccoId);
        } catch (err: any) {
            this.logger.warn(
                `Automatic C2B URL registration failed for sacco ${event.saccoId} (shortcode ${event.shortcode}); ` +
                `credentials are saved, retry via the register endpoint: ${err?.message ?? err}`,
            );
        }
    }
}
