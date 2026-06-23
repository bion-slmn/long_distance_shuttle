import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../auth/entities/user.entity';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);