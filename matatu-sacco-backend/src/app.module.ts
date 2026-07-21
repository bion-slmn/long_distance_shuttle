import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // ◄ Import the Config Module
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SaccoModule } from './sacco/sacco.module';
import { FleetModule } from './fleet/fleet.module';
import { RouteModule } from './route/route.module';
import { PaymentModule } from './payment/payment.module';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './guards/roles.guard';
import { APP_GUARD } from '@nestjs/core';
import { TripModule } from './trip/trip.module';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { BookingModule } from './booking/booking.module';

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
    PassportModule.register({ defaultStrategy: 'jwt' }),  // ← add

    SaccoModule,
    FleetModule,
    BookingModule,
    PaymentModule,
    AuthModule,
    RouteModule,
    TripModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    JwtStrategy,          // ← register globally
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,  // ← runs first on every route
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,    // ← runs second, user already set
    },
  ],
})
export class AppModule { }