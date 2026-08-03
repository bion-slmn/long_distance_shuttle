// trip.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  ParseEnumPipe,
  Optional,
  UseGuards,
} from '@nestjs/common';
import { TripService } from './trip.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripStatus } from './entities/trip.entity';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserRole } from 'src/auth/entities/user.entity';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { RolesGuard } from 'src/guards/roles.guard';
import { Roles } from 'src/decorators/roles.decorator';

@Controller('trips')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TripController {
  constructor(private readonly tripService: TripService) { }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  create(@Body() createTripDto: CreateTripDto) {
    return this.tripService.create(createTripDto);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findAll(
    @CurrentUser() user: any,
    @Query('routeId') routeId?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('status', new ParseEnumPipe(TripStatus, { optional: true })) status?: TripStatus,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('date') date?: string,
    @Query('plateNumber') plateNumber?: string,
  ) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;

    return this.tripService.findAll({
      saccoId: isSuperAdmin ? undefined : user.saccoId,
      isSuperAdmin,
      routeId,
      vehicleId,
      status,
      page,
      limit,
      date: date ? new Date(date) : undefined,
      plateNumber,
    });
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTripDto: UpdateTripDto,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.tripService.update(id, updateTripDto, saccoId);
  }

  @Patch(':id/passenger-count')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  updatePassengerCount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('passengerCount', ParseIntPipe) passengerCount: number,
    @CurrentUser() user: any,
  ) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.tripService.updatePassengerCount(id, passengerCount, saccoId);
  }

  @Patch(':id/depart')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  markDeparted(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.tripService.markDeparted(id, saccoId);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.tripService.cancel(id, saccoId);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.tripService.remove(id, saccoId);
  }

  // ── Stats ──────────────────────────────────────────────────────────────
  // SUPER_ADMIN with no query param → fleet-wide (saccoId stays undefined)
  // SACCO_ADMIN / CLERK → always forced to their own sacco, query param ignored

  @Get('stats/trip-count-summary')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  getTripCountSummary(@CurrentUser() user: any) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.tripService.getTripCountSummary(isSuperAdmin ? undefined : user.saccoId);
  }

  @Get('stats/average-trips-per-vehicle')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  getAverageTripsPerVehicleSummary(@CurrentUser() user: any) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.tripService.getAverageTripsPerVehicleSummary(isSuperAdmin ? undefined : user.saccoId);
  }

  // trip.controller.ts
  @Get('stats/trip-trend')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  getTripTrend(
    @CurrentUser() user: any,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.tripService.getTripTrend(days ?? 7, isSuperAdmin ? undefined : user.saccoId);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    const saccoId = user.role === UserRole.SUPER_ADMIN ? undefined : user.saccoId;
    return this.tripService.findOneScoped(id, saccoId);
  }
}