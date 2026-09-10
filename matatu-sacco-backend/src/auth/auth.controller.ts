import {
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    MaxLength,
    MinLength,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import {
    Controller,
    Post,
    Body,
    Req,
    HttpCode,
    HttpStatus,
    UseGuards,
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

// ─── DTOs ────────────────────────────────────────────────────────────────────

class RegisterDto {
    @IsString() @IsNotEmpty() @MaxLength(120)
    declare fullName: string;

    @IsOptional() @IsEmail()
    declare email?: string;

    @IsOptional() @IsString() @Length(9, 16)
    declare phoneNumber?: string;

    @IsString() @MinLength(8) @MaxLength(128)
    declare password: string;

    @IsEnum(UserRole)
    declare role: UserRole;
}

class LoginDto {
    @IsString() @IsNotEmpty() @MaxLength(254)
    declare identifier: string;

    @IsString() @IsNotEmpty() @MaxLength(128)
    declare password: string;
}

class RefreshDto {
    @IsString() @IsNotEmpty()
    declare refresh_token: string;
}

class ForgotPasswordDto {
    @IsEmail()
    declare email: string;
}

class ResetPasswordDto {
    @IsString() @IsNotEmpty()
    declare token: string;

    @IsString() @MinLength(8) @MaxLength(128)
    declare password: string;
}

class ChangePasswordDto {
    @IsString() @IsNotEmpty()
    declare currentPassword: string;

    @IsString() @MinLength(8) @MaxLength(128)
    declare newPassword: string;
}

const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

// ─── Controller ──────────────────────────────────────────────────────────────

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    // ── Register ──────────────────────────────────────────────────────────────
    @Post('register')
    @Throttle(CREDENTIAL_THROTTLE)
    @Public()
    @HttpCode(HttpStatus.CREATED)
    register(@Body() body: RegisterDto) {
        return this.authService.register(body);
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    // POST /auth/login — returns access_token, refresh_token, and user in the body.
    // Pilot/MVP: no cookie. Frontend is responsible for storing refresh_token
    // (localStorage) and sending it back to /auth/refresh itself.
    @Post('login')
    @Throttle(CREDENTIAL_THROTTLE)
    @Public()
    @HttpCode(HttpStatus.OK)
    login(@Body() body: LoginDto) {
        return this.authService.login(body.identifier, body.password);
    }

    // ── Refresh ───────────────────────────────────────────────────────────────
    // POST /auth/refresh — refresh_token now comes from the request body, not a cookie.
    @Post('refresh')
    @Public()
    @HttpCode(HttpStatus.OK)
    async refresh(@Body() body: RefreshDto) {
        if (!body.refresh_token) {
            throw new UnauthorizedException('No refresh token provided.');
        }
        return this.authService.refresh(body.refresh_token);
    }

    // ── Logout ────────────────────────────────────────────────────────────────
    // POST /auth/logout — bumps tokenVersion server-side, invalidating any
    // outstanding refresh tokens. Frontend clears its own localStorage.
    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    logout(@Req() req: any) {
        return this.authService.logout(req.user.sub);
    }

    // ── Forgot password ───────────────────────────────────────────────────────
    @Post('forgot-password')
    @Throttle(CREDENTIAL_THROTTLE)
    @Public()
    @HttpCode(HttpStatus.OK)
    forgotPassword(@Body() body: ForgotPasswordDto) {
        return this.authService.forgotPassword(body.email);
    }

    // ── Verify a set-password link ────────────────────────────────────────────
    @Get('reset-password')
    @Public()
    @HttpCode(HttpStatus.OK)
    verifyResetToken(@Query('token') token: string) {
        return this.authService.verifyPasswordToken(token);
    }

    // ── Set / reset password via emailed link ────────────────────────────────
    @Post('reset-password')
    @Throttle(CREDENTIAL_THROTTLE)
    @Public()
    @HttpCode(HttpStatus.OK)
    resetPassword(@Body() body: ResetPasswordDto) {
        return this.authService.resetPassword(body.token, body.password);
    }

    // ── Change password while signed in ───────────────────────────────────────
    // POST /auth/change-password — returns a fresh token pair in the body.
    @Post('change-password')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    changePassword(@Body() body: ChangePasswordDto, @Req() req: any) {
        return this.authService.changePassword(
            req.user.sub,
            body.currentPassword,
            body.newPassword,
        );
    }

    // ── Staff creation ───────────────────────────────────────────────────────
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
    @Post('managers')
    @Roles(UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    createManager(@Body() dto: CreateManagerDto) {
        return this.authService.createManager(dto);
    }

    // ── Update user ───────────────────────────────────────────────────────────
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
    @Post('users/:id/password-link')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    sendPasswordLink(@Param('id') id: string, @Req() req: any) {
        return this.authService.sendPasswordLinkForUser(id, req.user);
    }

    // ── Restore a removed user ───────────────────────────────────────────────
    @Post('users/:id/restore')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    restoreUser(@Param('id') id: string, @Req() req: any) {
        return this.authService.restoreUser(id, req.user);
    }

    // ── Delete user ───────────────────────────────────────────────────────────
    @Delete('users/:id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    deleteUser(@Param('id') id: string, @Req() req: any) {
        return this.authService.deleteUser(id, req.user);
    }
}