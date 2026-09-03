import { OtpService, OTP_MAX_ATTEMPTS } from './otp.service';

describe('OtpService', () => {
  let redis: Record<string, jest.Mock>;
  let email: { sendOtp: jest.Mock };
  let service: OtpService;
  const KEY = 'otp:tickets:jane@example.com';
  const ATTEMPTS = `${KEY}:attempts`;

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      incr: jest.fn(),
      expire: jest.fn().mockResolvedValue(1),
    };
    email = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    service = new OtpService(redis as any, email as any);
  });

  it('issues a 6-digit code with a TTL and resets the attempt budget', async () => {
    await service.requestCode(' Jane@Example.com ');

    const [key, code, ex, ttl] = redis.set.mock.calls[0];
    expect(key).toBe(KEY);
    expect(code).toMatch(/^\d{6}$/);
    expect(ex).toBe('EX');
    expect(ttl).toBeGreaterThan(0);
    expect(redis.del).toHaveBeenCalledWith(ATTEMPTS);
    expect(email.sendOtp).toHaveBeenCalledWith(' Jane@Example.com ', code);
  });

  it('does not use Math.random for the code', async () => {
    const spy = jest.spyOn(Math, 'random');
    await service.requestCode('jane@example.com');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('accepts the right code once and burns it', async () => {
    redis.get.mockResolvedValue('123456');

    await expect(service.verifyCode('jane@example.com', '123456')).resolves.toBe(true);
    expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS);
  });

  it('rejects when no code is outstanding', async () => {
    redis.get.mockResolvedValue(null);
    await expect(service.verifyCode('jane@example.com', '123456')).resolves.toBe(false);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('SECURITY: counts a wrong guess and keeps the code alive under the cap', async () => {
    redis.get.mockResolvedValue('123456');
    redis.incr.mockResolvedValue(1);

    await expect(service.verifyCode('jane@example.com', '000000')).resolves.toBe(false);
    expect(redis.incr).toHaveBeenCalledWith(ATTEMPTS);
    expect(redis.expire).toHaveBeenCalledWith(ATTEMPTS, expect.any(Number));
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('SECURITY: destroys the code once the guess budget is spent', async () => {
    redis.get.mockResolvedValue('123456');
    redis.incr.mockResolvedValue(OTP_MAX_ATTEMPTS);

    await expect(service.verifyCode('jane@example.com', '000000')).resolves.toBe(false);
    expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS);
  });
});
