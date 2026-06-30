import {
    Controller,
    Post,
    Body,
    Req,
    HttpCode,
    HttpStatus,
    UseGuards,
} from '@nestjs/common';
import { AuthService, type CreateManagerDto, type CreateStaffDto } from './auth.service';
import { UserRole } from './entities/user.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from '../guards/roles.guard';
import { Public } from 'src/decorators/public.decorator';
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


    // POST /auth/staff  — admin-only, creates drivers/clerks
    @Post('staff')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    createStaff(@Body() body: CreateStaffDto, @Req() req: any) {
        return this.authService.createStaffUser(body, req.user);
    }

    @Post('managers')
    @Roles(UserRole.SUPER_ADMIN)
    async createManager(@Body() dto: CreateManagerDto) {
        return this.authService.createManager(dto);
    }


    @Post('register')
    @Public()
    @HttpCode(HttpStatus.CREATED)
    register(@Body() body: RegisterDto) {
        return this.authService.register(body);
    }

    @Post('login')
    @Public()
    @HttpCode(HttpStatus.OK)
    login(@Body() body: LoginDto) {
        return this.authService.login(body.identifier, body.password);
    }

    @Post('refresh')
    @Public()
    @HttpCode(HttpStatus.OK)
    refresh(@Body() body: RefreshDto) {
        return this.authService.refresh(body.refresh_token);
    }
}