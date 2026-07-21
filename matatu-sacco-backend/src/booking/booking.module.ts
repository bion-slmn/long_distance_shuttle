import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Trip } from 'src/trip/entities/trip.entity';
import { Route } from 'src/route/entities/route.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Trip, Route]),

  ],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule { }
