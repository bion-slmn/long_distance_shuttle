// src/guards/roles.guard.spec.ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from './roles.guard';
import { UserRole } from '../auth/entities/user.entity';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// NOTE: getHandler / getClass return STABLE references (created once per context)
// so reference-equality assertions (toBe) hold between the guard's internal call
// and the test's comparison. And the user is attached using `!== null` rather than
// a truthy check, so a role whose enum value is 0 (e.g. a numeric-enum first member)
// still attaches a user instead of being treated as "no user".
const mockContext = (userRole: UserRole | null): ExecutionContext => {
    const handler = () => { };
    const klass = class { };
    return {
        switchToHttp: () => ({
            getRequest: () => ({
                user: userRole !== null ? { id: 'uuid-1', role: userRole } : null,
            }),
        }),
        getHandler: () => handler,
        getClass: () => klass,
    } as unknown as ExecutionContext;
};

const mockReflector = (roles: UserRole[] | undefined) => ({
    getAllAndOverride: jest.fn().mockReturnValue(roles),
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('RolesGuard', () => {
    let guard: RolesGuard;
    let reflector: ReturnType<typeof mockReflector>;

    const buildGuard = (roles: UserRole[] | undefined) => {
        reflector = mockReflector(roles);
        guard = new RolesGuard(reflector as unknown as Reflector);
    };

    it('should be defined', () => {
        buildGuard([]);
        expect(guard).toBeDefined();
    });

    // ── No @Roles decorator ───────────────────────────────────────────────────

    describe('when no @Roles decorator is present', () => {
        it('returns true for undefined roles (open route)', () => {
            buildGuard(undefined);
            const ctx = mockContext(UserRole.DRIVER);
            expect(guard.canActivate(ctx)).toBe(true);
        });

        it('returns true for empty roles array', () => {
            buildGuard([]);
            const ctx = mockContext(UserRole.PASSENGER);
            expect(guard.canActivate(ctx)).toBe(true);
        });

        it('returns true even when user is null (no auth required)', () => {
            buildGuard(undefined);
            const ctx = mockContext(null);
            expect(guard.canActivate(ctx)).toBe(true);
        });
    });

    // ── Role matches ──────────────────────────────────────────────────────────

    describe('when user has a required role', () => {
        it('returns true for SUPER_ADMIN accessing SUPER_ADMIN route', () => {
            buildGuard([UserRole.SUPER_ADMIN]);
            const ctx = mockContext(UserRole.SUPER_ADMIN);
            expect(guard.canActivate(ctx)).toBe(true);
        });

        it('returns true when user role is one of multiple allowed roles', () => {
            buildGuard([UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN]);
            const ctx = mockContext(UserRole.SACCO_ADMIN);
            expect(guard.canActivate(ctx)).toBe(true);
        });

        it('returns true for DRIVER accessing DRIVER route', () => {
            buildGuard([UserRole.DRIVER]);
            const ctx = mockContext(UserRole.DRIVER);
            expect(guard.canActivate(ctx)).toBe(true);
        });

        it('returns true for CLERK accessing CLERK or DRIVER route', () => {
            buildGuard([UserRole.CLERK, UserRole.DRIVER]);
            const ctx = mockContext(UserRole.CLERK);
            expect(guard.canActivate(ctx)).toBe(true);
        });

        it('returns true for PASSENGER on a PASSENGER route', () => {
            buildGuard([UserRole.PASSENGER]);
            const ctx = mockContext(UserRole.PASSENGER);
            expect(guard.canActivate(ctx)).toBe(true);
        });
    });

    // ── Role does not match ───────────────────────────────────────────────────

    describe('when user does not have a required role', () => {
        it('throws ForbiddenException for DRIVER accessing SUPER_ADMIN route', () => {
            buildGuard([UserRole.SUPER_ADMIN]);
            const ctx = mockContext(UserRole.DRIVER);
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
        });

        it('throws ForbiddenException for PASSENGER accessing SACCO_ADMIN route', () => {
            buildGuard([UserRole.SACCO_ADMIN]);
            const ctx = mockContext(UserRole.PASSENGER);
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
        });

        it('throws ForbiddenException for CLERK accessing SUPER_ADMIN or SACCO_ADMIN route', () => {
            buildGuard([UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN]);
            const ctx = mockContext(UserRole.CLERK);
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
        });

        it('includes the required roles in the error message', () => {
            buildGuard([UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN]);
            const ctx = mockContext(UserRole.DRIVER);
            expect(() => guard.canActivate(ctx)).toThrow(
                'Required role(s): SUPER_ADMIN, SACCO_ADMIN',
            );
        });
    });

    // ── No user on request ────────────────────────────────────────────────────

    describe('when roles are required but user is missing', () => {
        it('throws ForbiddenException when req.user is null', () => {
            buildGuard([UserRole.SUPER_ADMIN]);
            const ctx = mockContext(null);
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
        });

        it('throws with "No user found on request."', () => {
            buildGuard([UserRole.DRIVER]);
            const ctx = mockContext(null);
            expect(() => guard.canActivate(ctx)).toThrow('No user found on request.');
        });
    });

    // ── Reflector is called correctly ─────────────────────────────────────────

    describe('reflector integration', () => {
        it('calls getAllAndOverride with the correct metadata key', () => {
            buildGuard([UserRole.SUPER_ADMIN]);
            const ctx = mockContext(UserRole.SUPER_ADMIN);

            guard.canActivate(ctx);

            expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
                ROLES_KEY,
                [ctx.getHandler(), ctx.getClass()],
            );
        });

        it('checks handler metadata before class metadata (handler wins)', () => {
            buildGuard([UserRole.DRIVER]);
            const ctx = mockContext(UserRole.DRIVER);

            guard.canActivate(ctx);

            // getAllAndOverride checks handler first — confirmed by call args order
            const [, sources] = reflector.getAllAndOverride.mock.calls[0];
            expect(sources[0]).toBe(ctx.getHandler());
            expect(sources[1]).toBe(ctx.getClass());
        });
    });
});