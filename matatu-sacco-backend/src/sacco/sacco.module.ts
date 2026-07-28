import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sacco } from './entities/sacco.entity';
import { SaccoService } from './sacco.service';
import { SaccoController } from './sacco.controller';
import { AuthModule } from '../auth/auth.module';
import { TripModule } from 'src/trip/trip.module';
import { BookingModule } from 'src/booking/booking.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Sacco]),
        AuthModule, TripModule,     // ← add this
        BookingModule,               // ← gives JwtStrategy to this module
    ],
    controllers: [SaccoController],
    providers: [SaccoService],
    exports: [TypeOrmModule],
})
export class SaccoModule { }