// src/sacco/dto/update-sacco-settings.dto.ts
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateSaccoSettingsDto {
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    commissionRate?: number;

    @IsOptional()
    @IsBoolean()
    isAcceptingBookings?: boolean;

    @IsOptional()
    @IsBoolean()
    acceptsCash?: boolean;
}