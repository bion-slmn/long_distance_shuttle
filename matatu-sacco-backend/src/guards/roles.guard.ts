import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../auth/entities/user.entity';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        // Get roles required by the route (set via @Roles decorator)
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );

        // No @Roles decorator — route is accessible to any authenticated user
        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const { user, ...t } = context.switchToHttp().getRequest();

        if (!user) {
            throw new ForbiddenException('No user found on request.');
        }

        const hasRole = requiredRoles.includes(user.role);

        if (!hasRole) {
            throw new ForbiddenException(
                `Access denied. Required role(s): ${requiredRoles.join(', ')}.`
            );
        }

        return true;
    }
}