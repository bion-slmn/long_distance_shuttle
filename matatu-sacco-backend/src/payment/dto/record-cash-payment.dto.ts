// src/payment/dto/record-cash-payment.dto.ts
import { IsString, IsNotEmpty, IsNumber, Min, IsEnum } from 'class-validator';
import { PaymentReferenceType } from '../entities/payment.entity';

export class RecordCashPaymentDto {
    @IsEnum(PaymentReferenceType)
    declare referenceType: PaymentReferenceType;

    @IsString()
    @IsNotEmpty()
    declare referenceId: string;

    @IsString()
    @IsNotEmpty()
    declare saccoId: string;

    @IsNumber()
    @Min(1)
    declare amount: number;
}