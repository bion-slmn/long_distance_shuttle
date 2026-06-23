// src/guards/jwt-auth.guard.spec.ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockExecutionContext = (): ExecutionContext =>
({
    switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer mock-token' } }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
} as unknown as ExecutionContext);

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('JwtAuthGuard', () => {
    let guard: JwtAuthGuard;

    beforeEach(() => {
        guard = new JwtAuthGuard();
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    // ── handleRequest ─────────────────────────────────────────────────────────

    describe('handleRequest()', () => {
        it('returns the user when no error and user is present', () => {
            const user = { id: 'uuid-1', role: 'DRIVER' };
            const result = guard.handleRequest(null, user);
            expect(result).toBe(user);
        });

        it('throws UnauthorizedException when user is null', () => {
            expect(() => guard.handleRequest(null, null))
                .toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException when user is undefined', () => {
            expect(() => guard.handleRequest(null, undefined))
                .toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException when err is present (even with a user)', () => {
            const user = { id: 'uuid-1' };
            expect(() => guard.handleRequest(new Error('jwt expired'), user))
                .toThrow(UnauthorizedException);
        });

        it('throws with the message "Access token required."', () => {
            expect(() => guard.handleRequest(null, null))
                .toThrow('Access token required.');
        });

        it('returns any truthy user object unchanged', () => {
            const user = { id: 'uuid-2', role: 'PASSENGER', saccoId: null };
            expect(guard.handleRequest(null, user)).toEqual(user);
        });
    });
});