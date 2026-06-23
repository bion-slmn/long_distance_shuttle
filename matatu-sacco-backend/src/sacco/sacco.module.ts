import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm'; // ◄ Import TypeOrmModule
import { Sacco } from './entities/sacco.entity'; // ◄ Import your Sacco entity

@Module({
    imports: [
        TypeOrmModule.forFeature([Sacco]),
    ],
    controllers: [], // Your SaccoController will go here later
    providers: [],   // Your SaccoService will go here later
    exports: [TypeOrmModule], // Export it if other modules (like Fleet) need to look up Saccos
})
export class SaccoModule { }