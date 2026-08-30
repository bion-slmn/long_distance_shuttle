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
import { MpesaTransaction } from './entities/mpesa.entity';
import { BullModule } from '@nestjs/bullmq';
import { PaymentReconcileProcessor } from './payment-reconcile.processor';

@Module({
    imports: [
        HttpModule,
        SaccoModule,
        TypeOrmModule.forFeature([Payment, MpesaTransaction]),
        BullModule.registerQueue({ name: 'payment-reconcile' }),

    ],
    controllers: [PaymentController, MpesaController],
    // The processor is what CONSUMES payment-reconcile. Without it registered
    // here the queue still accepts jobs — they just sit in `delayed` forever,
    // and the "nothing stays PROCESSING forever" guarantee the reconcile
    // ladder is built on silently does not hold.
    providers: [PaymentService, MpesaService, PaymentReconcileProcessor],
    exports: [PaymentService],
})
export class PaymentModule { }