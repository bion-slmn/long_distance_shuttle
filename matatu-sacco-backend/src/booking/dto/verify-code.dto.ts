import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyCodeDto {
    @IsEmail()
    declare email: string;

    @IsString() @Length(6, 6)
    declare code: string;
}
