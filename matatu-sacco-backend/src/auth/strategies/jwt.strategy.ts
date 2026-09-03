import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(private readonly configService: ConfigService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
    }

    async validate(payload: any) {
        // A valid signature is not enough. Reject anything that isn't a
        // staff/passenger access token: refresh tokens (typ), ticket-session
        // tokens (scope), and anything with no subject at all.
        if (!payload?.sub || payload.typ === 'refresh' || payload.scope) {
            throw new UnauthorizedException('Access token required.');
        }

        return {
            sub: payload.sub,
            email: payload.email,
            phone: payload.phone,
            role: payload.role,
            saccoId: payload.saccoId,
            assignedStage: payload.assignedStage,
        };
    }
}