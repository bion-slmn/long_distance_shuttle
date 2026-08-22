// src/booking/dto/create-booking.dto.ts
import {
    IsUUID,
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEnum,
    IsDateString,
    IsEmail,
    Matches,
} from 'class-validator';
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

    // Used for OTP-based "My Tickets" lookup — required so guests can retrieve
    // their bookings later without an account.
    @IsEmail({}, { message: 'passengerEmail must be a valid email address.' })
    declare passengerEmail: string;

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
    @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'preferredBoardingFrom must be HH:mm or HH:mm:ss' })
    preferredBoardingFrom?: string;

    @IsOptional()
    @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'preferredBoardingTo must be HH:mm or HH:mm:ss' })
    preferredBoardingTo?: string;
}