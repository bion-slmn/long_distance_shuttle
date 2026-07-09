// src/route/route.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { RouteService, } from './route.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../auth/entities/user.entity';
import { UpdateQueueDto, UpdateRouteDto } from './dto/update-route.dto';
import { QueueStatus } from './entities/route-queue.entity';
import { CreateQueueDto, CreateRouteDto } from './dto/create-route.dto';

@Controller('routes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RouteController {
  constructor(private readonly routeService: RouteService) { }

  // ── POST /routes ──────────────────────────────────────────────────────────

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() body: CreateRouteDto,
    @CurrentUser() user: any,
  ) {
    if (user.role === UserRole.SACCO_ADMIN) {
      if (!user.saccoId) {
        throw new ForbiddenException('You are not assigned to a sacco.');
      }
      body.saccoId = user.saccoId;
    }
    return this.routeService.create(body);
  }

  // ── GET /routes ───────────────────────────────────────────────────────────

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findAll(@CurrentUser() user: any) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.routeService.findAll(saccoId);
  }

  // =========================================================================
  // ─── ROUTE QUEUE ENDPOINTS ───────────────────────────────────────────────
  // Registered BEFORE the dynamic ':id' routes below, since 'queue' would
  // otherwise be swallowed by @Get(':id') as a literal id value.
  // =========================================================================

  // ── POST /routes/queue/clock-in ──────────────────────────────────────────
  @Post('queue/clock-in')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  @HttpCode(HttpStatus.CREATED)
  clockInVehicle(
    @Body() body: CreateQueueDto,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.routeService.clockInVehicle(body, saccoId);
  }

  // ── GET /routes/queue/available ──────────────────────────────────────────
  @Get('queue/available')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findAvailableVehicles(
    @Query('routeId', ParseUUIDPipe) routeId: string,
    @Query('date') dateString?: string,
  ) {
    const targetDate = dateString ? new Date(dateString) : new Date();
    return this.routeService.findAvailableVehiclesForRoute(routeId, targetDate);
  }

  // ── GET /routes/queue ────────────────────────────────────────────────────
  // Example: GET /routes/queue?routeId=uuid&status=WAITING&date=2026-07-09
  @Get('queue')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findAllQueueEntries(
    @Query('routeId') routeId?: string,
    @Query('status') status?: QueueStatus,
    @Query('date') dateString?: string,
  ) {
    return this.routeService.findAllQueueEntries({
      routeId,
      status,
      date: dateString ? new Date(dateString) : undefined,
    });
  }

  // ── GET /routes/queue/:id ────────────────────────────────────────────────
  @Get('queue/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findOneQueueEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.routeService.findOneQueueEntry(id);
  }

  // ── PATCH /routes/queue/:id ──────────────────────────────────────────────
  @Patch('queue/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  @HttpCode(HttpStatus.OK)
  updateQueueEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateQueueDto,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.routeService.updateQueueEntry(id, body, saccoId);
  }

  // ── DELETE /routes/queue/:id ─────────────────────────────────────────────
  @Delete('queue/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.OK)
  removeVehicleFromQueue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.routeService.removeVehicleFromQueue(id, saccoId);
  }

  // =========================================================================
  // ─── DYNAMIC ':id' ROUTE ENDPOINTS ───────────────────────────────────────
  // Must come AFTER all literal-prefixed routes above.
  // =========================================================================

  // ── GET /routes/:id ───────────────────────────────────────────────────────

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.routeService.findOneScoped(id, saccoId);
  }

  // ── PATCH /routes/:id ─────────────────────────────────────────────────────

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRouteDto,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.routeService.update(id, body, saccoId);
  }

  // ── POST /routes/:id/stages ───────────────────────────────────────────────

  @Post(':id/stages')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.OK)
  addStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('stage') stage: string,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.routeService.addStage(id, stage, saccoId);
  }

  // ── DELETE /routes/:id/stages/:stage ──────────────────────────────────────

  @Delete(':id/stages/:stage')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.OK)
  removeStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stage') stage: string,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.routeService.removeStage(id, stage, saccoId);
  }
}