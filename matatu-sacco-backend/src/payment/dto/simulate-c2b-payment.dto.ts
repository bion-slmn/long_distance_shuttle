// src/payment/dto/simulate-c2b-payment.dto.ts
import { IsNumber, IsOptional, IsString, IsNotEmpty, Matches, MaxLength, Min } from 'class-validator';

// Sandbox-only: drives Daraja's C2B simulate endpoint so a "customer paid
// the paybill directly" flow can be tested end to end from our own API.
export class SimulateC2BPaymentDto {
    @IsNumber()
    @Min(1, { message: 'Amount must be at least KES 1.' })
    declare amount: number;

    // What the customer would type as the account number. This is what
    // lands in BillRefNumber on the confirmation, so use the same value a
    // real passenger would (e.g. a route code or booking ref).
    @IsString()
    @IsNotEmpty()
    @MaxLength(20)
    declare billRefNumber: string;

    // Defaults to Daraja's sandbox test MSISDN. Only 2547XXXXXXXX /
    // 2541XXXXXXXX are accepted by the simulate endpoint.
    @IsOptional()
    @IsString()
    @Matches(/^254(7|1)\d{8}$/, {
        message: 'msisdn must be in 2547XXXXXXXX format.',
    })
    declare msisdn?: string;
}
