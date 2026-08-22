import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

const BRAND_DEEP = '#064E3B';
const PRIMARY = '#15803D';
const GOLD = '#EAB308';
const TEXT_MUTED = '#6b6375';

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
                html: this.otpTemplate(code),
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

    private otpTemplate(code: string): string {
        return `
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#f4f3ec; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ec; padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="400" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow: 0 4px 6px -2px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.1);">

            <!-- Header -->
            <tr>
              <td style="background:${BRAND_DEEP}; padding:28px 24px; text-align:center;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>
                    <td style="width:32px; height:32px; background:${PRIMARY}; border-radius:8px; text-align:center; vertical-align:middle;">
                      <span style="color:#ffffff; font-size:16px; line-height:32px;">🚌</span>
                    </td>
                    <td style="padding-left:8px; font-size:18px; font-weight:700; color:#ffffff; vertical-align:middle;">
                      Shuttle<span style="color:${GOLD};">Hub</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:32px 28px 24px;">
                <p style="margin:0 0 8px; font-size:14px; color:${TEXT_MUTED};">Your verification code</p>
                <p style="margin:0 0 20px; font-size:36px; font-weight:700; letter-spacing:4px; color:#08060d;">
                  ${code}
                </p>
                <p style="margin:0; font-size:13px; color:${TEXT_MUTED}; line-height:1.5;">
                  Enter this code to continue. It expires in <strong style="color:#08060d;">5 minutes</strong>.
                  If you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- Divider -->
            <tr>
              <td style="padding:0 28px;">
                <div style="border-top:1px dashed #e5e4e7;"></div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 24px; text-align:center; background:#f4f3ec;">
                <div style="height:3px; background:${PRIMARY}; margin:-20px -24px 16px;"></div>
                <p style="margin:0 0 4px; font-size:11px; color:${TEXT_MUTED};">
                  +254 700 123 456 &nbsp;•&nbsp; support@shuttlehub.com
                </p>
                <p style="margin:0 0 8px; font-size:11px; color:${TEXT_MUTED};">Nairobi, Kenya</p>
                <p style="margin:0; font-size:10px; color:#9ca3af;">
                  © ${new Date().getFullYear()} ShuttleHub. All rights reserved.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
    }
}