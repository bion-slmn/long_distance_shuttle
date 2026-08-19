// src/booking/otp.service.ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { EmailService } from '../email/email.service';

const OTP_TTL_SECONDS = 10 * 60; // 5 minutes

@Injectable()
export class OtpService {
    constructor(
        @Inject(REDIS_CLIENT) private redis: Redis,
        private emailService: EmailService,
    ) { }

    private key(email: string) {
        return `otp:tickets:${email.trim().toLowerCase()}`;
    }

    async requestCode(email: string) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await this.redis.set(this.key(email), code, 'EX', OTP_TTL_SECONDS);
        await this.emailService.sendOtp(email, code);
    }

    async verifyCode(email: string, code: string): Promise<boolean> {
        const stored = await this.redis.get(this.key(email));
        if (!stored || stored !== code) {
            return false;
        }
        await this.redis.del(this.key(email)); // one-time use
        return true;
    }
}