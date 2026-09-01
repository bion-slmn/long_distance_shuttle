// src/sacco/sacco-settings.controller.ts
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { UserRole } from '../auth/entities/user.entity';
import { SaccoSettingsService } from './sacco-settings.service';
import { UpdateSaccoSettingsDto } from './dto/update-sacco-settings.dto';
import { ConfigureMpesaDto } from './dto/configure-mpesa.dto';
import { Roles } from 'src/decorators/roles.decorator';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { RolesGuard } from 'src/guards/roles.guard';

@Controller('saccos/:saccoId/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SaccoSettingsController {
    constructor(private readonly settingsService: SaccoSettingsService) { }

    @Get()
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    findOne(
        @Param('saccoId') saccoId: string,
        @CurrentUser() user: any,
    ) {
        this.assertSaccoAccess(user, saccoId);
        return this.settingsService.findOne(saccoId);
    }

    // ── Clerk-facing: which payment methods the booking sheet may offer ───
    // Deliberately narrower than @Get() above — it returns no commission
    // rate and no pre-booking limits, which is what lets CLERK read it. Must
    // stay a distinct path from @Get(), which remains admin-only.
    @Get('payment-options')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    getPaymentOptions(
        @Param('saccoId') saccoId: string,
        @CurrentUser() user: any,
    ) {
        this.assertSaccoAccess(user, saccoId);
        return this.settingsService.getPaymentOptions(saccoId);
    }

    @Patch()
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    update(
        @Param('saccoId') saccoId: string,
        @Body() dto: UpdateSaccoSettingsDto,
        @CurrentUser() user: any,
    ) {
        this.assertSaccoAccess(user, saccoId);
        return this.settingsService.update(saccoId, dto);
    }

    @Post('mpesa')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    configureMpesa(
        @Param('saccoId') saccoId: string,
        @Body() dto: ConfigureMpesaDto,
        @CurrentUser() user: any,
    ) {
        this.assertSaccoAccess(user, saccoId);
        return this.settingsService.configureMpesa(saccoId, dto);
    }

    @Post('mpesa/disable')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    disableMpesa(
        @Param('saccoId') saccoId: string,
        @CurrentUser() user: any,
    ) {
        this.assertSaccoAccess(user, saccoId);
        return this.settingsService.disableMpesa(saccoId);
    }

    // A SACCO_ADMIN or CLERK may only touch their own sacco's settings —
    // SUPER_ADMIN bypasses this check entirely.
    private assertSaccoAccess(user: any, saccoId: string): void {
        if (user.role === UserRole.SUPER_ADMIN) return;
        if (user.saccoId !== saccoId) {
            throw new ForbiddenException('You do not have access to this SACCO\'s settings.');
        }
    }
}