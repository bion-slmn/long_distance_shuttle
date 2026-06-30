import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sacco } from './entities/sacco.entity';
import { SaccoService } from './sacco.service';
import { SaccoController } from './sacco.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Sacco]),
        AuthModule,              // ← gives JwtStrategy to this module
    ],
    controllers: [SaccoController],
    providers: [SaccoService],
    exports: [TypeOrmModule],
})
export class SaccoModule { }