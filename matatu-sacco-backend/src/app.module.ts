import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // ◄ Import the Config Module
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SaccoModule } from './sacco/sacco.module';
import { FleetModule } from './fleet/fleet.module';
import { RouteModule } from './route/route.module';
import { BookingModule } from './booking/booking.module';
import { PaymentModule } from './payment/payment.module';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './guards/roles.guard';
import { APP_GUARD } from '@nestjs/core';
import { TripModule } from './trip/trip.module';

@Module({
  imports: [
    // 1. Load the environment variables globally across the app
    ConfigModule.forRoot({
      isGlobal: true, // Makes variables accessible in any other module without re-importing
    }),

    // 2. Dynamically feed env variables into the TypeORM configuration
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10), username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: true, // Set to false in production to prevent unexpected data wiping!
    }),

    SaccoModule,
    FleetModule,
    BookingModule,
    PaymentModule,
    AuthModule,
    RouteModule,
    TripModule,
  ],
  controllers: [AppController],
  providers: [AppService, {
    provide: APP_GUARD,
    useClass: RolesGuard,
  },],
})
export class AppModule { }