// src/payment/dto/initiate-mpesa-payment.dto.ts
import { IsString, IsNotEmpty, IsNumber, Min, Matches, MaxLength, IsEnum } from 'class-validator';
import { PaymentReferenceType } from '../entities/payment.entity';

export class InitiateMpesaPaymentDto {
    @IsEnum(PaymentReferenceType)
    declare referenceType: PaymentReferenceType;

    @IsString()
    @IsNotEmpty()
    declare referenceId: string; // e.g. bookingId

    @IsString()
    @IsNotEmpty()
    declare saccoId: string;

    @IsNumber()
    @Min(1)
    declare amount: number;

    @IsString()
    @Matches(/^(?:\+254|0)(7|1)\d{8}$/, {
        message: 'Enter a valid Kenyan phone number (e.g. 0712345678).',
    })
    declare payerPhone: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(12)
    declare accountReference: string;
}