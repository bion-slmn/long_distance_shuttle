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
} from '@nestjs/common';
import { TripService } from './trip.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripStatus } from './entities/trip.entity';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserRole } from 'src/auth/entities/user.entity';


@Controller('trips')
export class TripController {
  constructor(private readonly tripService: TripService) { }

  @Post()
  create(@Body() createTripDto: CreateTripDto) {
    return this.tripService.create(createTripDto);
  }

  @Get()
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

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.tripService.findOneScoped(id, user.saccoId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTripDto: UpdateTripDto,
    @CurrentUser() user: any,
  ) {
    return this.tripService.update(id, updateTripDto, user.saccoId);
  }

  @Patch(':id/passenger-count')
  updatePassengerCount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('passengerCount', ParseIntPipe) passengerCount: number,
    @CurrentUser() user: any,
  ) {
    return this.tripService.updatePassengerCount(id, passengerCount, user.saccoId);
  }

  @Patch(':id/depart')
  markDeparted(@Param('id', ParseUUIDPipe) id: string) {
    return this.tripService.markDeparted(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.tripService.cancel(id, user.saccoId);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.tripService.remove(id, user.saccoId);
  }
}