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

@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) { }

  // ── PUBLIC: booking creation ──────────────────────────────────────────
  // Deliberately NOT guarded — a passenger booking a seat has no account
  // and no JWT. createdByUserId stays optional/null for these; it's only
  // populated when a CLERK creates a booking on a passenger's behalf
  // (walk-in booking), which is why we still try req.user first.
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookingService.create(dto);
  }

  // ── PUBLIC: seat availability check ──────────────────────────────────
  // A passenger needs to see open seats *before* they have any booking or
  // account, so this has to stay open too.
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

  // GET /bookings?routeId=&travelDate=&status=&tripId=
  // saccoId is derived from the authenticated user, never from the query
  // string — same fix as TripController.findAll.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN, UserRole.CLERK)
  findAll(
    @CurrentUser() user: any,
    @Query('routeId') routeId?: string,
    @Query('travelDate') travelDate?: string,
    @Query('status') status?: BookingStatus,
    @Query('tripId') tripId?: string,
  ) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.bookingService.findAll({
      saccoId: isSuperAdmin ? undefined : user.saccoId,
      routeId,
      travelDate,
      status,
      tripId,
    });
  }

  @Get('stats/unique-passengers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.SACCO_ADMIN)
  getUniquePassengerStats(@CurrentUser() user: any) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    return this.bookingService.getUniquePassengerStats(isSuperAdmin ? undefined : user.saccoId);
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

  // ── PATCH /bookings/:id/confirm-payment ───────────────────────────────
  // ⚠️ This is called by the M-Pesa Daraja callback, which is a server-to-
  // server webhook — it will never carry a user JWT. Putting JwtAuthGuard
  // here would break the real payment flow, not secure it.
  // Instead this needs its OWN verification: either an M-Pesa-signed
  // payload check, a shared secret header, or restricting by source IP
  // at the infra/load-balancer level. Do NOT leave this endpoint
  // completely open with no check at all — right now it has none, which
  // means anyone who finds the URL could mark any booking as PAID.
  // Placeholder shown below; replace with your actual Daraja verification.
  @Patch(':id/confirm-payment')
  confirmPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmPaymentDto,
    @Headers('x-mpesa-signature') signature?: string,
  ) {
    // TODO: verify `signature` against Daraja's callback payload before
    // trusting this. Failing that, at minimum require a pre-shared secret
    // header set only in your Daraja callback URL config.
    if (!signature) {
      throw new UnauthorizedException('Missing payment callback signature.');
    }
    return this.bookingService.confirmPayment(id, dto);
  }

  // PATCH /bookings/:id/payment-failed
  // Same concern as confirm-payment — this can be triggered by the Daraja
  // callback on failure, so it needs the same webhook-level protection,
  // not a user JWT guard.
  @Patch(':id/payment-failed')
  markPaymentFailed(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-mpesa-signature') signature?: string,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing payment callback signature.');
    }
    return this.bookingService.markPaymentFailed(id);
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