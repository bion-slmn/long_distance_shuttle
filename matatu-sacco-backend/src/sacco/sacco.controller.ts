import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    HttpCode,
    HttpStatus,
    UseGuards,
    ParseUUIDPipe,
    ForbiddenException,
} from '@nestjs/common';
import { SaccoService, type CreateSaccoDto, type UpdateSaccoDto } from './sacco.service';
import type { SaccoContact, SaccoEmail } from './entities/sacco.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../auth/entities/user.entity';

@Controller('saccos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SaccoController {
    constructor(private readonly saccoService: SaccoService) { }

    // ── POST /saccos ──────────────────────────────────────────────────────────

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.CREATED)
    create(@Body() body: CreateSaccoDto) {
        return this.saccoService.create(body);
    }

    // ── GET /saccos ───────────────────────────────────────────────────────────
    // SUPER_ADMIN → all saccos, paginated
    // SACCO_ADMIN → only their own sacco
    // CLERK       → only their own sacco

    @Get()
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    findAll(
        @Query('includeInactive') includeInactive?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('minimalFields') minimalFields?: string,
        @Query('search') search?: string,
        @Query('withCounts') withCounts?: string,
    ) {
        return this.saccoService.findAll({
            includeInactive: includeInactive === 'true',
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
            minimalFields: minimalFields === 'true',
            search,
            withCounts: withCounts === 'true',
        });
    }
    // ── GET /saccos/:id ───────────────────────────────────────────────────────

    @Get(':id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
    findOne(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
    ) {
        const scopedId = user.role === UserRole.CLERK ? user.saccoId : undefined;
        return this.saccoService.findOneScoped(id, scopedId);
    }

    // ── PATCH /saccos/:id ─────────────────────────────────────────────────────

    @Patch(':id')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateSaccoDto,
        @CurrentUser() user: any,
    ) {
        // SACCO_ADMIN can only update their own sacco
        if (user.role === UserRole.SACCO_ADMIN && user.saccoId !== id) {
            throw new ForbiddenException('You can only update your own sacco.');
        }

        return this.saccoService.update(id, body);
    }

    // ── PATCH /saccos/:id/deactivate ──────────────────────────────────────────

    @Patch(':id/deactivate')
    @Roles(UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    deactivate(@Param('id', ParseUUIDPipe) id: string) {
        return this.saccoService.deactivate(id);
    }

    // ── PATCH /saccos/:id/reactivate ──────────────────────────────────────────

    @Patch(':id/reactivate')
    @Roles(UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    reactivate(@Param('id', ParseUUIDPipe) id: string) {
        return this.saccoService.reactivate(id);
    }

    // ── POST /saccos/:id/contacts ─────────────────────────────────────────────

    @Post(':id/contacts')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    addContact(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() contact: SaccoContact,
        @CurrentUser() user: any,
    ) {
        if (user.role === UserRole.SACCO_ADMIN && user.saccoId !== id) {
            throw new ForbiddenException('You can only manage your own sacco contacts.');
        }
        return this.saccoService.addContact(id, contact);
    }

    // ── DELETE /saccos/:id/contacts/:phone ────────────────────────────────────

    @Delete(':id/contacts/:phone')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    removeContact(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('phone') phone: string,
        @CurrentUser() user: any,
    ) {
        if (user.role === UserRole.SACCO_ADMIN && user.saccoId !== id) {
            throw new ForbiddenException('You can only manage your own sacco contacts.');
        }
        return this.saccoService.removeContact(id, phone);
    }

    // ── POST /saccos/:id/emails ───────────────────────────────────────────────

    @Post(':id/emails')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    addEmail(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() email: SaccoEmail,
        @CurrentUser() user: any,
    ) {
        if (user.role === UserRole.SACCO_ADMIN && user.saccoId !== id) {
            throw new ForbiddenException('You can only manage your own sacco emails.');
        }
        return this.saccoService.addEmail(id, email);
    }

    // ── DELETE /saccos/:id/emails/:emailAddress ───────────────────────────────

    @Delete(':id/emails/:emailAddress')
    @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
    @HttpCode(HttpStatus.OK)
    removeEmail(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('emailAddress') emailAddress: string,
        @CurrentUser() user: any,
    ) {
        if (user.role === UserRole.SACCO_ADMIN && user.saccoId !== id) {
            throw new ForbiddenException('You can only manage your own sacco emails.');
        }
        return this.saccoService.removeEmail(id, emailAddress);
    }
}