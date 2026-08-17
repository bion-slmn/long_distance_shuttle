// src/payment/dto/initiate-stk-push.dto.ts
import {
    IsString,
    IsNotEmpty,
    IsNumber,
    Min,
    Matches,
    MaxLength,
    IsOptional,
} from 'class-validator';

export class InitiateStkPushDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^(?:\+254|0)(7|1)\d{8}$/, {
        message: 'Enter a valid Kenyan phone number (e.g. 0712345678).',
    })
    declare payerPhone: string;

    @IsNumber()
    @Min(1, { message: 'Amount must be at least KES 1.' })
    declare amount: number;

    // Booking short ref (or similar) — shown on the STK prompt, capped by Daraja.
    @IsString()
    @IsNotEmpty()
    @MaxLength(12, { message: 'Account reference must be 12 characters or fewer.' })
    declare accountReference: string;

    @IsOptional()
    @IsString()
    @MaxLength(13) // Daraja's TransactionDesc limit
    declare description?: string;
}