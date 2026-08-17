// src/booking/booking.controller.ts
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
  UseGuards,
  ForbiddenException,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { BookingStatus } from './entities/booking.entity';
import { JwtAuthGuard } from 'src/guards/jwt-auth.guard';
import { RolesGuard } from 'src/guards/roles.guard';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserRole } from 'src/auth/entities/user.entity';
import { Roles } from 'src/decorators/roles.decorator';
import { Public } from 'src/decorators/public.decorator';

@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) { }

  // ── PUBLIC: booking creation ──────────────────────────────────────────
  // Deliberately NOT guarded — a passenger booking a seat has no account
  // and no JWT. createdByUserId stays optional/null for these; it's only
  // populated when a CLERK creates a booking on a passenger's behalf
  // (walk-in booking), which is why we still try req.user first.
  @Public()
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookingService.create(dto);
  }

  // ── PUBLIC: seat availability check ──────────────────────────────────
  // A passenger needs to see open seats *before* they have any booking or
  // account, so this has to stay open too.
  @Public()
  @Get('availability')
  getAvailability(
    @Query('routeId', new ParseUUIDPipe()) routeId: string,
    @Query('travelDate') travelDate?: string,
  ) {
    return this.bookingService.getAvailability(routeId, travelDate);
  }

  // ── STAFF ONLY below this line ────────────────────────────────────────
  // Listing bookings, viewing a specific booking, editing status, and
  // cancelling all expose passenger names/phones and payment state —
  // never safe to leave open to the public.

  // GET /bookings?saccoId=&routeId=&travelDate=&from=&to=&status=&tripId=&vehicleId=
  // saccoId is derived from the authenticated user for SACCO_ADMIN/CLERK —
  // never trusted from the query string for them. SUPER_ADMIN may pass
  // ?saccoId= to scope to one sacco, or omit it to see all saccos.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findAll(
    @CurrentUser() user: any,
    @Query('saccoId') saccoIdParam?: string,
    @Query('routeId') routeId?: string,
    @Query('travelDate') travelDate?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: BookingStatus,
    @Query('tripId') tripId?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.bookingService.findAll({
      saccoId: isSuperAdmin ? saccoIdParam : user.saccoId,
      routeId,
      travelDate,
      from,
      to,
      status,
      tripId,
      vehicleId,
    });
  }

  @Get('stats/unique-passengers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  getUniquePassengerStats(@CurrentUser() user: any) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.bookingService.getUniquePassengerStats(isSuperAdmin ? undefined : user.saccoId);
  }

  // ── PUBLIC: minimal status check for the passenger-facing polling loop ──
  // Deliberately returns a slim shape, not the full Booking — a passenger
  // only needs to know if payment resolved, not to re-fetch their own phone
  // number back. UUID alone is the "auth" here, same trust model as the
  // booking confirmation screen itself (knowledge of the id = you made it).
  @Public()
  @Get(':id/status')
  async getStatus(@Param('id', new ParseUUIDPipe()) id: string) {
    const booking = await this.bookingService.findOne(id);
    return {
      id: booking.id,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      seatNumber: booking.seatNumber,
      mpesaReceiptNumber: booking.mpesaReceiptNumber,
    };
  }


  // GET /bookings/:id
  // Staff-only. Scoped so a SACCO_ADMIN/CLERK can't fetch another sacco's
  // booking just by guessing/enumerating a UUID.
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  async findOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: any) {
    const booking = await this.bookingService.findOne(id);
    if (user.role !== UserRole.SUPER_ADMIN && booking.saccoId !== user.saccoId) {
      throw new ForbiddenException('Access denied to this booking.');
    }
    return booking;
  }

  // PATCH /bookings/:id
  // saccoId derived from user, not query — was previously trusting the
  // caller to pass the right one.
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBookingDto,
    @CurrentUser() user: any,
  ) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.bookingService.update(id, dto, isSuperAdmin ? undefined : user.saccoId);
  }

  // booking.controller.ts
  @Get('stats/today-passengers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  getTodayPassengerStats(
    @Query('saccoId') saccoId: string | undefined,
    @CurrentUser() user: any,
  ) {
    if (user.role === UserRole.SACCO_ADMIN) {
      if (!user.saccoId) {
        throw new ForbiddenException('You are not assigned to a sacco.');
      }
      saccoId = user.saccoId;
    }
    return this.bookingService.getTodayPassengerStats(saccoId);
  }


  // DELETE /bookings/:id → soft "delete" = CANCELLED
  // Staff-only, scoped from the user rather than the query string.
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: any) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.bookingService.cancel(id, isSuperAdmin ? undefined : user.saccoId);
  }

  // ── GET /bookings/earnings/today ──────────────────────────────────────
  @Get('earnings/today')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  getTodayEarnings(
    @Query('saccoId') saccoId: string | undefined,
    @CurrentUser() user: any,
  ) {
    if (user.role === UserRole.SACCO_ADMIN) {
      if (!user.saccoId) {
        throw new ForbiddenException('You are not assigned to a sacco.');
      }
      saccoId = user.saccoId;
    }
    return this.bookingService.getTodayEarnings(saccoId);
  }

  // ── GET /bookings/earnings/trend ──────────────────────────────────────
  @Get('earnings/trend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  getRevenueTrend(
    @Query('days') days: string | undefined,
    @Query('saccoId') saccoId: string | undefined,
    @CurrentUser() user: any,
  ) {
    if (user.role === UserRole.SACCO_ADMIN) {
      if (!user.saccoId) {
        throw new ForbiddenException('You are not assigned to a sacco.');
      }
      saccoId = user.saccoId;
    }
    return this.bookingService.getRevenueTrend(days ? Number(days) : 7, saccoId);
  }


}