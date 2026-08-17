// src/sacco/sacco-settings.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SaccoSettings } from './entities/sacco-settings.entity';
import { ConfigureMpesaDto } from './dto/configure-mpesa.dto';
import { decrypt, encrypt } from 'src/common/utils/crypto.util';
import { UpdateSaccoSettingsDto } from './dto/update-sacco-settings.dto';


// ─── Service ──────────────────────────────────────────────────────────────
// Manages per-sacco operational settings (commission, booking toggles) and
// M-Pesa Daraja credentials. Secrets are encrypted at rest and are never
// included in normal reads — only decrypted internally when actually
// needed to call Daraja (see getDecryptedMpesaCredentials).

@Injectable()
export class SaccoSettingsService {
    private readonly logger = new Logger(SaccoSettingsService.name);

    constructor(
        @InjectRepository(SaccoSettings)
        private readonly settingsRepository: Repository<SaccoSettings>,

    ) { }

    // ── Create default settings for a brand-new sacco ──────────────────────
    // Called from SaccoService.create() right after a Sacco is saved, so
    // every sacco always has exactly one settings row from day one.
    async createDefaults(saccoId: string, manager?: EntityManager): Promise<SaccoSettings> {
        const repo = manager ? manager.getRepository(SaccoSettings) : this.settingsRepository;

        const settings = repo.create({
            saccoId,
            commissionRate: 10,
            isAcceptingBookings: true,
            acceptsMpesa: false, // stays false until configureMpesa() succeeds
            acceptsCash: true,
            mpesaConfigured: false,
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

    // ── Update general operational settings ─────────────────────────────────
    async update(saccoId: string, dto: UpdateSaccoSettingsDto): Promise<SaccoSettings> {
        const settings = await this.findOne(saccoId);

        if (dto.commissionRate !== undefined) settings.commissionRate = dto.commissionRate;
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

        const saved = await this.settingsRepository.save(settings);
        this.logger.log(`M-Pesa configured for sacco ${saccoId} (shortcode ${settings.mpesaShortcode})`);

        // Return without secrets — caller never needs them back after saving.
        return this.findOne(saccoId);
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