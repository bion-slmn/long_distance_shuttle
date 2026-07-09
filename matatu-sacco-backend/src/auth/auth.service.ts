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
import { User, UserRole } from './entities/user.entity';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RegisterDto {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    role: UserRole;
    saccoId?: string;
}

export interface CreateManagerDto {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    saccoId: string;
}

// ── Private helpers ───────────────────────────────────────────────────────
export interface CreateStaffDto {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    role: UserRole.DRIVER | UserRole.CLERK;
    saccoId: string; // required here, not optional
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

export interface GetUsersQuery {
    saccoId?: string;
    search?: string;
    page?: number;
    limit?: number;
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
    ) { }

    // ── Register ──────────────────────────────────────────────────────────────
    async register(dto: RegisterDto) {
        const { fullName, email, phoneNumber, password, role, saccoId } = dto;

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
            saccoId: saccoId ?? null,
            tokenVersion: 0,
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

        try {
            payload = await this.jwtService.verifyAsync(rawRefreshToken, {
                secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
            });
        } catch {
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
        if (!dto.email && !dto.phoneNumber) {
            throw new BadRequestException('Provide at least an email or phone number.');
        }

        await this.assertNoDuplicateEmail(dto.email);
        await this.assertNoDuplicatePhone(dto.phoneNumber);

        const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

        const user = this.userRepository.create({
            fullName: dto.fullName.trim(),
            email: dto.email?.toLowerCase().trim() ?? null,
            phoneNumber: dto.phoneNumber?.trim() ?? null,
            passwordHash,
            role: UserRole.SACCO_ADMIN,
            saccoId: dto.saccoId,
            tokenVersion: 0,
        });

        const saved = await this.userRepository.save(user);
        return this.sanitizeUser(saved);
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

        if (!dto.email && !dto.phoneNumber) {
            throw new BadRequestException(
                'Provide at least an email or phone number.',
            );
        }

        await this.assertNoDuplicateEmail(dto.email);
        await this.assertNoDuplicatePhone(dto.phoneNumber);

        const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

        const user = this.userRepository.create({
            fullName: dto.fullName.trim(),
            email: dto.email?.toLowerCase().trim() ?? null,
            phoneNumber: dto.phoneNumber?.trim() ?? null,
            passwordHash,
            role: dto.role,
            saccoId: dto.saccoId,
            tokenVersion: 0,
        });

        const saved = await this.userRepository.save(user);
        return this.sanitizeUser(saved);
    }

    // ── List users (scoped by Sacco, or all if super admin) ─────────────────
    async getUsers(query: GetUsersQuery): Promise<PaginatedUsers> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 20));

        const where: FindOptionsWhere<User> = {};

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



    private async generateTokenPair(user: User): Promise<TokenPair> {
        const payload = {
            sub: user.id,
            email: user.email,
            phone: user.phoneNumber,
            role: user.role,
            saccoId: user.saccoId,
            tokenVersion: user.tokenVersion,
        };

        const [access_token, refresh_token] = await Promise.all([
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
                expiresIn: '15m',
            }),
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
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
            createdAt: user.createdAt,
        };
    }

    private async assertNoDuplicateEmail(email?: string): Promise<void> {
        if (!email) return;
        const exists = await this.userRepository.findOne({
            where: { email: email.toLowerCase().trim() },
        });
        if (exists) throw new ConflictException('A user with this email already exists.');
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

    // ── Delete (deactivate) user ─────────────────────────────────────────────
    // Soft delete: flips isActive off rather than removing the row, so
    // historical records (trips, orders, etc.) tied to this user stay intact.
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

        user.isActive = false;
        user.tokenVersion += 1; // invalidate any existing tokens for this user
        await this.userRepository.save(user);

        return { success: true, message: 'User removed.' };
    }
}