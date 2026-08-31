import { UserRole } from '../../auth/entities/user.entity';

/**
 * A clerk works one stage, not the whole sacco, so their view of bookings,
 * payments and queues is narrowed to it. Everyone else (admins) is unscoped.
 *
 * Throughout the codebase a "stage" is a route's `origin` — the same rule
 * RouteService.findAll and RouteQueueService.assertStageAccess already use.
 * Returns undefined for non-clerks, which every consumer reads as "no filter".
 */
export function clerkStage(user: {
    role: UserRole;
    assignedStage?: string | null;
}): string | undefined {
    return user.role === UserRole.CLERK ? user.assignedStage ?? undefined : undefined;
}
