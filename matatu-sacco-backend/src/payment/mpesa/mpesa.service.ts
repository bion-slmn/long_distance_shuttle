// src/payment/mpesa/mpesa.service.ts
import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import { SaccoSettingsService } from '../../sacco/sacco-settings.service';
import { InitiateStkPushDto } from '../dto/initiate-stk-push.dto';
import { MpesaCallbackDto } from '../dto/mpesa-callback.dto';
import { REDIS_CLIENT } from 'src/redis/redis.module';

interface StkPushResult {
    merchantRequestId: string;
    checkoutRequestId: string;
    responseDescription: string;
}

interface ParsedCallback {
    checkoutRequestId: string;
    resultCode: number;
    resultDesc: string;
    success: boolean;
    amount?: number;
    mpesaReceiptNumber?: string;
    transactionDate?: string;
    payerPhone?: string;
}

const DARAJA_BASE_URL = process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

@Injectable()
export class MpesaService {
    private readonly logger = new Logger(MpesaService.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly saccoSettingsService: SaccoSettingsService,
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
    ) { }

    // ── OAuth token, cached per sacco (tokens are ~1hr valid) ─────────────
    private async getAccessToken(saccoId: string, consumerKey: string, consumerSecret: string): Promise<string> {
        const cacheKey = `mpesa:token:${saccoId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;

        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

        const { data } = await firstValueFrom(
            this.httpService.get(`${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
                headers: { Authorization: `Basic ${auth}` },
            }),
        );

        // Cache for slightly under the actual TTL to avoid using an expired token
        const ttlSeconds = (data.expires_in ?? 3600) - 60;
        await this.redis.set(cacheKey, data.access_token, 'EX', ttlSeconds);

        return data.access_token;
    }

    // ── Build the STK password: Base64(Shortcode + Passkey + Timestamp) ───
    private buildStkPassword(shortcode: string, passkey: string, timestamp: string): string {
        return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    }

    private timestamp(): string {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return (
            now.getFullYear().toString() +
            pad(now.getMonth() + 1) +
            pad(now.getDate()) +
            pad(now.getHours()) +
            pad(now.getMinutes()) +
            pad(now.getSeconds())
        );
    }

    // Daraja wants 2547XXXXXXXX / 2541XXXXXXXX, not 07XX or +254
    private normalizePhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('254')) return digits;
        if (digits.startsWith('0')) return `254${digits.slice(1)}`;
        throw new BadRequestException(`Unrecognized phone format: ${phone}`);
    }

    // ── Initiate STK push for a given sacco + amount + payer ──────────────
    async initiateStkPush(saccoId: string, dto: InitiateStkPushDto): Promise<StkPushResult> {
        const creds = await this.saccoSettingsService.getDecryptedMpesaCredentials(saccoId);
        const token = await this.getAccessToken(saccoId, creds.consumerKey, creds.consumerSecret);

        const timestamp = this.timestamp();
        const password = this.buildStkPassword(creds.shortcode, creds.passkey, timestamp);
        const phone = this.normalizePhone(dto.payerPhone);

        const payload = {
            BusinessShortCode: creds.shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Math.round(dto.amount),
            PartyA: phone,
            PartyB: creds.shortcode,
            PhoneNumber: phone,
            CallBackURL: `${process.env.MPESA_CALLBACK_BASE_URL}/payment/mpesa/callback`,
            AccountReference: dto.accountReference, // e.g. booking short ref, shown on prompt
            TransactionDesc: dto.description ?? 'Shuttle seat booking',
        };

        try {
            const { data } = await firstValueFrom(
                this.httpService.post(`${DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            this.logger.log(
                `STK push sent for sacco ${saccoId}, checkoutRequestId=${data.CheckoutRequestID}`,
            );

            return {
                merchantRequestId: data.MerchantRequestID,
                checkoutRequestId: data.CheckoutRequestID,
                responseDescription: data.ResponseDescription,
            };
        } catch (err: any) {
            this.logger.error(
                `STK push failed for sacco ${saccoId}: ${err?.response?.data?.errorMessage ?? err.message}`,
            );
            throw new BadRequestException('Failed to initiate M-Pesa payment. Please try again.');
        }
    }


    async queryStkStatus(
        saccoId: string,
        checkoutRequestId: string,
    ): Promise<{ resultCode: number; resultDesc: string }> {
        const creds = await this.saccoSettingsService.getDecryptedMpesaCredentials(saccoId);
        const token = await this.getAccessToken(saccoId, creds.consumerKey, creds.consumerSecret);

        const timestamp = this.timestamp();
        const password = this.buildStkPassword(creds.shortcode, creds.passkey, timestamp);

        const { data } = await firstValueFrom(
            this.httpService.post(
                `${DARAJA_BASE_URL}/mpesa/stkpushquery/v1/query`,
                {
                    BusinessShortCode: creds.shortcode,
                    Password: password,
                    Timestamp: timestamp,
                    CheckoutRequestID: checkoutRequestId,
                },
                { headers: { Authorization: `Bearer ${token}` } },
            ),
        );

        return {
            resultCode: Number(data.ResultCode),
            resultDesc: data.ResultDesc,
        };
    }

    // ── Parse Safaricom's callback payload into a flat, usable shape ──────
    parseCallback(body: MpesaCallbackDto): ParsedCallback {
        const stkCallback = body.Body.stkCallback;
        const resultCode = stkCallback.ResultCode;
        const success = resultCode === 0;

        const base: ParsedCallback = {
            checkoutRequestId: stkCallback.CheckoutRequestID,
            resultCode,
            resultDesc: stkCallback.ResultDesc,
            success,
        };

        if (!success) return base;

        // On success, the actual values are buried in a name/value array
        const items = stkCallback.CallbackMetadata?.Item ?? [];
        const getValue = (name: string) => items.find((i) => i.Name === name)?.Value;

        return {
            ...base,
            amount: getValue('Amount') as number,
            mpesaReceiptNumber: getValue('MpesaReceiptNumber') as string,
            transactionDate: String(getValue('TransactionDate')),
            payerPhone: String(getValue('PhoneNumber')),
        };
    }
}