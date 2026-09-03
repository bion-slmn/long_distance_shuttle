import {
    Injectable,
    UnauthorizedException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserRole } from './entities/user.entity';
import { EmailService } from '../email/email.service';
import { PasswordResetService, type ResetPurpose } from './password-reset.service';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RegisterDto {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    role: UserRole;
    saccoId?: string;
}

// Admin-created accounts never carry a password: the admin supplies an email,
// the new user sets their own password from the link we send them.
export interface CreateManagerDto {
    fullName: string;
    email: string;
    phoneNumber?: string;
    saccoId: string;
}

// ── Private helpers ───────────────────────────────────────────────────────
export interface CreateStaffDto {
    fullName: string;
    email: string;
    phoneNumber?: string;
    role: UserRole.DRIVER | UserRole.CLERK;
    saccoId: string;
    assignedStage?: string; // ← missing, add this
}

export interface TokenPair {
    access_token: string;
    refresh_token: string;
}

export interface AuthResponse extends TokenPair {
    user: {
        id: string;
        fullName: string;
        role: UserRole;
        saccoId: string | null;
    };
}

export interface UpdateUserDto {
    fullName?: string;
    email?: string;
    phoneNumber?: string;
    role?: UserRole;
    saccoId?: string;
}

export type UserStatusFilter = 'active' | 'removed' | 'all';

export interface GetUsersQuery {
    saccoId?: string;
    search?: string;
    page?: number;
    limit?: number;
    // Defaults to 'active'. Admins switch to 'removed' to find someone to restore.
    status?: UserStatusFilter;
}

export interface PaginatedUsers {
    data: ReturnType<AuthService['sanitizeUser']>[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SALT_ROUNDS = 8;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly emailService: EmailService,
        private readonly passwordResetService: PasswordResetService,
    ) { }

    // ── Register ──────────────────────────────────────────────────────────────
    async register(dto: RegisterDto) {
        // saccoId is deliberately NOT read from the body. A sacco membership
        // is what every tenant-scoped read keys on, so letting a stranger pick
        // one at signup would let them read that sacco's data. Staff get their
        // sacco from an admin via createStaff; passengers have none.
        const { fullName, email, phoneNumber, password, role } = dto;

        // Public self-registration is only allowed for passengers
        // (and optionally sacco admins, if you want self-onboarding for that role).
        const PUBLIC_ROLES = [UserRole.PASSENGER];

        if (!PUBLIC_ROLES.includes(role)) {
            throw new BadRequestException(
                'This role cannot be self-registered. Contact your Sacco admin.',
            );
        }

        if (!email && !phoneNumber) {
            throw new BadRequestException(
                'Provide at least an email or phone number to register.',
            );
        }

        await this.assertNoDuplicateEmail(email);
        await this.assertNoDuplicatePhone(phoneNumber);

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const user = this.userRepository.create({
            fullName: fullName.trim(),
            email: email?.toLowerCase().trim() ?? null,
            phoneNumber: phoneNumber?.trim() ?? null,
            passwordHash,
            role,
            saccoId: null,
            tokenVersion: 0,
            passwordSetAt: new Date(),
        });

        const saved = await this.userRepository.save(user);
        return this.sanitizeUser(saved);
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    async login(identifier: string, password: string): Promise<AuthResponse> {
        if (!identifier || !password) {
            throw new BadRequestException('Provide both identifier and password.');
        }

        const user = await this.findActiveUserByIdentifier(identifier);

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            throw new UnauthorizedException('Invalid login credentials.');
        }

        const tokens = await this.generateTokenPair(user);
        return { ...tokens, user: this.sanitizeUser(user) };
    }

    // ── Refresh ───────────────────────────────────────────────────────────────

    // ── Refresh ───────────────────────────────────────────────────────────────

    // ── Refresh ───────────────────────────────────────────────────────────────
    // Refresh token is NOT rotated — same token stays valid until its own
    // 7-day expiry. Revocation only happens via tokenVersion bump on logout().

    async refresh(rawRefreshToken: string): Promise<AuthResponse> {
        let payload: any;

        // Resolved outside the try: a misconfigured secret is a server error
        // that must surface, not be disguised as "invalid token".
        const secret = this.refreshSecret();

        try {
            payload = await this.jwtService.verifyAsync(rawRefreshToken, { secret });
        } catch {
            throw new UnauthorizedException('Invalid or expired refresh token.');
        }

        // Belt and braces: the secrets already differ, but an access token
        // must never be accepted here even if someone misconfigures them.
        if (payload?.typ !== 'refresh') {
            throw new UnauthorizedException('Invalid or expired refresh token.');
        }

        const user = await this.userRepository.findOne({
            where: { id: payload.sub, isActive: true },
        });

        if (!user) {
            throw new UnauthorizedException('User not found.');
        }

        if (user.tokenVersion !== payload.tokenVersion) {
            throw new UnauthorizedException('Session expired. Please log in again.');
        }

        const access_token = await this.jwtService.signAsync(
            {
                sub: user.id,
                email: user.email,
                phone: user.phoneNumber,
                role: user.role,
                saccoId: user.saccoId,
                tokenVersion: user.tokenVersion,
            },
            {
                secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
                expiresIn: '15m',
            },
        );

        return { access_token, refresh_token: rawRefreshToken, user: this.sanitizeUser(user) };
    }

    // ── Logout ────────────────────────────────────────────────────────────────

    async logout(userId: string) {
        await this.userRepository.increment({ id: userId }, 'tokenVersion', 1);
        return { success: true, message: 'Logged out successfully. Safe travels!' };
    }



    async createManager(dto: CreateManagerDto) {
        if (!dto.email) {
            throw new BadRequestException(
                'An email address is required — the manager sets their own password from a link we send there.',
            );
        }

        await this.assertNoDuplicateEmail(dto.email);
        await this.assertNoDuplicatePhone(dto.phoneNumber);

        const user = this.userRepository.create({
            fullName: dto.fullName.trim(),
            email: dto.email.toLowerCase().trim(),
            phoneNumber: dto.phoneNumber?.trim() ?? null,
            passwordHash: await this.unusablePasswordHash(),
            role: UserRole.SACCO_ADMIN,
            saccoId: dto.saccoId,
            tokenVersion: 0,
        });

        const saved = await this.userRepository.save(user);
        const invite = await this.sendPasswordLink(saved, 'invite');

        return { ...this.sanitizeUser(saved), inviteSent: invite.sent };
    }


    async createStaffUser(
        dto: CreateStaffDto,
        creator: { sub: string; role: UserRole; saccoId: string | null },
    ) {
        const STAFF_ROLES = [UserRole.DRIVER, UserRole.CLERK];

        if (!STAFF_ROLES.includes(dto.role)) {
            throw new BadRequestException('This endpoint only creates drivers or clerks.');
        }

        // Sacco admins can only create staff within their own Sacco.
        // Super admins can create staff for any Sacco (must specify saccoId).
        if (creator.role === UserRole.SACCO_ADMIN) {
            if (creator.saccoId !== dto.saccoId) {
                throw new UnauthorizedException(
                    'You can only create staff within your own Sacco.',
                );
            }
        } else if (creator.role !== UserRole.SUPER_ADMIN) {
            throw new UnauthorizedException(
                'Only Sacco admins or super admins can create staff accounts.',
            );
        }

        if (!dto.email) {
            throw new BadRequestException(
                'An email address is required — staff set their own password from a link we send there.',
            );
        }
        if (dto.role === UserRole.CLERK && !dto.assignedStage) {
            throw new BadRequestException('Assigned stage is required for clerks.');
        }

        await this.assertNoDuplicateEmail(dto.email);
        await this.assertNoDuplicatePhone(dto.phoneNumber);

        const user = this.userRepository.create({
            fullName: dto.fullName.trim(),
            email: dto.email.toLowerCase().trim(),
            phoneNumber: dto.phoneNumber?.trim() ?? null,
            passwordHash: await this.unusablePasswordHash(),
            role: dto.role,
            saccoId: dto.saccoId,
            assignedStage: dto.role === UserRole.CLERK ? dto.assignedStage ?? null : null, // ← add
            tokenVersion: 0,
        });

        const saved = await this.userRepository.save(user);
        const invite = await this.sendPasswordLink(saved, 'invite');

        return { ...this.sanitizeUser(saved), inviteSent: invite.sent };
    }

    // ── List users (scoped by Sacco, or all if super admin) ─────────────────
    async getUsers(query: GetUsersQuery): Promise<PaginatedUsers> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 20));

        // Removed users are soft-deleted, not erased, so the default list has to
        // exclude them — otherwise a removal looks like it did nothing at all.
        const status = query.status ?? 'active';
        const where: FindOptionsWhere<User> = {};

        if (status !== 'all') {
            where.isActive = status === 'active';
        }

        if (query.saccoId) {
            where.saccoId = query.saccoId;
        }

        if (query.search?.trim()) {
            where.fullName = ILike(`%${query.search.trim()}%`);
        }

        const [users, total] = await this.userRepository.findAndCount({
            where,
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });



        return {
            data: users.map((u) => this.sanitizeUser(u)),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    private async findActiveUserByIdentifier(identifier: string): Promise<User | null> {
        const isEmail = identifier.includes('@');

        return this.userRepository.findOne({
            where: isEmail
                ? { email: identifier.toLowerCase().trim(), isActive: true }
                : { phoneNumber: identifier.trim(), isActive: true },
        });
    }



    // Fail loudly rather than let @nestjs/jwt fall back to the module default
    // (the access secret) when JWT_REFRESH_SECRET is unset — that fallback is
    // exactly how refresh tokens end up valid as bearer access tokens.
    private refreshSecret(): string {
        const secret = this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
        if (secret === this.configService.get<string>('JWT_ACCESS_SECRET')) {
            throw new Error('JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET.');
        }
        return secret;
    }

    private async generateTokenPair(user: User): Promise<TokenPair> {
        const payload = {
            sub: user.id,
            email: user.email,
            phone: user.phoneNumber,
            role: user.role,
            saccoId: user.saccoId,
            assignedStage: user.assignedStage, // ← add
            tokenVersion: user.tokenVersion,
        };

        // The refresh token carries `typ: 'refresh'` and is signed with its
        // own secret. Both matter: the secret means JwtStrategy (access
        // secret) can never verify it, and the claim means refresh() can
        // never be fed an access token. Without these a 7-day refresh token
        // doubles as a 7-day access token.
        const [access_token, refresh_token] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
                expiresIn: '15m',
            }),
            this.jwtService.signAsync({ ...payload, typ: 'refresh' }, {
                secret: this.refreshSecret(),
                expiresIn: '7d',
            }),
        ]);

        return { access_token, refresh_token };
    }

    private sanitizeUser(user: User) {
        return {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            phoneNumber: user.phoneNumber,
            role: user.role,
            saccoId: user.saccoId,
            assignedStage: user.assignedStage, // ← add
            createdAt: user.createdAt,
            isActive: user.isActive,
            // Null means "invited but hasn't set a password yet" — the users
            // table renders that as a pending badge with a resend action.
            passwordSetAt: user.passwordSetAt,
        };
    }

    private async assertNoDuplicateEmail(email?: string): Promise<void> {
        if (!email) return;
        const exists = await this.userRepository.findOne({
            where: { email: email.toLowerCase().trim() },
        });
        if (!exists) return;

        // The row is hidden from the users table once removed, so say so —
        // otherwise the admin is blocked by an account they cannot see.
        throw new ConflictException(
            exists.isActive
                ? 'A user with this email already exists.'
                : 'This email belongs to a removed account. Restore that account instead of creating a new one.',
        );
    }

    private async assertNoDuplicatePhone(phoneNumber?: string): Promise<void> {
        if (!phoneNumber) return;
        const exists = await this.userRepository.findOne({
            where: { phoneNumber: phoneNumber.trim() },
        });
        if (exists) throw new ConflictException('A user with this phone number already exists.');
    }

    // ── Update user ───────────────────────────────────────────────────────────
    async updateUser(
        id: string,
        dto: UpdateUserDto,
        requester: { sub: string; role: UserRole; saccoId: string | null },
    ) {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) {
            throw new BadRequestException('User not found.');
        }

        // Sacco admins can only edit users within their own Sacco, and can't
        // reassign someone to a different Sacco or promote to SUPER_ADMIN.
        if (requester.role === UserRole.SACCO_ADMIN) {
            if (user.saccoId !== requester.saccoId) {
                throw new UnauthorizedException(
                    'You can only edit users within your own Sacco.',
                );
            }
            if (dto.saccoId && dto.saccoId !== requester.saccoId) {
                throw new UnauthorizedException(
                    'You cannot move a user to a different Sacco.',
                );
            }
            if (dto.role === UserRole.SUPER_ADMIN) {
                throw new UnauthorizedException(
                    'You cannot assign the super admin role.',
                );
            }
        } else if (requester.role !== UserRole.SUPER_ADMIN) {
            throw new UnauthorizedException(
                'Only Sacco admins or super admins can edit users.',
            );
        }

        if (dto.email && dto.email.toLowerCase().trim() !== user.email) {
            await this.assertNoDuplicateEmail(dto.email);
        }
        if (dto.phoneNumber && dto.phoneNumber.trim() !== user.phoneNumber) {
            await this.assertNoDuplicatePhone(dto.phoneNumber);
        }

        if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
        if (dto.email !== undefined) user.email = dto.email.toLowerCase().trim();
        if (dto.phoneNumber !== undefined) user.phoneNumber = dto.phoneNumber.trim();
        if (dto.role !== undefined) user.role = dto.role;
        if (dto.saccoId !== undefined) user.saccoId = dto.saccoId;

        const saved = await this.userRepository.save(user);
        return this.sanitizeUser(saved);
    }

    // ── Delete user ──────────────────────────────────────────────────────────
    // Two different removals, because "remove" means two different things here:
    //
    //  • An account that never set a password was never signed into, so there is
    //    no history to protect. It's erased outright — which is what an admin
    //    expects after mistyping an email — and that frees the address for reuse.
    //  • Anyone who has actually used the system is soft-deleted (isActive off),
    //    so their trips and bookings keep pointing at a real name.
    async deleteUser(
        id: string,
        requester: { sub: string; role: UserRole; saccoId: string | null },
    ) {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) {
            throw new BadRequestException('User not found.');
        }

        if (requester.role === UserRole.SACCO_ADMIN) {
            if (user.saccoId !== requester.saccoId) {
                throw new UnauthorizedException(
                    'You can only remove users within your own Sacco.',
                );
            }
        } else if (requester.role !== UserRole.SUPER_ADMIN) {
            throw new UnauthorizedException(
                'Only Sacco admins or super admins can remove users.',
            );
        }

        if (user.id === requester.sub) {
            throw new BadRequestException('You cannot delete your own account.');
        }

        // Never signed in, and no trip points at them: nothing to preserve.
        if (!user.passwordSetAt && !(await this.hasTripHistory(user.id))) {
            // Kill the outstanding invite too, so the link already sitting in
            // their inbox stops working the moment the account is cancelled.
            await this.passwordResetService.revokeTokensFor(user.id);
            await this.userRepository.remove(user);

            return { success: true, message: 'Invite cancelled and user removed.' };
        }

        user.isActive = false;
        user.tokenVersion += 1; // invalidate any existing tokens for this user
        await this.userRepository.save(user);

        return { success: true, message: 'User removed.' };
    }

    // ── Restore a removed user ───────────────────────────────────────────────
    // The mirror of the soft delete. Their old password still works, so this is
    // enough to give access back — except for an account that never set one,
    // which gets a fresh invite instead.
    async restoreUser(
        id: string,
        requester: { sub: string; role: UserRole; saccoId: string | null },
    ) {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) {
            throw new BadRequestException('User not found.');
        }

        if (requester.role === UserRole.SACCO_ADMIN) {
            if (user.saccoId !== requester.saccoId) {
                throw new UnauthorizedException(
                    'You can only restore users within your own Sacco.',
                );
            }
        } else if (requester.role !== UserRole.SUPER_ADMIN) {
            throw new UnauthorizedException(
                'Only Sacco admins or super admins can restore users.',
            );
        }

        if (user.isActive) {
            throw new BadRequestException('This account is already active.');
        }

        user.isActive = true;
        const restored = await this.userRepository.save(user);

        // Never had a password to come back to — send them a fresh invite so the
        // restore actually leaves them able to sign in.
        const needsInvite = !user.passwordSetAt;
        const invite = needsInvite
            ? await this.sendPasswordLink(restored, 'invite')
            : { sent: false };

        return {
            ...this.sanitizeUser(restored),
            inviteSent: invite.sent,
            message: needsInvite
                ? invite.sent
                    ? `${restored.fullName} restored — a fresh invite is on its way.`
                    : `${restored.fullName} restored, but the invite email didn't send. Resend it from their profile.`
                : `${restored.fullName} restored. Their existing password still works.`,
        };
    }

    /**
     * `trips.driverId` is the only foreign key pointing at a user. A raw count
     * keeps this check here rather than dragging the whole trip module into
     * AuthModule for one lookup.
     */
    private async hasTripHistory(userId: string): Promise<boolean> {
        const rows = await this.userRepository.manager.query(
            'SELECT 1 FROM trips WHERE "driverId" = $1 LIMIT 1',
            [userId],
        );
        return rows.length > 0;
    }

    // ── Passwords ─────────────────────────────────────────────────────────────

    /**
     * A real bcrypt hash of a value nobody knows, used for accounts that haven't
     * picked a password yet. Login against it simply fails, so there's no
     * "empty password" special case to get wrong anywhere else in the codebase.
     */
    private async unusablePasswordHash(): Promise<string> {
        return bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);
    }

    private assertStrongPassword(password: string): void {
        if (!password || password.length < 8) {
            throw new BadRequestException('Password must be at least 8 characters.');
        }
    }

    /**
     * Mints a token and emails the link. A send failure is swallowed and
     * reported through the return value: an admin creating a clerk shouldn't
     * get a 500 (and lose the created account) because Resend hiccuped — they
     * get the account plus a "couldn't email them, resend it" signal.
     */
    private async sendPasswordLink(
        user: User,
        purpose: ResetPurpose,
    ): Promise<{ sent: boolean }> {
        if (!user.email) {
            return { sent: false };
        }

        const token = await this.passwordResetService.issueToken(user.id, purpose);
        const link = this.passwordResetService.buildLink(token, purpose);
        const expiresIn = purpose === 'invite' ? '3 days' : '1 hour';

        try {
            await this.emailService.sendPasswordLink(
                user.email,
                user.fullName,
                link,
                purpose,
                expiresIn,
            );
            await this.passwordResetService.startCooldown(user.id);
            return { sent: true };
        } catch {
            return { sent: false };
        }
    }

    /**
     * Public. Always reports success, whether or not the address belongs to an
     * account — otherwise this endpoint doubles as a "does this person have an
     * account here" oracle.
     */
    async forgotPassword(email: string) {
        const genericResponse = {
            success: true,
            message: 'If that email is registered, a reset link is on its way.',
        };

        if (!email?.trim()) {
            throw new BadRequestException('Provide the email address on your account.');
        }

        const user = await this.userRepository.findOne({
            where: { email: email.toLowerCase().trim(), isActive: true },
        });

        if (!user) {
            return genericResponse;
        }

        // Silently skip rather than erroring: telling the caller "too soon"
        // would leak that the address exists.
        if (await this.passwordResetService.isOnCooldown(user.id)) {
            return genericResponse;
        }

        await this.sendPasswordLink(user, user.passwordSetAt ? 'reset' : 'invite');

        return genericResponse;
    }

    /** Public. Lets the frontend show "this link expired" before the user types anything. */
    async verifyPasswordToken(token: string) {
        const payload = await this.passwordResetService.peekToken(token);

        if (!payload) {
            return { valid: false as const };
        }

        const user = await this.userRepository.findOne({
            where: { id: payload.userId, isActive: true },
        });

        if (!user) {
            return { valid: false as const };
        }

        return {
            valid: true as const,
            purpose: payload.purpose,
            fullName: user.fullName,
            email: user.email,
        };
    }

    /** Public. Spends the token, sets the password, and kills every existing session. */
    async resetPassword(token: string, newPassword: string) {
        this.assertStrongPassword(newPassword);

        const payload = await this.passwordResetService.consumeToken(token);
        if (!payload) {
            throw new BadRequestException(
                'This link has expired or has already been used. Request a new one.',
            );
        }

        const user = await this.userRepository.findOne({
            where: { id: payload.userId, isActive: true },
        });

        if (!user) {
            throw new BadRequestException('This account is no longer active.');
        }

        user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        user.passwordSetAt = new Date();
        // If the reset was prompted by a compromise, any session the attacker
        // still holds dies here.
        user.tokenVersion += 1;
        await this.userRepository.save(user);

        return {
            success: true,
            message:
                payload.purpose === 'invite'
                    ? 'Password set. You can now sign in.'
                    : 'Password updated. You can now sign in.',
        };
    }

    /** Authenticated. Requires the current password, and hands back fresh tokens
     *  so bumping tokenVersion doesn't log the user out mid-shift. */
    async changePassword(
        userId: string,
        currentPassword: string,
        newPassword: string,
    ): Promise<AuthResponse> {
        if (!currentPassword) {
            throw new BadRequestException('Enter your current password.');
        }
        this.assertStrongPassword(newPassword);

        if (currentPassword === newPassword) {
            throw new BadRequestException(
                'Your new password must be different from your current one.',
            );
        }

        const user = await this.userRepository.findOne({
            where: { id: userId, isActive: true },
        });

        if (!user) {
            throw new UnauthorizedException('User not found.');
        }

        if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
            throw new UnauthorizedException('Your current password is incorrect.');
        }

        user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        user.passwordSetAt = new Date();
        user.tokenVersion += 1;
        const saved = await this.userRepository.save(user);

        const tokens = await this.generateTokenPair(saved);
        return { ...tokens, user: this.sanitizeUser(saved) };
    }

    /**
     * Admin-triggered resend, for the very common "the clerk never got the
     * email" case. The admin still can't see or choose the password.
     */
    async sendPasswordLinkForUser(
        id: string,
        requester: { sub: string; role: UserRole; saccoId: string | null },
    ) {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) {
            throw new BadRequestException('User not found.');
        }

        if (requester.role === UserRole.SACCO_ADMIN) {
            if (user.saccoId !== requester.saccoId) {
                throw new UnauthorizedException(
                    'You can only manage users within your own Sacco.',
                );
            }
        } else if (requester.role !== UserRole.SUPER_ADMIN) {
            throw new UnauthorizedException(
                'Only Sacco admins or super admins can send password links.',
            );
        }

        if (!user.isActive) {
            throw new BadRequestException(
                'This account is deactivated. Reactivate it before sending a link.',
            );
        }

        if (!user.email) {
            throw new BadRequestException(
                'This user has no email address on file. Add one first.',
            );
        }

        const purpose: ResetPurpose = user.passwordSetAt ? 'reset' : 'invite';
        const { sent } = await this.sendPasswordLink(user, purpose);

        if (!sent) {
            throw new BadRequestException(
                'We could not send the email just now. Please try again.',
            );
        }

        return {
            success: true,
            purpose,
            message:
                purpose === 'invite'
                    ? `Invite re-sent to ${user.email}.`
                    : `Password reset link sent to ${user.email}.`,
        };
    }
}
