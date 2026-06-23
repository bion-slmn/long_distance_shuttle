import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm'; // ◄ Import TypeOrmModule
import { Sacco } from './entities/sacco.entity'; // ◄ Import your Sacco entity
import { SaccoService } from './sacco.service';
import { SaccoController } from './sacco.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([Sacco]),
    ],
    controllers: [SaccoController], // Your SaccoController will go here later
    providers: [SaccoService],   // Your SaccoService will go here later
    exports: [TypeOrmModule], // Export it if other modules (like Fleet) need to look up Saccos
})
export class SaccoModule { }