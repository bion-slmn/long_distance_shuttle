// src/trips/dto/create-trip.dto.ts
import {
    IsEnum,
    IsNumber,
    IsOptional,
    IsUUID,
    Min,
    Max,
    IsDateString,
    IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TripStatus } from '../entities/trip.entity';

export class CreateTripDto {
    @IsUUID()
    declare saccoId: string;

    @IsUUID()
    declare routeId: string;

    @IsUUID()
    declare vehicleId: string;

    @IsOptional()
    @IsUUID()
    driverId?: string;

    @IsOptional()
    @IsUUID()
    queueEntryId?: string;

    @IsOptional()
    @IsDateString()
    departureTime?: Date;

    @IsOptional()
    @IsDateString()
    completedAt?: Date;

    @IsNumber()
    @Min(0)
    @Max(999999.99)
    @Type(() => Number)
    declare fare: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(9999)
    @Type(() => Number)
    passengerCount?: number;

    @IsOptional()
    @IsEnum(TripStatus)
    status?: TripStatus;
}