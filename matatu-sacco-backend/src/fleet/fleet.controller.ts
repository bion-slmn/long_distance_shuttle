// fleet.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { FleetService, CreateFleetDto, UpdateFleetDto } from './fleet.service';
import { VehicleStatus } from './entities/fleet.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../auth/entities/user.entity';

@Controller('fleet')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FleetController {
  constructor(private readonly fleetService: FleetService) { }

  // ── POST /fleet ───────────────────────────────────────────────────────────

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() body: CreateFleetDto,
    @CurrentUser() user: any,
  ) {
    // SACCO_ADMIN can only add vehicles to their own sacco
    if (user.role === UserRole.SACCO_ADMIN) {
      if (!user.saccoId) {
        throw new ForbiddenException('You are not assigned to a sacco.');
      }
      body.saccoId = user.saccoId;  // ignore whatever saccoId they sent
    }

    return this.fleetService.create(body);
  }

  // ── GET /fleet ────────────────────────────────────────────────────────────
  // ?status=ACTIVE filter is available to all roles
  // CLERK and SACCO_ADMIN are scoped to their sacco automatically

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findAll(
    @CurrentUser() user: any,
    @Query('status') status?: VehicleStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('withQueueStatus') withQueueStatus?: string,
    @Query('saccoId') saccoId?: string,
  ) {
    const resolvedSaccoId = saccoId
      ? saccoId
      : user.role === UserRole.SUPER_ADMIN
        ? undefined
        : user.saccoId;

    return this.fleetService.findAll({
      saccoId: resolvedSaccoId,
      status,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      withQueueStatus: withQueueStatus === 'true',
    });
  }
  // ── GET /fleet/:id ────────────────────────────────────────────────────────

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.fleetService.findOneScoped(id, saccoId);
  }

  // ── PATCH /fleet/:id ──────────────────────────────────────────────────────

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateFleetDto,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.fleetService.update(id, body, saccoId);
  }

  // ── PATCH /fleet/:id/status ───────────────────────────────────────────────
  // Quick status change without sending the full update body

  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  @HttpCode(HttpStatus.OK)
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('value') status: VehicleStatus,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.fleetService.setStatus(id, status, saccoId);
  }
}