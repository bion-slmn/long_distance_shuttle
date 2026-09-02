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
import { PaymentReconcileSweeper } from './payment-reconcile.sweeper';
import { MpesaC2bRegistrationListener } from './mpesa/mpesa-c2b-registration.listener';

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
    // The sweeper is registered alongside the processor for the same reason
    // the comment above exists: a reconcile component that is written but not
    // provided fails silently. It is deliberately NOT part of the processor —
    // the processor is the thing that stops working when Redis is unavailable,
    // and the sweeper is the thing that has to notice.
    providers: [PaymentService, MpesaService, PaymentReconcileProcessor, PaymentReconcileSweeper, MpesaC2bRegistrationListener],
    exports: [PaymentService],
})
export class PaymentModule { }