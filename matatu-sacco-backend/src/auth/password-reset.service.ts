// src/auth/password-reset.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../redis/redis.module';

// An invite is the very first thing a new staff member gets, so it has to
// survive a weekend of nobody checking their inbox. A reset is something the
// user just asked for, so it can be short-lived.
export const INVITE_TTL_SECONDS = 72 * 60 * 60; // 3 days
export const RESET_TTL_SECONDS = 60 * 60; // 1 hour

// Throttles /auth/forgot-password so the endpoint can't be used to spam
// someone's inbox (or burn through the Resend quota).
const RESEND_COOLDOWN_SECONDS = 60;

export type ResetPurpose = 'invite' | 'reset';

export interface ResetTokenPayload {
    userId: string;
    purpose: ResetPurpose;
}

@Injectable()
export class PasswordResetService {
    private readonly logger = new Logger(PasswordResetService.name);

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        private readonly config: ConfigService,
    ) { }

    // Only the *hash* of the token is stored, so a leaked Redis dump can't be
    // replayed against the reset endpoint — same reasoning as storing password
    // hashes rather than passwords.
    private hash(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    private tokenKey(tokenHash: string) {
        return `pwreset:token:${tokenHash}`;
    }

    private userKey(userId: string) {
        return `pwreset:user:${userId}`;
    }

    private cooldownKey(userId: string) {
        return `pwreset:cooldown:${userId}`;
    }

    /**
     * Mints a single-use token for the user and returns the *raw* value, which
     * is the only time it exists in plaintext. Any token previously issued to
     * this user is revoked, so the newest link in the inbox is the one that works.
     */
    async issueToken(userId: string, purpose: ResetPurpose): Promise<string> {
        const ttl = purpose === 'invite' ? INVITE_TTL_SECONDS : RESET_TTL_SECONDS;

        const previousHash = await this.redis.get(this.userKey(userId));
        if (previousHash) {
            await this.redis.del(this.tokenKey(previousHash));
        }

        const rawToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = this.hash(rawToken);

        const payload: ResetTokenPayload = { userId, purpose };

        await this.redis.set(this.tokenKey(tokenHash), JSON.stringify(payload), 'EX', ttl);
        await this.redis.set(this.userKey(userId), tokenHash, 'EX', ttl);

        return rawToken;
    }

    /** Reads a token without spending it — used to render the right form (or an
     *  "expired link" screen) before the user has typed a password. */
    async peekToken(rawToken: string): Promise<ResetTokenPayload | null> {
        if (!rawToken) return null;

        const stored = await this.redis.get(this.tokenKey(this.hash(rawToken)));
        if (!stored) return null;

        try {
            return JSON.parse(stored) as ResetTokenPayload;
        } catch {
            this.logger.error('Found a malformed password-reset payload in Redis.');
            return null;
        }
    }

    /** Reads a token and immediately burns it, so a link can only set a password once. */
    async consumeToken(rawToken: string): Promise<ResetTokenPayload | null> {
        const payload = await this.peekToken(rawToken);
        if (!payload) return null;

        await this.redis.del(this.tokenKey(this.hash(rawToken)));
        await this.redis.del(this.userKey(payload.userId));

        return payload;
    }

    /** Drops any outstanding link for this user — used when the account is deleted,
     *  so a live invite in someone's inbox stops working immediately. */
    async revokeTokensFor(userId: string): Promise<void> {
        const tokenHash = await this.redis.get(this.userKey(userId));
        if (tokenHash) {
            await this.redis.del(this.tokenKey(tokenHash));
        }
        await this.redis.del(this.userKey(userId));
    }

    /** True when this user has been sent a link too recently to send another. */
    async isOnCooldown(userId: string): Promise<boolean> {
        return (await this.redis.exists(this.cooldownKey(userId))) === 1;
    }

    async startCooldown(userId: string): Promise<void> {
        await this.redis.set(this.cooldownKey(userId), '1', 'EX', RESEND_COOLDOWN_SECONDS);
    }

    /** Builds the link that lands in the email. */
    buildLink(rawToken: string, purpose: ResetPurpose): string {
        // Same knob the receipt links use, so there's one place to set the
        // dashboard's public URL.
        const base = (
            this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173'
        ).replace(/\/+$/, '');

        return `${base}/set-password?token=${encodeURIComponent(rawToken)}&purpose=${purpose}`;
    }
}
