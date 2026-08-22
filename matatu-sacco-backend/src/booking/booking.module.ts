import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Trip } from 'src/trip/entities/trip.entity';
import { Route } from 'src/route/entities/route.entity';
import { PaymentModule } from 'src/payment/payment.module';
import { PaymentEventsListener } from './listeners/payment-events.listener';
import { OtpService } from './otp.service';
import { RedisModule } from 'src/redis/redis.module'; // adjust path
import { EmailModule } from 'src/email/email.module'; // adjust path
import { SaccoModule } from 'src/sacco/sacco.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Trip, Route]),
    PaymentModule,
    RedisModule,
    EmailModule,
    SaccoModule
  ],
  controllers: [BookingController],
  providers: [BookingService, PaymentEventsListener, OtpService],
  exports: [BookingService],
})
export class BookingModule { }