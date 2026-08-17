// src/sacco/dto/configure-mpesa.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class ConfigureMpesaDto {
    @IsString()
    @IsNotEmpty()
    declare shortcode: string; // till/paybill number

    @IsString()
    @IsNotEmpty()
    declare consumerKey: string;

    @IsString()
    @IsNotEmpty()
    declare consumerSecret: string;

    @IsString()
    @IsNotEmpty()
    declare passkey: string;
}