// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaymentController } from './payment.controller';
import { MpesaController } from './mpesa/mpesa.controller';
import { MpesaService } from './mpesa/mpesa.service';
import { SaccoModule } from '../sacco/sacco.module'; // wherever SaccoSettingsService lives
import { PaymentService } from './payment.service';
import { Payment } from './entities/payment.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
    imports: [
        HttpModule,
        SaccoModule,
        TypeOrmModule.forFeature([Payment]),

    ],
    controllers: [PaymentController, MpesaController],
    providers: [PaymentService, MpesaService],
    exports: [PaymentService],
})
export class PaymentModule { }