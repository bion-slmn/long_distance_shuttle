// src/payment/dto/payment-query.dto.ts
import { IsOptional, IsDateString, IsEnum } from 'class-validator';
import { PaymentStatus, PaymentMethod } from '../entities/payment.entity';

export class PaymentQueryDto {
    @IsOptional()
    @IsDateString()
    declare from?: string; // e.g. 2026-08-01

    @IsOptional()
    @IsDateString()
    declare to?: string; // e.g. 2026-08-14

    @IsOptional()
    @IsEnum(PaymentStatus)
    declare status?: PaymentStatus;

    @IsOptional()
    @IsEnum(PaymentMethod)
    declare method?: PaymentMethod;
}