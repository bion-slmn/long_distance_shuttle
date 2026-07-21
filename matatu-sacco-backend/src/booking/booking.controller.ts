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
  Req,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { BookingStatus } from './entities/booking.entity';

@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  // POST /bookings
  // Creates a booking against a route/date. Slots into an open BOARDING
  // trip if one exists with room; otherwise banks it as AWAITING_TRIP.
  @Post()
  create(@Body() dto: CreateBookingDto, @Req() req: any) {
    // req.user assumed populated by an auth guard elsewhere in the app —
    // adjust/remove if you haven't wired that up yet.
    const createdByUserId = req.user?.id ?? dto.createdByUserId;
    return this.bookingService.create({ ...dto, createdByUserId });
  }

  // GET /bookings?routeId=&travelDate=&status=&tripId=&saccoId=
  @Get()
  findAll(
    @Query('saccoId') saccoId?: string,
    @Query('routeId') routeId?: string,
    @Query('travelDate') travelDate?: string,
    @Query('status') status?: BookingStatus,
    @Query('tripId') tripId?: string,
  ) {
    return this.bookingService.findAll({ saccoId, routeId, travelDate, status, tripId });
  }

  // GET /bookings/availability?routeId=&travelDate=
  // Seat-count-only availability — no seat map, just numbers, matching
  // the "no seat map available" decision.
  @Get('availability')
  getAvailability(
    @Query('routeId', new ParseUUIDPipe()) routeId: string,
    @Query('travelDate') travelDate?: string,
  ) {
    return this.bookingService.getAvailability(routeId, travelDate);
  }

  // GET /bookings/:id
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookingService.findOne(id);
  }

  // PATCH /bookings/:id
  // General status transitions (e.g. mark BOARDED). Cancellation has its
  // own endpoint below since it has different rules (refund handling).
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBookingDto,
    @Query('saccoId') saccoId?: string,
  ) {
    return this.bookingService.update(id, dto, saccoId);
  }

  // PATCH /bookings/:id/confirm-payment
  // Called by your M-Pesa Daraja callback handler (or a clerk confirming
  // cash) — separate from generic update() because it also touches
  // mpesaReceiptNumber/mpesaCheckoutRequestId.
  @Patch(':id/confirm-payment')
  confirmPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.bookingService.confirmPayment(id, dto);
  }

  // PATCH /bookings/:id/payment-failed
  @Patch(':id/payment-failed')
  markPaymentFailed(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookingService.markPaymentFailed(id);
  }

  // DELETE /bookings/:id  → soft "delete" = CANCELLED, never a hard delete,
  // since this is financial/reconciliation data.
  @Delete(':id')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('saccoId') saccoId?: string,
  ) {
    return this.bookingService.cancel(id, saccoId);
  }
}