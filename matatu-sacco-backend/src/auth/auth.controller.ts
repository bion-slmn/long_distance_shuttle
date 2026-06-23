import {
    Controller,
    Post,
    Body,
    Req,
    HttpCode,
    HttpStatus,
    UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from './entities/user.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
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

class RefreshDto {
    declare refresh_token: string;
}
// ─── Controller ──────────────────────────────────────────────────────────────

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    // POST /auth/register
    @Post('register')
    @HttpCode(HttpStatus.CREATED)
    register(@Body() body: RegisterDto) {
        return this.authService.register(body);
    }

    // POST /auth/login
    @Post('login')
    @HttpCode(HttpStatus.OK)
    login(@Body() body: LoginDto) {
        return this.authService.login(body.identifier, body.password);
    }

    // POST /auth/refresh  — guard verifies the refresh token signature
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    refresh(@Body() body: RefreshDto) {
        return this.authService.refresh(body.refresh_token);
    }

    // POST /auth/logout  — requires a valid access token
    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    logout(@Req() req: any) {
        return this.authService.logout(req.user.sub);
    }
}