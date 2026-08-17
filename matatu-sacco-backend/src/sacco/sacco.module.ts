import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sacco } from './entities/sacco.entity';
import { SaccoService } from './sacco.service';
import { SaccoController } from './sacco.controller';
import { AuthModule } from '../auth/auth.module';
import { TripModule } from 'src/trip/trip.module';
import { SaccoSettings } from './entities/sacco-settings.entity';
import { SaccoSettingsController } from './sacco-settings.controller';
import { SaccoSettingsService } from './sacco-settings.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([Sacco, SaccoSettings]),
        AuthModule, TripModule,     // ← add this
    ],
    controllers: [SaccoController, SaccoSettingsController],
    providers: [SaccoService, SaccoSettingsService],
    exports: [TypeOrmModule, SaccoSettingsService],
})
export class SaccoModule { }