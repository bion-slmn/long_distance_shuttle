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
  BadRequestException,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { OtpService } from './otp.service';
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
import { JwtService } from '@nestjs/jwt';
import { TicketsAuthGuard } from 'src/guards/tickets-auth.guard';
import { TicketEmail } from 'src/decorators/ticket-email.decorator';

@Controller('bookings')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
  ) { }

  // ── PUBLIC: booking creation ──────────────────────────────────────────
  @Public()
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookingService.create(dto);
  }

  // ── PUBLIC: seat availability check ──────────────────────────────────
  @Public()
  @Get('availability')
  getAvailability(
    @Query('routeId', new ParseUUIDPipe()) routeId: string,
    @Query('travelDate') travelDate?: string,
  ) {
    return this.bookingService.getAvailability(routeId, travelDate);
  }

  // ── STAFF ONLY below this line ────────────────────────────────────────

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

  // ── PUBLIC: ticket lookup via email + OTP ────────────────────────────

  @Post('tickets/request-code')
  @Public()
  async requestCode(@Body('email') email: string) {
    if (!email) throw new BadRequestException('Email is required');

    const exists = await this.bookingService.hasBookingForEmail(email);
    console.log({ exists })
    if (exists) {
      await this.otpService.requestCode(email);
    }
    // Same generic response either way — don't reveal whether an email
    // has bookings, avoids leaking that info to someone probing emails.
    return { message: 'If that email has bookings, a code has been sent.' };
  }

  @Post('tickets/verify-code')
  @Public()
  async verifyCode(@Body() body: { email: string; code: string }) {
    const valid = await this.otpService.verifyCode(body.email, body.code);
    if (!valid) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    // Short-lived token, scoped only to this email — not a full login session
    const token = this.jwtService.sign(
      { email: body.email.trim().toLowerCase(), scope: 'tickets' },
      { expiresIn: '30m' },
    );
    return { access_token: token };
  }

  @Get('tickets/my-tickets')
  @UseGuards(TicketsAuthGuard)
  async getMyTickets(@TicketEmail() email: string) {
    return this.bookingService.findByEmail(email);
  }

  // ── GET /bookings/:id ──────────────────────────────────────────────────
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

  // ── PATCH /bookings/:id ────────────────────────────────────────────────
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

  // ── DELETE /bookings/:id → soft "delete" = CANCELLED ────────────────────
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