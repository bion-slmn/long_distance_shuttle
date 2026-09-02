// src/payment/dto/get-transactions-by-phone.dto.ts
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

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

    // SUPER_ADMIN only: narrow to one sacco. Everyone else is always scoped
    // to their own sacco regardless of what they send here.
    @IsOptional()
    @IsUUID()
    saccoId?: string;
}