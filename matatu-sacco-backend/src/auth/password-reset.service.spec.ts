import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

import {
    PasswordResetService,
    INVITE_TTL_SECONDS,
    RESET_TTL_SECONDS,
} from './password-reset.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

const mockRedis = () => ({
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
});

describe('PasswordResetService', () => {
    let service: PasswordResetService;
    let redis: ReturnType<typeof mockRedis>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PasswordResetService,
                { provide: REDIS_CLIENT, useFactory: mockRedis },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key: string) =>
                            key === 'PUBLIC_APP_URL' ? 'https://app.shuttlehub.com/' : undefined,
                        ),
                    },
                },
            ],
        }).compile();

        service = module.get(PasswordResetService);
        redis = module.get(REDIS_CLIENT);
    });

    afterEach(() => jest.clearAllMocks());

    describe('issueToken()', () => {
        it('stores only the hash of the token, never the token itself', async () => {
            const token = await service.issueToken('user-1', 'reset');

            const [tokenKey, payload, , ttl] = redis.set.mock.calls[0];
            expect(tokenKey).toBe(`pwreset:token:${sha256(token)}`);
            expect(tokenKey).not.toContain(token);
            expect(JSON.parse(payload)).toEqual({ userId: 'user-1', purpose: 'reset' });
            expect(ttl).toBe(RESET_TTL_SECONDS);
        });

        it('gives an invite a longer life than a reset', async () => {
            await service.issueToken('user-1', 'invite');

            expect(redis.set.mock.calls[0][3]).toBe(INVITE_TTL_SECONDS);
        });

        it('revokes the previous token so only the newest link works', async () => {
            redis.get.mockResolvedValueOnce('old-token-hash');

            await service.issueToken('user-1', 'reset');

            expect(redis.del).toHaveBeenCalledWith('pwreset:token:old-token-hash');
        });

        it('returns a different token every time', async () => {
            const a = await service.issueToken('user-1', 'reset');
            const b = await service.issueToken('user-1', 'reset');

            expect(a).not.toBe(b);
        });
    });

    describe('peekToken()', () => {
        it('resolves a live token without deleting it', async () => {
            redis.get.mockResolvedValue(JSON.stringify({ userId: 'user-1', purpose: 'invite' }));

            const payload = await service.peekToken('raw-token');

            expect(payload).toEqual({ userId: 'user-1', purpose: 'invite' });
            expect(redis.del).not.toHaveBeenCalled();
        });

        it('returns null for an unknown or expired token', async () => {
            redis.get.mockResolvedValue(null);

            expect(await service.peekToken('raw-token')).toBeNull();
        });

        it('returns null rather than throwing on a malformed payload', async () => {
            redis.get.mockResolvedValue('not-json');

            expect(await service.peekToken('raw-token')).toBeNull();
        });

        it('returns null for an empty token without hitting Redis', async () => {
            expect(await service.peekToken('')).toBeNull();
            expect(redis.get).not.toHaveBeenCalled();
        });
    });

    describe('consumeToken()', () => {
        it('burns the token so the link cannot be reused', async () => {
            redis.get.mockResolvedValue(JSON.stringify({ userId: 'user-1', purpose: 'reset' }));

            const payload = await service.consumeToken('raw-token');

            expect(payload).toEqual({ userId: 'user-1', purpose: 'reset' });
            expect(redis.del).toHaveBeenCalledWith(`pwreset:token:${sha256('raw-token')}`);
            expect(redis.del).toHaveBeenCalledWith('pwreset:user:user-1');
        });

        it('deletes nothing when the token is already gone', async () => {
            redis.get.mockResolvedValue(null);

            expect(await service.consumeToken('raw-token')).toBeNull();
            expect(redis.del).not.toHaveBeenCalled();
        });
    });

    describe('revokeTokensFor()', () => {
        it('drops the outstanding token so a live invite stops working', async () => {
            redis.get.mockResolvedValueOnce('live-token-hash');

            await service.revokeTokensFor('user-1');

            expect(redis.del).toHaveBeenCalledWith('pwreset:token:live-token-hash');
            expect(redis.del).toHaveBeenCalledWith('pwreset:user:user-1');
        });

        it('is a no-op when the user has no outstanding token', async () => {
            redis.get.mockResolvedValueOnce(null);

            await service.revokeTokensFor('user-1');

            expect(redis.del).toHaveBeenCalledTimes(1);
            expect(redis.del).toHaveBeenCalledWith('pwreset:user:user-1');
        });
    });

    describe('cooldown', () => {
        it('reports a cooldown when the key exists', async () => {
            redis.exists.mockResolvedValue(1);

            expect(await service.isOnCooldown('user-1')).toBe(true);
        });

        it('reports no cooldown when the key is absent', async () => {
            expect(await service.isOnCooldown('user-1')).toBe(false);
        });

        it('sets an expiring key when started', async () => {
            await service.startCooldown('user-1');

            expect(redis.set).toHaveBeenCalledWith('pwreset:cooldown:user-1', '1', 'EX', 60);
        });
    });

    describe('buildLink()', () => {
        it('builds a frontend URL with the token and purpose, trimming trailing slashes', () => {
            const link = service.buildLink('raw+token/value', 'invite');

            expect(link).toBe(
                'https://app.shuttlehub.com/set-password?token=raw%2Btoken%2Fvalue&purpose=invite',
            );
        });
    });
});
