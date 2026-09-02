// src/sacco/sacco-settings.service.ts
import { ConflictException, Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityManager, In, Repository } from 'typeorm';
import { SaccoSettings } from './entities/sacco-settings.entity';
import { ConfigureMpesaDto } from './dto/configure-mpesa.dto';
import { decrypt, encrypt } from 'src/common/utils/crypto.util';
import { UpdateSaccoSettingsDto } from './dto/update-sacco-settings.dto';


// ─── Service ──────────────────────────────────────────────────────────────
// Manages per-sacco operational settings (commission, booking toggles,
// pre-booking limits) and M-Pesa Daraja credentials. Secrets are encrypted
// at rest and are never included in normal reads — only decrypted
// internally when actually needed to call Daraja (see
// getDecryptedMpesaCredentials).
//
// Pre-booking limits (preBookingEnabled, preBookingMorningStart/End,
// preBookingMaxMorningVehicles, preBookingMaxSeatsPerTrip) are fixed MVP
// defaults for now — set once in createDefaults() and NOT editable via
// update(). They'll become editable in a later iteration once there's a
// real settings UI for them; until then, update() intentionally ignores
// these fields even if a caller sends them.

// The rate a sacco starts on before anyone edits it. Stored as a percentage
// (10 = 10%), matching the column's own default, and used as the fallback
// whenever a sacco somehow has no settings row — better a visible default
// than silently reporting zero commission.
export const DEFAULT_COMMISSION_RATE = 10;

// Postgres unique_violation code
const PG_UNIQUE_VIOLATION = '23505';

// Emitted (and awaited, via emitAsync) right after a sacco's M-Pesa
// credentials are saved. PaymentModule listens and registers the sacco's
// C2B callback URLs with Daraja — an event rather than a direct call so
// SaccoModule never has to import PaymentModule (which imports SaccoModule).
export const SACCO_MPESA_CONFIGURED_EVENT = 'sacco.mpesa.configured';
export interface SaccoMpesaConfiguredEvent {
    saccoId: string;
    shortcode: string;
}

export interface PaymentOptions {
    saccoId: string;
    acceptsCash: boolean;
    acceptsMpesa: boolean;
    mpesaConfigured: boolean;
    /** Only ever the public shortcode — never any credential. */
    mpesaShortcode: string | null;
}

@Injectable()
export class SaccoSettingsService {
    private readonly logger = new Logger(SaccoSettingsService.name);

    constructor(
        @InjectRepository(SaccoSettings)
        private readonly settingsRepository: Repository<SaccoSettings>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    // ── Create default settings for a brand-new sacco ──────────────────────
    // Called from SaccoService.create() right after a Sacco is saved, so
    // every sacco always has exactly one settings row from day one.
    async createDefaults(saccoId: string, manager?: EntityManager): Promise<SaccoSettings> {
        const repo = manager ? manager.getRepository(SaccoSettings) : this.settingsRepository;

        const settings = repo.create({
            saccoId,
            commissionRate: DEFAULT_COMMISSION_RATE,
            isAcceptingBookings: true,
            acceptsMpesa: false, // stays false until configureMpesa() succeeds
            acceptsCash: true,
            mpesaConfigured: false,
            // ── Pre-booking limits — fixed MVP defaults, not editable yet ──
            preBookingEnabled: true,
            preBookingMorningStart: '05:00:00',
            preBookingMorningEnd: '10:00:00',
            preBookingMaxMorningVehicles: 4,
            preBookingMaxSeatsPerTrip: 4,
        });

        const saved = await repo.save(settings);
        this.logger.log(`Default settings created for sacco ${saccoId}`);
        return saved;
    }

    // ── Fetch settings (safe — secrets excluded by @Column select:false) ───
    async findOne(saccoId: string): Promise<SaccoSettings> {
        const settings = await this.settingsRepository.findOne({ where: { saccoId } });
        if (!settings) {
            throw new NotFoundException(`Settings for sacco "${saccoId}" not found.`);
        }
        return settings;
    }

    // ── Payment options — the clerk-facing slice of settings ──────────────
    // The booking sheet has to know which payment pills to offer, but a clerk
    // has no business reading commission rates or pre-booking limits. This
    // returns only what the sheet needs, so the read can be opened up to
    // CLERK without widening access to the whole settings row.
    //
    // acceptsMpesa and mpesaConfigured are reported separately: a sacco that
    // has switched M-Pesa off still has credentials on file, and only the
    // combination of the two means "an STK push will actually work".
    async getPaymentOptions(saccoId: string): Promise<PaymentOptions> {
        const settings = await this.findOne(saccoId);
        return {
            saccoId: settings.saccoId,
            acceptsCash: settings.acceptsCash,
            acceptsMpesa: settings.acceptsMpesa,
            mpesaConfigured: settings.mpesaConfigured,
            mpesaShortcode: settings.mpesaShortcode ?? null,
        };
    }

    // commissionRate is a PERCENTAGE in a numeric(5,2) column, and pg hands
    // decimals back as strings — `settings.commissionRate * gross` silently
    // produces NaN even though the type says number. Every read of the rate
    // goes through here so no caller has to remember that.
    private toRateFraction(commissionRate: unknown): number {
        const percent = Number(commissionRate);
        return Number.isFinite(percent) ? percent / 100 : DEFAULT_COMMISSION_RATE / 100;
    }

    // ── The one place commission is defined ────────────────────────────────
    // Every earnings figure in the product derives its rate from here, so a
    // sacco that edits its rate sees the same number on the dashboard, in the
    // trend chart and on a trip row — rather than each surface carrying its
    // own constant and quietly disagreeing.

    /** This sacco's commission as a fraction of gross fares (10% → 0.1). */
    async getCommissionRate(saccoId: string): Promise<number> {
        const settings = await this.findOne(saccoId);
        return this.toRateFraction(settings.commissionRate);
    }

    /**
     * Commission fractions for many saccos in one read. Platform-wide totals
     * span saccos that each charge their own rate, so they have to be weighted
     * per sacco — a single blended constant would be wrong for every one of
     * them. Saccos with no settings row fall back to DEFAULT_COMMISSION_RATE.
     */
    async getCommissionRates(saccoIds: string[]): Promise<Map<string, number>> {
        const unique = [...new Set(saccoIds)];
        if (unique.length === 0) return new Map();

        const rows = await this.settingsRepository.find({
            where: { saccoId: In(unique) },
            select: { saccoId: true, commissionRate: true },
        });

        const rates = new Map(rows.map((r) => [r.saccoId, this.toRateFraction(r.commissionRate)]));
        for (const saccoId of unique) {
            if (!rates.has(saccoId)) rates.set(saccoId, DEFAULT_COMMISSION_RATE / 100);
        }
        return rates;
    }

    /**
     * M-Pesa readiness for many saccos in one read — the pilot's adoption
     * question, and the same bulk shape as getCommissionRates so the
     * performance table doesn't issue a settings query per row.
     *
     * A sacco missing a settings row reads as not ready, which is the honest
     * answer: nothing has been configured for it.
     */
    async getMpesaStatuses(
        saccoIds: string[],
    ): Promise<Map<string, { acceptsMpesa: boolean; mpesaConfigured: boolean }>> {
        const unique = [...new Set(saccoIds)];
        if (unique.length === 0) return new Map();

        const rows = await this.settingsRepository.find({
            where: { saccoId: In(unique) },
            select: { saccoId: true, acceptsMpesa: true, mpesaConfigured: true },
        });

        return new Map(
            rows.map((r) => [
                r.saccoId,
                { acceptsMpesa: r.acceptsMpesa, mpesaConfigured: r.mpesaConfigured },
            ]),
        );
    }

    // ── Update general operational settings ─────────────────────────────────
    // MVP: only commissionRate, isAcceptingBookings, acceptsCash are
    // editable. Pre-booking limits are intentionally NOT handled here —
    // see the class-level comment above.
    async update(saccoId: string, dto: UpdateSaccoSettingsDto): Promise<SaccoSettings> {
        const settings = await this.findOne(saccoId);

        if (dto.commissionRate !== undefined) {
            if (dto.commissionRate < 0 || dto.commissionRate > 100) {
                throw new BadRequestException('commissionRate must be between 0 and 100.');
            }
            settings.commissionRate = dto.commissionRate;
        }
        if (dto.isAcceptingBookings !== undefined) settings.isAcceptingBookings = dto.isAcceptingBookings;
        if (dto.acceptsCash !== undefined) settings.acceptsCash = dto.acceptsCash;

        const saved = await this.settingsRepository.save(settings);
        this.logger.log(`Settings updated for sacco ${saccoId}`);
        return saved;
    }

    // ── Configure M-Pesa credentials (encrypts before storing) ─────────────
    async configureMpesa(saccoId: string, dto: ConfigureMpesaDto): Promise<SaccoSettings> {
        const settings = await this.findOne(saccoId);

        settings.mpesaShortcode = dto.shortcode.trim();
        settings.mpesaConsumerKey = dto.consumerKey.trim();
        settings.mpesaConsumerSecretEncrypted = encrypt(dto.consumerSecret.trim());
        settings.mpesaPasskeyEncrypted = encrypt(dto.passkey.trim());
        settings.mpesaConfigured = true;
        settings.acceptsMpesa = true;
        // New (or changed) credentials: whatever Daraja knew before no longer
        // applies until the registration below succeeds.
        settings.mpesaC2bRegisteredAt = null;
        settings.mpesaC2bRegistrationError = null;

        try {
            await this.settingsRepository.save(settings);
        } catch (err: any) {
            if (err?.code === PG_UNIQUE_VIOLATION) {
                throw new ConflictException(
                    `Shortcode ${settings.mpesaShortcode} is already configured for another sacco. ` +
                    'A paybill can belong to only one sacco, since incoming payments are attributed by shortcode.',
                );
            }
            throw err;
        }
        this.logger.log(`M-Pesa configured for sacco ${saccoId} (shortcode ${settings.mpesaShortcode})`);

        // Register the C2B (direct paybill) callback URLs with Daraja so money
        // paid straight to the paybill reaches us. Awaited so the response
        // below carries the outcome (mpesaC2bRegisteredAt / ...Error), but the
        // listener never throws: a Daraja outage must not un-save credentials.
        const event: SaccoMpesaConfiguredEvent = { saccoId, shortcode: settings.mpesaShortcode };
        await this.eventEmitter.emitAsync(SACCO_MPESA_CONFIGURED_EVENT, event);

        // Return without secrets — caller never needs them back after saving.
        return this.findOne(saccoId);
    }

    // ── Which sacco owns a paybill/till? ────────────────────────────────────
    // The only sacco-identifying field on a C2B confirmation is
    // BusinessShortCode, so this is how paybill money gets attributed. Null
    // means no configured sacco has this shortcode.
    async findSaccoIdByShortcode(shortcode: string | undefined | null): Promise<string | null> {
        const trimmed = (shortcode ?? '').trim();
        if (!trimmed) return null;

        const settings = await this.settingsRepository.findOne({
            where: { mpesaShortcode: trimmed, mpesaConfigured: true },
            select: { saccoId: true },
        });
        return settings?.saccoId ?? null;
    }

    // ── Record the outcome of a C2B URL registration attempt ───────────────
    // Called by MpesaService.registerC2BUrls() on both success and failure so
    // the settings row always says whether Daraja currently knows where to
    // POST this shortcode's confirmations.
    async recordC2bRegistration(saccoId: string, error: string | null): Promise<void> {
        await this.settingsRepository.update(
            { saccoId },
            error === null
                ? { mpesaC2bRegisteredAt: new Date(), mpesaC2bRegistrationError: null }
                : { mpesaC2bRegisteredAt: null, mpesaC2bRegistrationError: error },
        );
    }

    // ── Disable M-Pesa (e.g. sacco wants to pause it, or credentials rotated out) ──
    async disableMpesa(saccoId: string): Promise<SaccoSettings> {
        const settings = await this.findOne(saccoId);
        settings.acceptsMpesa = false;
        const saved = await this.settingsRepository.save(settings);
        this.logger.log(`M-Pesa disabled for sacco ${saccoId}`);
        return saved;
    }

    // ── Internal-only: fetch and decrypt credentials for an actual Daraja call ──
    // Never expose this data via a controller response. Only MpesaService
    // (or equivalent payment-integration code) should call this.
    async getDecryptedMpesaCredentials(saccoId: string): Promise<{
        shortcode: string;
        consumerKey: string;
        consumerSecret: string;
        passkey: string;
    }> {
        const settings = await this.settingsRepository
            .createQueryBuilder('s')
            .addSelect([
                's.mpesaConsumerKey',
                's.mpesaConsumerSecretEncrypted',
                's.mpesaPasskeyEncrypted',
            ])
            .where('s.saccoId = :saccoId', { saccoId })
            .getOne();

        if (!settings || !settings.mpesaConfigured) {
            throw new NotFoundException(`M-Pesa is not configured for sacco "${saccoId}".`);
        }

        return {
            shortcode: settings.mpesaShortcode,
            consumerKey: settings.mpesaConsumerKey,
            consumerSecret: decrypt(settings.mpesaConsumerSecretEncrypted),
            passkey: decrypt(settings.mpesaPasskeyEncrypted),
        };
    }
}