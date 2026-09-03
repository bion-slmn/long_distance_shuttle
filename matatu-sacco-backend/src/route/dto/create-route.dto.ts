// src/route/dto/create-route.dto.ts
import {
    IsArray,
    IsBoolean,
    IsDate,
    IsDefined,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// Decorated because the global ValidationPipe strips undeclared fields.
export class CreateRouteDto {
    @IsString() @IsNotEmpty() @MaxLength(100)
    declare origin: string;

    @IsString() @IsNotEmpty() @MaxLength(100)
    declare destination: string;

    @IsString() @MaxLength(500)
    declare description: string;

    @IsOptional() @IsArray() @IsString({ each: true })
    declare stages?: string[];

    // Overwritten from the caller's token for SACCO_ADMIN; only SUPER_ADMIN
    // supplies it.
    @IsOptional() @IsUUID()
    declare saccoId: string;

    // Clients send a number, older ones a numeric string; the service
    // normalises. Only presence is enforced here.
    @IsDefined()
    declare fare: string

    @IsOptional() @IsBoolean()
    declare createReturnLeg?: boolean;
}

export class CreateQueueDto {
    @IsUUID()
    declare routeId: string;

    @IsUUID()
    declare vehicleId: string;

    @IsOptional() @Type(() => Date) @IsDate()
    declare clockedInAt?: Date;

    // "Clock in and open the bay" in one call. Honoured only when nothing is
    // boarding on this route yet; otherwise the vehicle just joins the queue.
    // See RouteQueueService.clockInVehicle.
    @IsOptional() @IsBoolean()
    declare startBoarding?: boolean;
}
