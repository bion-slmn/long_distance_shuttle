import {
    Injectable,
    UnauthorizedException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

    async refresh(rawRefreshToken: string): Promise<TokenPair> {
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

        return this.generateTokenPair(user);
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
}