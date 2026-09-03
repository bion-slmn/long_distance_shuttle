// src/booking/otp.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { EmailService } from '../email/email.service';

const OTP_TTL_SECONDS = 10 * 60;

// A 6-digit code has a million possibilities. Without a cap on guesses it
// is brute-forceable inside its own TTL, so every wrong answer burns one of
// a handful of attempts and the code is destroyed once they run out.
export const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
    constructor(
        @Inject(REDIS_CLIENT) private redis: Redis,
        private emailService: EmailService,
    ) { }

    private key(email: string) {
        return `otp:tickets:${email.trim().toLowerCase()}`;
    }

    private attemptsKey(email: string) {
        return `${this.key(email)}:attempts`;
    }

    async requestCode(email: string) {
        // crypto.randomInt, not Math.random — the latter is predictable.
        const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
        await this.redis.set(this.key(email), code, 'EX', OTP_TTL_SECONDS);
        await this.redis.del(this.attemptsKey(email)); // fresh code, fresh budget
        await this.emailService.sendOtp(email, code);
    }

    async verifyCode(email: string, code: string): Promise<boolean> {
        const stored = await this.redis.get(this.key(email));
        if (!stored) return false;

        if (stored !== code) {
            const attempts = await this.redis.incr(this.attemptsKey(email));
            if (attempts === 1) {
                await this.redis.expire(this.attemptsKey(email), OTP_TTL_SECONDS);
            }
            if (attempts >= OTP_MAX_ATTEMPTS) {
                // Too many guesses: kill the code so the remaining TTL can't
                // be used to keep guessing. The user simply requests a new one.
                await this.redis.del(this.key(email), this.attemptsKey(email));
            }
            return false;
        }

        await this.redis.del(this.key(email), this.attemptsKey(email)); // one-time use
        return true;
    }
}
