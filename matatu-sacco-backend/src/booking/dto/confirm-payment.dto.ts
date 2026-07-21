// src/booking/dto/confirm-payment.dto.ts
import { IsOptional, IsString } from 'class-validator';

export class ConfirmPaymentDto {
  @IsOptional()
  @IsString()
  mpesaReceiptNumber?: string;

  @IsOptional()
  @IsString()
  mpesaCheckoutRequestId?: string;
}