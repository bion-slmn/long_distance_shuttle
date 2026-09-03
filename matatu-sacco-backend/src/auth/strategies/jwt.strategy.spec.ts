import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy({ getOrThrow: () => 'test-access-secret' } as any);
  const access = { sub: 'user-1', email: 'a@b.c', role: 'CLERK', saccoId: 'sacco-1', tokenVersion: 0 };

  it('maps a staff/passenger access token onto the request user', async () => {
    await expect(strategy.validate(access)).resolves.toEqual(
      expect.objectContaining({ sub: 'user-1', role: 'CLERK', saccoId: 'sacco-1' }),
    );
  });

  it('SECURITY: rejects a refresh token even if its signature verified', async () => {
    await expect(strategy.validate({ ...access, typ: 'refresh' })).rejects.toThrow(UnauthorizedException);
  });

  it('SECURITY: rejects a ticket-session token (scope) — it must go through TicketsAuthGuard', async () => {
    await expect(strategy.validate({ email: 'a@b.c', scope: 'tickets' })).rejects.toThrow(UnauthorizedException);
  });

  it('SECURITY: rejects a token with no subject', async () => {
    await expect(strategy.validate({ role: 'SUPER_ADMIN' })).rejects.toThrow(UnauthorizedException);
  });
});
