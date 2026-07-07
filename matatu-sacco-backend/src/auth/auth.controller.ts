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
} from '@nestjs/common';
import { AuthService, type CreateManagerDto, type CreateStaffDto } from './auth.service';
import { UserRole } from './entities/user.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Roles } from '../decorators/roles.decorator';
import { Public } from 'src/decorators/public.decorator';
import type { Request, Response } from 'express';

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

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth/refresh';

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

        res.cookie(REFRESH_COOKIE_NAME, refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            path: REFRESH_COOKIE_PATH,
        });

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

        const { access_token, refresh_token } = await this.authService.refresh(rawRefreshToken);

        res.cookie(REFRESH_COOKIE_NAME, refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            path: REFRESH_COOKIE_PATH,
        });

        return { access_token };
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

        res.clearCookie(REFRESH_COOKIE_NAME, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            path: REFRESH_COOKIE_PATH,
        });

        return result;
    }

    // ── Staff creation ───────────────────────────────────────────────────────
    // POST /auth/staff — admin-only, creates drivers/clerks
    @Post('staff')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    createStaff(@Body() body: CreateStaffDto, @Req() req: any) {
        return this.authService.createStaffUser(body, req.user);
    }

    // ── Manager creation ─────────────────────────────────────────────────────
    // POST /auth/managers — super-admin-only, creates sacco managers
    @Post('managers')
    @Roles(UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    createManager(@Body() dto: CreateManagerDto) {
        return this.authService.createManager(dto);
    }
}