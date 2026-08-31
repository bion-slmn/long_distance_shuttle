// src/payment/mpesa/mpesa.service.ts
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { LRUCache } from 'lru-cache';
import { firstValueFrom } from 'rxjs';
import { SaccoSettingsService } from '../../sacco/sacco-settings.service';
import { InitiateStkPushDto } from '../dto/initiate-stk-push.dto';
import { MpesaCallbackDto } from '../dto/mpesa-callback.dto';
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

    // ── Resilience tuning ──────────────────────────────────────────────
    // 30s covers realistic Daraja slowness without hanging a request handler
    // indefinitely (Axios' own default timeout is 0 — no timeout at all).
    private readonly HTTP_TIMEOUT_MS = 20_000;
    // One retry beyond the initial attempt. This is for transient
    // network/Daraja-side blips only — NOT a substitute for the
    // caller-side idempotency key that should guard against a clerk's
    // device double-submitting a booking. Keeping this low and bounded
    // avoids compounding retries if the caller also retries.
    private readonly MAX_RETRIES = 1;

    // ── Daraja OAuth token cache, per sacco ───────────────────────────────
    // In-process rather than Redis. A token is cheap, idempotent to re-fetch,
    // and re-derivable from credentials we already hold — so a shared cache
    // buys only a handful of avoided HTTP calls per hour, while a network
    // round trip on the critical path of every STK push can (and did) hang
    // payments when the cache store is unreachable. Losing this cache costs
    // one extra Daraja call; it can never cost a payment.
    //
    // `max` is a safety net, not a working constraint: entries are keyed by
    // saccoId and are a few dozen bytes each, so eviction will never fire in
    // practice. TTL is what actually governs the entry, and it comes from
    // Daraja's own expires_in.
    private readonly TOKEN_CACHE_MAX = 500;
    private readonly tokenCache = new LRUCache<string, string>({
        max: this.TOKEN_CACHE_MAX,
    });

    constructor(
        private readonly httpService: HttpService,
        private readonly saccoSettingsService: SaccoSettingsService,
        @InjectRepository(MpesaTransaction)
        private readonly mpesaTransactionRepo: Repository<MpesaTransaction>,
    ) { }

    // Drop a sacco's cached token so the next call fetches a fresh one.
    //
    // Called whenever a token-bearing Daraja call fails. We can't reliably
    // tell "your token is stale" apart from "Daraja had a bad minute" —
    // Daraja reports auth problems inconsistently across its endpoints — so
    // this errs toward discarding. The cost of being wrong is one extra
    // OAuth round trip on the next attempt; the cost of keeping a bad token
    // is every subsequent call failing the same way until the TTL runs out.
    private invalidateToken(saccoId: string): void {
        if (this.tokenCache.delete(saccoId)) {
            this.logger.warn(`Discarded cached M-Pesa token for sacco ${saccoId} after a failed call`);
        }
    }

    // ── Shared retry wrapper for outbound Daraja calls ────────────────────
    // Only retries errors that look transient (timeout, connection reset,
    // 502/503/504) — never retries on a 4xx or a Daraja-level business
    // rejection, since retrying those just repeats the same failure.
    private isRetryable(err: any): boolean {
        const code = err?.code;
        const status = err?.response?.status;
        return (
            code === 'ECONNABORTED' ||
            code === 'ECONNRESET' ||
            code === 'ETIMEDOUT' ||
            status === 502 ||
            status === 503 ||
            status === 504
        );
    }

    private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
        let lastErr: any;
        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await fn();
            } catch (err: any) {
                lastErr = err;
                if (attempt < this.MAX_RETRIES && this.isRetryable(err)) {
                    const delayMs = 1000 * (attempt + 1);
                    this.logger.warn(
                        `${label} failed (attempt ${attempt + 1}/${this.MAX_RETRIES + 1}), retrying in ${delayMs}ms: ${err.message}`,
                    );
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    continue;
                }
                throw lastErr;
            }
        }
        throw lastErr;
    }

    // ── OAuth token, cached per sacco (tokens are ~1hr valid) ─────────────
    private async getAccessToken(saccoId: string, consumerKey: string, consumerSecret: string): Promise<string> {
        const cached = this.tokenCache.get(saccoId);
        if (cached) return cached;

        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

        const { data } = await this.withRetry('getAccessToken', () =>
            firstValueFrom(
                this.httpService.get(`${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
                    headers: { Authorization: `Basic ${auth}` },
                    timeout: this.HTTP_TIMEOUT_MS,
                }),
            ),
        );

        // Expire slightly early so we never present a token Daraja has already
        // retired. Floored at 60s: a pathologically short expires_in must not
        // produce a zero or negative ttl, which lru-cache reads as "no expiry
        // at all" — the exact opposite of what a short-lived token wants.
        const ttlSeconds = Math.max(60, (data.expires_in ?? 3600) - 60);
        this.tokenCache.set(saccoId, data.access_token, { ttl: ttlSeconds * 1000 });

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
            const { data } = await this.withRetry('initiateStkPush', () =>
                firstValueFrom(
                    this.httpService.post(`${DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: this.HTTP_TIMEOUT_MS,
                    }),
                ),
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
            this.invalidateToken(saccoId);
            this.logger.error(
                `STK push failed for sacco ${saccoId}: ${err?.response?.data?.errorMessage ?? err.message}`,
            );
            throw new BadRequestException('Failed to initiate M-Pesa payment. Please try again.');
        }
    }

    // ── Query Daraja directly for a checkout's current status ─────────────
    // This is the reconcile/backstop path — the one meant to run when the
    // network was already unreliable, so it can't be allowed to throw an
    // unhandled Axios error. ServiceUnavailableException (503) rather than
    // BadRequestException (400) here: a query failure means "we couldn't
    // find out," not "the request was invalid" — callers (e.g. the
    // reconcile endpoint) should treat the two differently, since a 503
    // means "try again shortly," not "this will never succeed."
    //
    // Returns resultCode: null when Daraja gave us no usable ResultCode —
    // most commonly its "still in flight" answer, which it returns as a
    // *200* carrying { errorCode: '500.001.1001', errorMessage: 'The
    // transaction is being processed' } and no ResultCode field at all.
    // null means "we still don't know", never "it failed".
    async queryStkStatus(
        saccoId: string,
        checkoutRequestId: string,
    ): Promise<{ resultCode: number | null; resultDesc: string; errorCode: string | null }> {
        try {
            const creds = await this.saccoSettingsService.getDecryptedMpesaCredentials(saccoId);
            const token = await this.getAccessToken(saccoId, creds.consumerKey, creds.consumerSecret);

            const timestamp = this.timestamp();
            const password = this.buildStkPassword(creds.shortcode, creds.passkey, timestamp);

            const { data } = await this.withRetry('queryStkStatus', () =>
                firstValueFrom(
                    this.httpService.post(
                        `${DARAJA_BASE_URL}/mpesa/stkpushquery/v1/query`,
                        {
                            BusinessShortCode: creds.shortcode,
                            Password: password,
                            Timestamp: timestamp,
                            CheckoutRequestID: checkoutRequestId,
                        },
                        {
                            headers: { Authorization: `Bearer ${token}` },
                            timeout: this.HTTP_TIMEOUT_MS,
                        },
                    ),
                ),
            );

            // Daraja is inconsistent here: a pending/errored query can come
            // back 200 with only errorCode/errorMessage. Number(undefined) is
            // NaN, and NaN compares false against every known code — so guard
            // explicitly instead of letting it fall through as "not success".
            const rawResultCode = data.ResultCode;
            const parsed = rawResultCode === undefined || rawResultCode === null
                ? NaN
                : Number(rawResultCode);

            return {
                resultCode: Number.isNaN(parsed) ? null : parsed,
                resultDesc: data.ResultDesc ?? data.errorMessage ?? '',
                errorCode: data.errorCode ?? null,
            };
        } catch (err: any) {
            this.invalidateToken(saccoId);
            this.logger.error(
                `STK status query failed for checkoutRequestId=${checkoutRequestId}: ${err?.response?.data?.errorMessage ?? err.message}`,
            );
            throw new ServiceUnavailableException(
                'Could not reach M-Pesa to check payment status. Please try again shortly.',
            );
        }
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
    //
    // NOTE: this only dedupes at the storage layer (unique mpesaReceiptNumber
    // in storeTransaction below). It does NOT stop a resent callback from
    // being handed to PaymentService.handleMpesaCallback again — that method
    // needs its own guard (a conditional UPDATE ... WHERE status IN (PENDING,
    // PROCESSING)) so a duplicate delivery is a no-op rather than re-running
    // side effects like receipt generation or seat confirmation.
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

    // ── Look up a stored transaction by its STK checkout id ───────────────
    // The status QUERY api never returns a receipt number, so this is how a
    // reconcile-confirmed success gets one: the C2B confirmation arrives on a
    // different Safaricom endpoint and often lands even when the STK callback
    // is lost, leaving the receipt sitting here.
    async findTransactionByCheckoutRequestId(
        checkoutRequestId: string,
    ): Promise<MpesaTransaction | null> {
        return this.mpesaTransactionRepo.findOne({
            where: { checkoutRequestId },
            order: { transactionTime: 'DESC' },
        });
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

    // ── Register C2B validation/confirmation URLs for a sacco's shortcode ──
    // One-time setup call per shortcode — not hit on every payment. Run it
    // once after a sacco's M-Pesa credentials are configured, or on demand
    // from an admin action.
    async registerC2BUrls(saccoId: string): Promise<{ responseDescription: string }> {
        const creds = await this.saccoSettingsService.getDecryptedMpesaCredentials(saccoId);
        const token = await this.getAccessToken(saccoId, creds.consumerKey, creds.consumerSecret);

        const payload = {
            ShortCode: creds.shortcode,
            ResponseType: 'Completed',
            ConfirmationURL: `${process.env.MPESA_CALLBACK_BASE_URL}/payment/c2b/confirmation`,
            ValidationURL: `${process.env.MPESA_CALLBACK_BASE_URL}/payment/c2b/validation`,
        };

        try {
            const { data } = await this.withRetry('registerC2BUrls', () =>
                firstValueFrom(
                    this.httpService.post(`${DARAJA_BASE_URL}/mpesa/c2b/v1/registerurl`, payload, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: this.HTTP_TIMEOUT_MS,
                    }),
                ),
            );

            this.logger.log(`C2B URLs registered for sacco ${saccoId}: ${data.ResponseDescription}`);
            return { responseDescription: data.ResponseDescription };
        } catch (err: any) {
            this.invalidateToken(saccoId);
            this.logger.error(
                `C2B URL registration failed for sacco ${saccoId}: ${err?.response?.data?.errorMessage ?? err.message}`,
            );
            throw new BadRequestException('Failed to register M-Pesa C2B URLs.');
        }
    }
}