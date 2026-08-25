// src/payment/dto/get-transactions-by-phone.dto.ts
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class GetTransactionsByPhoneDto {
    @IsString()
    declare phone: string;

    // ISO date strings, e.g. "2024-01-01"
    @IsOptional()
    @IsDateString()
    dateFrom?: string;

    @IsOptional()
    @IsDateString()
    dateTo?: string;
}