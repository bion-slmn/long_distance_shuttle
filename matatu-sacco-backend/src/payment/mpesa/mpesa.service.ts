// src/payment/mpesa/mpesa.service.ts
import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';
import Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import { SaccoSettingsService } from '../../sacco/sacco-settings.service';
import { InitiateStkPushDto } from '../dto/initiate-stk-push.dto';
import { MpesaCallbackDto } from '../dto/mpesa-callback.dto';
import { REDIS_CLIENT } from 'src/redis/redis.module';
import { MpesaTransaction, MpesaTransactionMatchStatus, MpesaTransactionSource } from '../entities/mpesa.entity';


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

// Safaricom's C2B confirmation payload (paybill hit directly, no STK prompt).
// Shape per Daraja docs — adjust field names if your controller already
// has a typed DTO for this.
interface MpesaC2BConfirmationDto {
    TransactionType: string;
    TransID: string;
    TransTime: string; // yyyyMMddHHmmss
    TransAmount: string;
    BusinessShortCode: string;
    BillRefNumber: string;
    MSISDN: string;
    FirstName?: string;
    MiddleName?: string;
    LastName?: string;
}

const DARAJA_BASE_URL = process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// Postgres unique_violation code
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class MpesaService {
    private readonly logger = new Logger(MpesaService.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly saccoSettingsService: SaccoSettingsService,
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        @InjectRepository(MpesaTransaction)
        private readonly mpesaTransactionRepo: Repository<MpesaTransaction>,
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

    // Parses e.g. "20240115T121530"-less Daraja timestamps: "20240115121530"
    private parseDarajaTimestamp(raw: string): Date {
        const s = String(raw);
        const year = s.slice(0, 4);
        const month = s.slice(4, 6);
        const day = s.slice(6, 8);
        const hour = s.slice(8, 10);
        const min = s.slice(10, 12);
        const sec = s.slice(12, 14);
        // Daraja timestamps are in East Africa Time (UTC+3), no offset given
        return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}+03:00`);
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

    // ── Handle the STK callback end-to-end: parse + persist ───────────────
    // Call this from your callback controller instead of parseCallback()
    // directly if you want every successful push stored automatically.
    async handleStkCallback(body: MpesaCallbackDto): Promise<ParsedCallback> {
        const parsed = this.parseCallback(body);

        if (!parsed.success) {
            this.logger.warn(
                `STK callback failed, not persisted (no receipt number): checkoutRequestId=${parsed.checkoutRequestId}, resultDesc=${parsed.resultDesc}`,
            );
            return parsed;
        }

        await this.storeTransaction({
            source: MpesaTransactionSource.STK_PUSH,
            mpesaReceiptNumber: parsed.mpesaReceiptNumber!,
            checkoutRequestId: parsed.checkoutRequestId,
            amount: parsed.amount!,
            payerPhone: parsed.payerPhone!,
            payerName: undefined,
            billRefNumber: undefined,
            businessShortCode: undefined,
            transactionTime: parsed.transactionDate
                ? this.parseDarajaTimestamp(parsed.transactionDate)
                : new Date(),
            rawPayload: body as unknown as Record<string, any>,
        });

        return parsed;
    }

    // ── Handle a C2B confirmation: customer paid the paybill directly ─────
    // Wire this to your Daraja ConfirmationURL controller route.
    async handleC2BConfirmation(body: MpesaC2BConfirmationDto): Promise<void> {
        await this.storeTransaction({
            source: MpesaTransactionSource.C2B,
            mpesaReceiptNumber: body.TransID,
            checkoutRequestId: undefined,
            amount: Number(body.TransAmount),
            payerPhone: body.MSISDN,
            payerName: [body.FirstName, body.MiddleName, body.LastName]
                .filter(Boolean)
                .join(' ') || undefined,
            billRefNumber: body.BillRefNumber,
            businessShortCode: body.BusinessShortCode,
            transactionTime: this.parseDarajaTimestamp(body.TransTime),
            rawPayload: body as unknown as Record<string, any>,
        });
    }

    // ── Shared persistence with idempotency against Safaricom retries ─────
    private async storeTransaction(data: {
        source: MpesaTransactionSource;
        mpesaReceiptNumber: string;
        checkoutRequestId?: string;
        amount: number;
        payerPhone: string;
        payerName?: string;
        billRefNumber?: string;
        businessShortCode?: string;
        transactionTime: Date;
        rawPayload: Record<string, any>;
    }): Promise<MpesaTransaction | null> {
        try {
            const record = this.mpesaTransactionRepo.create(data);
            const saved = await this.mpesaTransactionRepo.save(record);
            this.logger.log(
                `Stored ${data.source} transaction ${data.mpesaReceiptNumber} (${data.amount})`,
            );
            return saved;
        } catch (err: any) {
            if (err?.code === PG_UNIQUE_VIOLATION) {
                // Safaricom resent a callback/confirmation we've already stored — no-op.
                this.logger.warn(
                    `Duplicate M-Pesa receipt ${data.mpesaReceiptNumber}, ignoring resend.`,
                );
                return null;
            }
            this.logger.error(
                `Failed to persist M-Pesa transaction ${data.mpesaReceiptNumber}: ${err.message}`,
            );
            throw err;
        }
    }

    // ── Lookups ─────────────────────────────────────────────────────────

    // Matches on the last 9 digits since STK and C2B don't always report
    // the phone in the same format (masked vs unmasked, 254 vs not).
    async getTransactionsByPhone(
        phone: string,
        dateFrom?: Date,
        dateTo?: Date,
    ): Promise<MpesaTransaction[]> {
        const normalized = this.normalizePhone(phone);
        const suffix = normalized.slice(-9);

        const qb = this.mpesaTransactionRepo
            .createQueryBuilder('t')
            .where('t.payerPhone LIKE :suffix', { suffix: `%${suffix}` });

        if (dateFrom) {
            qb.andWhere('t.transactionTime >= :dateFrom', { dateFrom });
        }
        if (dateTo) {
            qb.andWhere('t.transactionTime <= :dateTo', { dateTo });
        }

        return qb.orderBy('t.transactionTime', 'DESC').getMany();
    }

    // ── Mark a transaction as matched to a booking/payment ────────────────
    async matchTransaction(
        transactionId: string,
        matchedBookingId: string,
        matchedPaymentId: string,
        matchedBy: string,
    ): Promise<MpesaTransaction> {
        const result = await this.mpesaTransactionRepo.update(
            { id: transactionId, matchStatus: MpesaTransactionMatchStatus.UNMATCHED },
            {
                matchStatus: MpesaTransactionMatchStatus.MATCHED,
                matchedBookingId,
                matchedPaymentId,
                matchedBy,
                matchedAt: new Date(),
            },
        );

        if (result.affected === 0) {
            throw new BadRequestException(
                `Transaction ${transactionId} not found or already matched.`,
            );
        }

        return this.mpesaTransactionRepo.findOneByOrFail({ id: transactionId });
    }

    // Straight date-range filter, independent of phone.
    async getTransactionsByDateRange(
        dateFrom: Date,
        dateTo: Date,
    ): Promise<MpesaTransaction[]> {
        return this.mpesaTransactionRepo.find({
            where: { transactionTime: Between(dateFrom, dateTo) },
            order: { transactionTime: 'DESC' },
        });
    }
}