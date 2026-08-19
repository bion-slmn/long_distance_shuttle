import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config'; // ◄ Import the Config Module
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
import { RedisModule } from './redis/redis.module';
import { MetricsModule } from './metrics/metrics.module';
import { HealthModule } from './health/health.module';

import { EventEmitterModule } from '@nestjs/event-emitter';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    // 1. Load the environment variables globally across the app
    ConfigModule.forRoot({
      isGlobal: true, // Makes variables accessible in any other module without re-importing
    }),

    // 2. Dynamically feed env variables into the TypeORM configuration
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');

        if (databaseUrl) {
          // Render / Neon / Supabase - managed Postgres via full connection URL
          return {
            type: 'postgres' as const,
            url: databaseUrl,
            ssl: { rejectUnauthorized: false }, // Render Postgres requires SSL
            autoLoadEntities: true,
            synchronize: false,
          };
        }

        // Local dev fallback (docker-compose)
        return {
          type: 'postgres' as const,
          host: config.get<string>('DB_HOST'),
          port: config.get<number>('DB_PORT'),
          username: config.get<string>('DB_USERNAME'),
          password: config.get<string>('DB_PASSWORD'),
          database: config.get<string>('DB_NAME'),
          autoLoadEntities: true,
          synchronize: false,
        };
      },
    }),

    PassportModule.register({ defaultStrategy: 'jwt' }),  // ← add
    EventEmitterModule.forRoot(),
    SaccoModule,
    FleetModule,
    BookingModule,
    AuthModule,
    RouteModule,
    TripModule,
    RedisModule,
    PaymentModule,
    MetricsModule, HealthModule, EmailModule,
  ],
  controllers: [AppController,],
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