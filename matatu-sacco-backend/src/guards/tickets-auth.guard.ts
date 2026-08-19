// src/guards/tickets-auth.guard.ts
import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class TicketsAuthGuard implements CanActivate {
    constructor(private jwtService: JwtService) { }

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedException('No ticket session provided.');
        }

        const token = authHeader.slice(7);

        let payload: any;
        try {
            payload = this.jwtService.verify(token);
        } catch {
            throw new UnauthorizedException('Invalid or expired ticket session.');
        }

        if (payload.scope !== 'tickets') {
            throw new UnauthorizedException('Invalid ticket session.');
        }

        // Attach to request so the controller can read it via a decorator,
        // same pattern as CurrentUser() does for staff auth.
        request.ticketEmail = payload.email;
        return true;
    }
}