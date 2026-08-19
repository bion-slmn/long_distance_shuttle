import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
    private resend: Resend;
    private readonly logger = new Logger(EmailService.name);

    constructor(private config: ConfigService) {
        this.resend = new Resend(this.config.get<string>('RESEND_API_KEY'));
    }

    async sendOtp(email: string, code: string) {
        try {
            const resp = await this.resend.emails.send({
                from: 'ShuttleHub <onboarding@resend.dev>', // swap once you verify your own domain
                to: email,
                subject: `Your ShuttleHub verification code: ${code}`,
                html: `<p>Your code is <strong>${code}</strong>. It expires in 5 minutes.</p>`,
            });

            if (resp.error) {
                // Resend can return a 200 with an `error` field instead of throwing
                this.logger.error(
                    `Resend API returned an error sending OTP to ${email}: ${JSON.stringify(resp.error)}`,
                );
                throw new Error(`Failed to send OTP email: ${resp.error.message}`);
            }

            this.logger.log(`OTP email sent to ${email} (id: ${resp.data?.id})`);
            return resp;
        } catch (err) {
            this.logger.error(`Failed to send OTP email to ${email}`, err instanceof Error ? err.stack : err);
            throw err;
        }
    }
}