// src/booking/dto/create-booking.dto.ts
import {
    IsUUID,
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEnum,
    IsDateString,
    IsEmail,
    IsInt,
    Min,
    Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BookingSource, BookingStatus, PaymentMethod } from '../entities/booking.entity';

export class CreateBookingDto {

    @IsOptional()
    @IsUUID()
    bookingId?: string; // present on retry



    @IsUUID()
    declare routeId: string;

    // YYYY-MM-DD — optional, defaults to today on the service side if omitted.
    @IsOptional()
    @IsDateString({ strict: true }, { message: 'travelDate must be in YYYY-MM-DD format.' })
    travelDate?: string;

    @IsString()
    @IsNotEmpty({ message: 'Passenger name is required.' })
    declare passengerName: string;

    // Loose Kenyan phone format check — accepts 07XXXXXXXX, 01XXXXXXXX,
    // or +2547XXXXXXXX / +2541XXXXXXXX. Adjust the regex if you need to
    // support other formats.
    @IsString()
    @Matches(/^(?:\+254|0)(7|1)\d{8}$/, {
        message: 'passengerPhone must be a valid Kenyan phone number (e.g. 0712345678).',
    })
    declare passengerPhone: string;

    // Optional. Walk-in passengers booked by a clerk usually have only a
    // phone; email is what lets a passenger use the OTP "My Tickets" lookup
    // later, so the public form asks for it but nothing requires it. An
    // empty string (a blank form field) is treated as absent.
    @IsOptional()
    @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
    @IsEmail({}, { message: 'passengerEmail must be a valid email address.' })
    passengerEmail?: string;

    @IsEnum(PaymentMethod)
    declare paymentMethod: PaymentMethod;

    // Set server-side from the authenticated clerk/user when present —
    // not required on public/no-login bookings.
    @IsOptional()
    @IsUUID()
    createdByUserId?: string;

    @IsOptional()
    @IsEnum(BookingStatus)
    status?: BookingStatus;


    @IsOptional()
    @IsEnum(BookingSource)
    declare source?: BookingSource;

    @IsOptional()
    mpesaTransactionId?: string;


    @IsOptional()
    @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'preferredBoardingFrom must be HH:mm or HH:mm:ss' })
    preferredBoardingFrom?: string;

    @IsOptional()
    @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'preferredBoardingTo must be HH:mm or HH:mm:ss' })
    preferredBoardingTo?: string;

    // Only meaningful when source === CLERK — the service ignores this on
    // any other source, so a public-portal caller sending a seatNumber has
    // no effect. Range against the actual vehicle's capacity can't be
    // validated here (the DTO doesn't know the trip yet); that check happens
    // in BookingService.resolveClerkRequestedSeat once the trip is locked.
    @IsOptional()
    @IsInt({ message: 'seatNumber must be a whole number.' })
    @Min(1, { message: 'seatNumber must be 1 or greater.' })
    seatNumber?: number;
}