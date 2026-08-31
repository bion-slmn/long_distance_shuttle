import {
    Controller,
    Post,
    Body,
    Req,
    HttpCode,
    HttpStatus,
    UseGuards,
    Res,
    UnauthorizedException,
    Get,
    Query,
    Patch,
    Param,
    Delete,
} from '@nestjs/common';
import {
    AuthService,
    type UpdateUserDto,
    type CreateManagerDto,
    type CreateStaffDto,
    type UserStatusFilter,
} from './auth.service';
import { UserRole } from './entities/user.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Roles } from '../decorators/roles.decorator';
import { Public } from '../decorators/public.decorator';
import type { CookieOptions, Request, Response } from 'express';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class RegisterDto {
    declare fullName: string;
    declare email?: string;
    declare phoneNumber?: string;
    declare password: string;
    declare role: UserRole;
    declare saccoId?: string;
}

class LoginDto {
    declare identifier: string;
    declare password: string;
}

class ForgotPasswordDto {
    declare email: string;
}

class ResetPasswordDto {
    declare token: string;
    declare password: string;
}

class ChangePasswordDto {
    declare currentPassword: string;
    declare newPassword: string;
}

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth/refresh';

const allowCrossSiteCookies = process.env.ALLOW_CROSS_SITE_COOKIES === 'true';

// One definition shared by login, refresh, logout and change-password. The
// browser only overwrites or clears a cookie when the flags match the ones it
// was set with, so these must not drift apart.
//
// `Secure` is why this is worth spelling out: a Secure cookie is dropped over
// plain HTTP, so if NODE_ENV says "production" while the app is actually served
// over http://localhost, login appears to work and then every refresh 401s
// because the cookie was never stored. Keep NODE_ENV honest per environment.
const refreshCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: allowCrossSiteCookies || process.env.NODE_ENV === 'production',
    sameSite: allowCrossSiteCookies ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
};

// ─── Controller ──────────────────────────────────────────────────────────────

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    // ── Register ──────────────────────────────────────────────────────────────
    // POST /auth/register — public self-registration (passengers only, per service rules)
    @Post('register')
    @Public()
    @HttpCode(HttpStatus.CREATED)
    register(@Body() body: RegisterDto) {
        return this.authService.register(body);
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    // POST /auth/login — sets refresh_token as an httpOnly cookie, returns access_token + user in body
    @Post('login')
    @Public()
    @HttpCode(HttpStatus.OK)
    async login(
        @Body() body: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const { access_token, refresh_token, user } = await this.authService.login(
            body.identifier,
            body.password,
        );

        res.cookie(REFRESH_COOKIE_NAME, refresh_token, refreshCookieOptions);

        return { access_token, user };
    }

    // ── Refresh ───────────────────────────────────────────────────────────────
    // POST /auth/refresh — reads refresh_token from the httpOnly cookie (never the body),
    // rotates both tokens, and re-sets the cookie with the new refresh_token.
    @Post('refresh')
    @Public()
    @HttpCode(HttpStatus.OK)
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {

        const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

        if (!rawRefreshToken) {
            throw new UnauthorizedException('No refresh token provided.');
        }

        const results = await this.authService.refresh(rawRefreshToken);

        res.cookie(REFRESH_COOKIE_NAME, results.refresh_token, refreshCookieOptions);

        return results;
    }

    // ── Logout ────────────────────────────────────────────────────────────────
    // POST /auth/logout — requires a valid access token, bumps tokenVersion server-side
    // (invalidating any outstanding refresh tokens) and clears the refresh_token cookie.
    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async logout(
        @Req() req: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.authService.logout(req.user.sub);
        res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);

        return result;
    }

    // ── Forgot password ───────────────────────────────────────────────────────
    // POST /auth/forgot-password — always 200, even for unknown addresses, so the
    // endpoint can't be used to probe which emails have accounts.
    @Post('forgot-password')
    @Public()
    @HttpCode(HttpStatus.OK)
    forgotPassword(@Body() body: ForgotPasswordDto) {
        return this.authService.forgotPassword(body.email);
    }

    // ── Verify a set-password link ────────────────────────────────────────────
    // GET /auth/reset-password?token=… — read-only check so the frontend can show
    // an "expired link" screen instead of a form that's doomed to fail.
    @Get('reset-password')
    @Public()
    @HttpCode(HttpStatus.OK)
    verifyResetToken(@Query('token') token: string) {
        return this.authService.verifyPasswordToken(token);
    }

    // ── Set / reset password via emailed link ────────────────────────────────
    // POST /auth/reset-password — spends the token and invalidates all sessions.
    @Post('reset-password')
    @Public()
    @HttpCode(HttpStatus.OK)
    resetPassword(@Body() body: ResetPasswordDto) {
        return this.authService.resetPassword(body.token, body.password);
    }

    // ── Change password while signed in ───────────────────────────────────────
    // POST /auth/change-password — bumping tokenVersion kills the old refresh
    // token, so we hand back a fresh pair and re-set the cookie in place.
    @Post('change-password')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async changePassword(
        @Body() body: ChangePasswordDto,
        @Req() req: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        const { access_token, refresh_token, user } =
            await this.authService.changePassword(
                req.user.sub,
                body.currentPassword,
                body.newPassword,
            );

        res.cookie(REFRESH_COOKIE_NAME, refresh_token, refreshCookieOptions);

        return { access_token, user };
    }

    // ── Staff creation ───────────────────────────────────────────────────────
    // POST /auth/staff — admin-only, creates drivers/clerks
    @Post('staff')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    createStaff(@Body() body: CreateStaffDto, @Req() req: any) {
        return this.authService.createStaffUser(body, req.user);
    }

    @Get('users')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    getUsers(
        @Query('saccoId') saccoId: string | undefined,
        @Query('page') page: string | undefined,
        @Query('limit') limit: string | undefined,
        @Query('search') search: string | undefined,
        @Query('status') status: UserStatusFilter | undefined,
        @Req() req: any,
    ) {
        // Sacco admins are locked to their own sacco regardless of what's
        // passed in the query string — they can't override it to see everyone.
        // Super admins can pass a saccoId to filter, or omit it to get all users.
        const scopedSaccoId =
            req.user.role === UserRole.SACCO_ADMIN ? req.user.saccoId : saccoId;

        return this.authService.getUsers({
            saccoId: scopedSaccoId,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            search: search,
            status,
        });
    }

    // ── Manager creation ─────────────────────────────────────────────────────
    // POST /auth/managers — super-admin-only, creates sacco managers
    @Post('managers')
    @Roles(UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    createManager(@Body() dto: CreateManagerDto) {
        return this.authService.createManager(dto);
    }


    // ── Update user ───────────────────────────────────────────────────────────
    // PATCH /auth/users/:id — sacco admins (own sacco only) or super admins
    @Patch('users/:id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    updateUser(
        @Param('id') id: string,
        @Body() dto: UpdateUserDto,
        @Req() req: any,
    ) {
        return this.authService.updateUser(id, dto, req.user);
    }

    // ── Resend a set-password / reset link ───────────────────────────────────
    // POST /auth/users/:id/password-link — for "the clerk never got the email".
    // Admins can trigger the email but never see or choose the password.
    @Post('users/:id/password-link')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    sendPasswordLink(@Param('id') id: string, @Req() req: any) {
        return this.authService.sendPasswordLinkForUser(id, req.user);
    }

    // ── Restore a removed user ───────────────────────────────────────────────
    // POST /auth/users/:id/restore — undoes a soft delete. Same scoping as the
    // delete itself: sacco admins within their own sacco, super admins anywhere.
    @Post('users/:id/restore')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    restoreUser(@Param('id') id: string, @Req() req: any) {
        return this.authService.restoreUser(id, req.user);
    }

    // ── Delete user ───────────────────────────────────────────────────────────
    // DELETE /auth/users/:id — sacco admins (own sacco only) or super admins
    @Delete('users/:id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    deleteUser(@Param('id') id: string, @Req() req: any) {
        return this.authService.deleteUser(id, req.user);
    }
}