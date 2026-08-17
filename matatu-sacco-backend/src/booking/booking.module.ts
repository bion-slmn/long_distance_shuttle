import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Trip } from 'src/trip/entities/trip.entity';
import { Route } from 'src/route/entities/route.entity';
import { PaymentModule } from 'src/payment/payment.module';
import { PaymentEventsListener } from './listeners/payment-events.listener';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Trip, Route]),
    PaymentModule,

  ],
  controllers: [BookingController],
  providers: [BookingService, PaymentEventsListener],
  exports: [BookingService],
})
export class BookingModule { }
