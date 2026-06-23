import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {
    handleRequest(err: any, user: any) {
        if (err || !user) throw new UnauthorizedException('Refresh token required.');
        return user;
    }
}