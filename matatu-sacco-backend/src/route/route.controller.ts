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
} from '@nestjs/common';
import { RouteService, CreateRouteDto, UpdateRouteDto } from './route.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../auth/entities/user.entity';

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

  // ── POST /routes/:id/stops ────────────────────────────────────────────────

  @Post(':id/stops')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.OK)
  addStop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('stop') stop: string,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.routeService.addStop(id, stop, saccoId);
  }

  // ── DELETE /routes/:id/stops/:stop ────────────────────────────────────────

  @Delete(':id/stops/:stop')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  @HttpCode(HttpStatus.OK)
  removeStop(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stop') stop: string,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN
      ? undefined
      : user.saccoId;

    return this.routeService.removeStop(id, stop, saccoId);
  }
}