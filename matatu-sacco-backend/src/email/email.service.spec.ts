// src/email/email.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

// ── Mock the Resend SDK ─────────────────────────────────────────────────
// We mock the whole module so `new Resend(...)` returns an object whose
// `emails.send` we control per-test.
const mockSend = jest.fn();

jest.mock('resend', () => {
  return {
    Resend: jest.fn().mockImplementation(() => ({
      emails: {
        send: mockSend,
      },
    })),
  };
});

describe('EmailService', () => {
  let service: EmailService;
  let configService: ConfigService;

  const OTP_EMAIL = 'passenger@example.com';
  const OTP_CODE = '123456';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('re_test_api_key'),
          },
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reads RESEND_API_KEY from ConfigService on construction', () => {
    expect(configService.get).toHaveBeenCalledWith('RESEND_API_KEY');
  });

  describe('sendOtp', () => {
    it('sends an email with the correct payload', async () => {
      mockSend.mockResolvedValueOnce({
        data: { id: 'email_123' },
        error: null,
      });

      await service.sendOtp(OTP_EMAIL, OTP_CODE);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        from: 'ShuttleHub <onboarding@resend.dev>',
        to: OTP_EMAIL,
        subject: `Your ShuttleHub verification code: ${OTP_CODE}`,
        html: expect.stringContaining(OTP_CODE),
      });
    });

    it('returns the Resend response on success', async () => {
      const mockResponse = { data: { id: 'email_123' }, error: null };
      mockSend.mockResolvedValueOnce(mockResponse);

      const result = await service.sendOtp(OTP_EMAIL, OTP_CODE);

      expect(result).toEqual(mockResponse);
    });

    it('throws when Resend resolves with an error payload (soft failure)', async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid recipient', name: 'validation_error' },
      });

      await expect(service.sendOtp(OTP_EMAIL, OTP_CODE)).rejects.toThrow(
        'Failed to send OTP email: Invalid recipient',
      );
    });

    it('throws when the Resend SDK itself rejects (network/hard failure)', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(service.sendOtp(OTP_EMAIL, OTP_CODE)).rejects.toThrow('Network timeout');
    });

    it('propagates a non-Error rejection without crashing the logger', async () => {
      mockSend.mockRejectedValueOnce('unexpected string rejection');

      await expect(service.sendOtp(OTP_EMAIL, OTP_CODE)).rejects.toBe(
        'unexpected string rejection',
      );
    });

    it('includes the OTP code in the email HTML body', async () => {
      mockSend.mockResolvedValueOnce({ data: { id: 'email_456' }, error: null });

      await service.sendOtp(OTP_EMAIL, '987654');

      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.html).toContain('987654');
    });
  });
});