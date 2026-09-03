import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService, CreateStaffDto } from './auth.service';
import { EmailService } from '../email/email.service';
import { PasswordResetService } from './password-reset.service';
import { User, UserRole } from './entities/user.entity';

// ─── Shared mock factory ──────────────────────────────────────────────────────

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-uuid-1',
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phoneNumber: '0712345678',
  passwordHash: '$2b$08$hashedpassword',
  role: UserRole.CLERK,
  saccoId: null,
  assignedStage: null,
  tokenVersion: 0,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  passwordSetAt: new Date('2024-01-01'),
  ...overrides,
} as User);

// ─── Repository mock ──────────────────────────────────────────────────────────

const mockUserRepository = () => ({
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  increment: jest.fn(),
  // `trips.driverId` probe in deleteUser — no trips by default
  manager: { query: jest.fn().mockResolvedValue([]) },
});

// ─── JWT + Config mocks ───────────────────────────────────────────────────────

const mockJwtService = () => ({
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
});

const mockEmailService = () => ({
  sendPasswordLink: jest.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
});

const mockPasswordResetService = () => ({
  issueToken: jest.fn().mockResolvedValue('raw-token'),
  peekToken: jest.fn(),
  consumeToken: jest.fn(),
  isOnCooldown: jest.fn().mockResolvedValue(false),
  startCooldown: jest.fn(),
  revokeTokensFor: jest.fn(),
  buildLink: jest.fn((token: string) => `http://localhost:5173/set-password?token=${token}`),
});

const configValue = (key: string) => {
  if (key === 'JWT_ACCESS_SECRET') return 'test-access-secret';
  if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
  return null;
};
const mockConfigService = () => ({
  get: jest.fn(configValue),
  getOrThrow: jest.fn((key: string) => {
    const v = configValue(key);
    if (v == null) throw new Error(`Configuration key "${key}" does not exist`);
    return v;
  }),
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepository>;
  let jwtService: ReturnType<typeof mockJwtService>;
  let emailService: ReturnType<typeof mockEmailService>;
  let passwordResetService: ReturnType<typeof mockPasswordResetService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepository },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: ConfigService, useFactory: mockConfigService },
        { provide: EmailService, useFactory: mockEmailService },
        { provide: PasswordResetService, useFactory: mockPasswordResetService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepo = module.get(getRepositoryToken(User));
    jwtService = module.get(JwtService);
    emailService = module.get(EmailService);
    passwordResetService = module.get(PasswordResetService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Sanity ────────────────────────────────────────────────────────────────

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // register()
  // ─────────────────────────────────────────────────────────────────────────

  describe('register()', () => {
    const dto = {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phoneNumber: '0712345678',
      password: 'secret123',
      role: UserRole.CLERK,
    };

    it('registers a new user successfully', async () => {
      userRepo.findOne.mockResolvedValue(null);          // no duplicates
      const saved = makeUser();
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.register({ ...dto, role: UserRole.PASSENGER });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Jane Doe',
          email: 'jane@example.com',
          tokenVersion: 0,
        })
      );
      expect(result).toMatchObject({
        id: saved.id,
        fullName: 'Jane Doe',
        email: 'jane@example.com',
      });
      // passwordHash must never be returned
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws BadRequestException when self-registering a non-passenger role', async () => {
      await expect(
        service.register({ ...dto, role: UserRole.CLERK })
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.register({ ...dto, role: UserRole.SACCO_ADMIN })
      ).rejects.toThrow(BadRequestException);

      // no lookups or writes should happen once the role gate rejects it
      expect(userRepo.findOne).not.toHaveBeenCalled();
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when neither email nor phone provided', async () => {
      await expect(
        service.register({ ...dto, role: UserRole.PASSENGER, email: undefined, phoneNumber: undefined })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on duplicate email', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser()); // email clash

      await expect(
        service.register({ ...dto, role: UserRole.PASSENGER })
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on duplicate phone number', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)        // email → no clash
        .mockResolvedValueOnce(makeUser()); // phone → clash

      await expect(
        service.register({ ...dto, role: UserRole.PASSENGER })
      ).rejects.toThrow(ConflictException);
    });

    it('hashes the password before saving', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser();
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.register({ ...dto, role: UserRole.PASSENGER });

      const createCall = userRepo.create.mock.calls[0][0];
      expect(createCall.passwordHash).toBeDefined();
      expect(createCall.passwordHash).not.toBe(dto.password);
      const isHashed = await bcrypt.compare(dto.password, createCall.passwordHash);
      expect(isHashed).toBe(true);
    });

    it('registers with phone only (no email)', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ email: null });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.register({
        ...dto,
        role: UserRole.PASSENGER,
        email: undefined,
      });

      expect(result).toBeDefined();
    });

    it('SECURITY: ignores a saccoId supplied by the caller — self-registered users never join a sacco', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ saccoId: null });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.register({ ...dto, role: UserRole.PASSENGER, saccoId: 'sacco-123' } as any);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: null })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // login()
  // ─────────────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const password = 'secret123';
    let passwordHash: string;

    beforeEach(async () => {
      passwordHash = await bcrypt.hash(password, 8);
    });

    it('returns tokens and user on valid email login', async () => {
      const user = makeUser({ passwordHash });
      userRepo.findOne.mockResolvedValue(user);
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await service.login('jane@example.com', password);

      expect(result.access_token).toBe('access-token');
      expect(result.refresh_token).toBe('refresh-token');
      expect(result.user).toMatchObject({ id: user.id, fullName: user.fullName });
    });

    it('returns tokens on valid phone login', async () => {
      const user = makeUser({ passwordHash });
      userRepo.findOne.mockResolvedValue(user);
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await service.login('0712345678', password);

      expect(result.access_token).toBeDefined();
    });

    it('throws UnauthorizedException for unknown identifier', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', password)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const user = makeUser({ passwordHash });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.login('jane@example.com', 'wrongpassword')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when identifier or password is empty', async () => {
      await expect(service.login('', 'secret123')).rejects.toThrow(BadRequestException);
      await expect(service.login('jane@example.com', '')).rejects.toThrow(BadRequestException);
    });

    it('does not expose passwordHash in the response', async () => {
      const user = makeUser({ passwordHash });
      userRepo.findOne.mockResolvedValue(user);
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await service.login('jane@example.com', password);
      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // refresh()
  // ─────────────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('issues a new token pair for a valid refresh token', async () => {
      const user = makeUser({ tokenVersion: 2 });
      jwtService.verifyAsync.mockResolvedValue({
        sub: user.id,
        tokenVersion: 2,
        typ: 'refresh',
      });
      userRepo.findOne.mockResolvedValue(user);
      jwtService.signAsync.mockResolvedValueOnce('new-access');

      const result = await service.refresh('valid-refresh-token');

      expect(result.access_token).toBe('new-access');
      // refresh token is NOT rotated — the same raw token is echoed back
      expect(result.refresh_token).toBe('valid-refresh-token');
      // and it is verified against the refresh secret, never the access one
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        'valid-refresh-token',
        { secret: 'test-refresh-secret' },
      );
    });

    it('SECURITY: rejects an access token presented as a refresh token (no typ claim)', async () => {
      const user = makeUser({ tokenVersion: 2 });
      jwtService.verifyAsync.mockResolvedValue({ sub: user.id, tokenVersion: 2 });
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.refresh('an-access-token')).rejects.toThrow(UnauthorizedException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('SECURITY: fails closed when JWT_REFRESH_SECRET is not configured', async () => {
      (service as any).configService.getOrThrow.mockImplementation((key: string) => {
        throw new Error(`Configuration key "${key}" does not exist`);
      });

      await expect(service.refresh('any')).rejects.toThrow(/JWT_REFRESH_SECRET/);
    });

    it('SECURITY: refuses to run when the refresh secret equals the access secret', async () => {
      (service as any).configService.getOrThrow.mockReturnValue('test-access-secret');

      await expect(service.refresh('any')).rejects.toThrow(/must differ/);
    });

    it('throws UnauthorizedException for an invalid/expired token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is not found', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'ghost-id', tokenVersion: 0, typ: 'refresh' });
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('some-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when tokenVersion is stale (logged-out session)', async () => {
      const user = makeUser({ tokenVersion: 5 });
      jwtService.verifyAsync.mockResolvedValue({
        sub: user.id,
        tokenVersion: 3,          // old version — session was revoked
        typ: 'refresh',
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.refresh('stale-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // logout()
  // ─────────────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('increments tokenVersion to invalidate all existing sessions', async () => {
      userRepo.increment.mockResolvedValue(undefined);

      const result = await service.logout('user-uuid-1');

      expect(userRepo.increment).toHaveBeenCalledWith(
        { id: 'user-uuid-1' },
        'tokenVersion',
        1,
      );
      expect(result.success).toBe(true);
    });

    it('returns a success message', async () => {
      userRepo.increment.mockResolvedValue(undefined);

      const result = await service.logout('user-uuid-1');

      expect(result.message).toContain('Logged out');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createManager()
  // ─────────────────────────────────────────────────────────────────────────

  describe('createManager()', () => {
    const dto = {
      fullName: 'Sacco Manager',
      email: 'manager@example.com',
      phoneNumber: '0700000000',
      saccoId: 'sacco-123',
    };

    it('creates a SACCO_ADMIN user scoped to the given sacco', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({
        role: UserRole.SACCO_ADMIN,
        saccoId: 'sacco-123',
        email: dto.email,
        fullName: dto.fullName,
      });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.createManager(dto);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.SACCO_ADMIN,
          saccoId: 'sacco-123',
          tokenVersion: 0,
        })
      );
      expect(result).toMatchObject({ role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws BadRequestException when no email is provided', async () => {
      await expect(
        service.createManager({ ...dto, email: '' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on duplicate email', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());

      await expect(service.createManager(dto)).rejects.toThrow(ConflictException);
    });

    it('explains when the clashing email belongs to a removed account', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser({ isActive: false }));

      await expect(service.createManager(dto)).rejects.toThrow(/removed account/);
    });

    it('throws ConflictException on duplicate phone number', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeUser());

      await expect(service.createManager(dto)).rejects.toThrow(ConflictException);
    });

    it('stores an unusable password hash and emails an invite instead', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ role: UserRole.SACCO_ADMIN, passwordSetAt: null });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.createManager(dto);

      const createCall = userRepo.create.mock.calls[0][0];
      expect(createCall.passwordHash).toEqual(expect.any(String));
      expect(createCall.passwordSetAt).toBeUndefined();

      expect(passwordResetService.issueToken).toHaveBeenCalledWith(saved.id, 'invite');
      expect(emailService.sendPasswordLink).toHaveBeenCalledWith(
        saved.email,
        saved.fullName,
        expect.stringContaining('raw-token'),
        'invite',
        '3 days',
      );
      expect(result.inviteSent).toBe(true);
    });

    it('still returns the created account when the invite email fails to send', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ role: UserRole.SACCO_ADMIN, passwordSetAt: null });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);
      emailService.sendPasswordLink.mockRejectedValueOnce(new Error('Resend down'));

      const result = await service.createManager(dto);

      expect(result).toMatchObject({ role: UserRole.SACCO_ADMIN });
      expect(result.inviteSent).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createStaffUser()
  // ─────────────────────────────────────────────────────────────────────────

  describe('createStaffUser()', () => {
    const saccoAdminCreator = { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' };
    const superAdminCreator = { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null };

    const clerkDto: CreateStaffDto = {
      fullName: 'Clerk One',
      email: 'clerk@example.com',
      phoneNumber: '0711111111',
      role: UserRole.CLERK,
      saccoId: 'sacco-123',
      assignedStage: 'stage-a',
    };

    const driverDto: CreateStaffDto = {
      fullName: 'Driver One',
      email: 'driver@example.com',
      phoneNumber: '0722222222',
      role: UserRole.DRIVER,
      saccoId: 'sacco-123',
    };

    it('allows a sacco admin to create staff within their own sacco', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ role: UserRole.CLERK, saccoId: 'sacco-123', assignedStage: 'stage-a' });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.createStaffUser(clerkDto, saccoAdminCreator);

      expect(result).toMatchObject({ role: UserRole.CLERK, saccoId: 'sacco-123', assignedStage: 'stage-a' });
    });

    it('allows a super admin to create staff for any sacco', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ role: UserRole.DRIVER, saccoId: 'sacco-999' });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.createStaffUser({ ...driverDto, saccoId: 'sacco-999' }, superAdminCreator);

      expect(result).toMatchObject({ role: UserRole.DRIVER, saccoId: 'sacco-999' });
    });

    it('throws UnauthorizedException when a sacco admin tries to create staff for a different sacco', async () => {
      await expect(
        service.createStaffUser({ ...clerkDto, saccoId: 'other-sacco' }, saccoAdminCreator)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when creator is neither sacco admin nor super admin', async () => {
      const clerkCreator = { sub: 'clerk-1', role: UserRole.CLERK, saccoId: 'sacco-123' };

      await expect(
        service.createStaffUser(clerkDto, clerkCreator)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException for a non-staff role', async () => {
      await expect(
        service.createStaffUser({ ...clerkDto, role: UserRole.PASSENGER } as any, saccoAdminCreator)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when creating a clerk without an assignedStage', async () => {
      await expect(
        service.createStaffUser({ ...clerkDto, assignedStage: undefined }, saccoAdminCreator)
      ).rejects.toThrow(BadRequestException);
    });

    it('does not require assignedStage for drivers', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ role: UserRole.DRIVER, saccoId: 'sacco-123', assignedStage: null });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.createStaffUser(driverDto, saccoAdminCreator);

      expect(result.assignedStage).toBeNull();
    });

    it('throws BadRequestException when no email is provided', async () => {
      await expect(
        service.createStaffUser({ ...clerkDto, email: '' }, saccoAdminCreator)
      ).rejects.toThrow(BadRequestException);
    });

    it('emails the new staff member an invite link rather than a password', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ role: UserRole.CLERK, saccoId: 'sacco-123', passwordSetAt: null });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.createStaffUser(clerkDto, saccoAdminCreator);

      expect(passwordResetService.issueToken).toHaveBeenCalledWith(saved.id, 'invite');
      expect(emailService.sendPasswordLink).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException on duplicate email', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());

      await expect(
        service.createStaffUser(clerkDto, saccoAdminCreator)
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getUsers()
  // ─────────────────────────────────────────────────────────────────────────

  describe('getUsers()', () => {
    it('returns paginated users with default paging', async () => {
      const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2' })];
      userRepo.findAndCount.mockResolvedValue([users, 2]);

      const result = await service.getUsers({});

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 })
      );
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
      // sanitized: no passwordHash leaking through
      expect(result.data[0]).not.toHaveProperty('passwordHash');
    });

    it('excludes removed (deactivated) users by default', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({});

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) })
      );
    });

    it('returns only removed users when asked for them', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({ status: 'removed' });

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: false }) })
      );
    });

    it('does not filter on isActive at all for status "all"', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({ status: 'all' });

      const where = userRepo.findAndCount.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('isActive');
    });

    it('scopes results by saccoId when provided', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({ saccoId: 'sacco-123' });

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ saccoId: 'sacco-123' }) })
      );
    });

    it('applies search filter on fullName', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({ search: 'jane' });

      const callArg = userRepo.findAndCount.mock.calls[0][0];
      expect(callArg.where.fullName).toBeDefined();
    });

    it('clamps limit to a maximum of 100', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({ limit: 500 });

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });

    it('floors page at 1 even if a lower value is passed', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({ page: -5 });

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 })
      );
    });

    it('computes skip correctly for later pages', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getUsers({ page: 3, limit: 10 });

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateUser()
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateUser()', () => {
    const saccoAdminRequester = { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' };
    const superAdminRequester = { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null };

    it('updates fields for a user within a sacco admin scope', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123', fullName: 'Old Name' });
      userRepo.findOne.mockResolvedValueOnce(existing); // load target user
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.updateUser('target-1', { fullName: 'New Name' }, saccoAdminRequester);

      expect(result.fullName).toBe('New Name');
    });

    it('throws BadRequestException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateUser('missing', { fullName: 'X' }, superAdminRequester)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when a sacco admin edits a user outside their sacco', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'other-sacco' });
      userRepo.findOne.mockResolvedValueOnce(existing);

      await expect(
        service.updateUser('target-1', { fullName: 'New Name' }, saccoAdminRequester)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when a sacco admin tries to move a user to a different sacco', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123' });
      userRepo.findOne.mockResolvedValueOnce(existing);

      await expect(
        service.updateUser('target-1', { saccoId: 'other-sacco' }, saccoAdminRequester)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when a sacco admin tries to assign SUPER_ADMIN', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123' });
      userRepo.findOne.mockResolvedValueOnce(existing);

      await expect(
        service.updateUser('target-1', { role: UserRole.SUPER_ADMIN }, saccoAdminRequester)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when requester is neither sacco admin nor super admin', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123' });
      userRepo.findOne.mockResolvedValueOnce(existing);
      const clerkRequester = { sub: 'clerk-1', role: UserRole.CLERK, saccoId: 'sacco-123' };

      await expect(
        service.updateUser('target-1', { fullName: 'X' }, clerkRequester)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('allows a super admin to move a user between saccos and change role', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123', role: UserRole.CLERK });
      userRepo.findOne.mockResolvedValueOnce(existing);
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.updateUser(
        'target-1',
        { saccoId: 'sacco-999', role: UserRole.SACCO_ADMIN },
        superAdminRequester,
      );

      expect(result.saccoId).toBe('sacco-999');
      expect(result.role).toBe(UserRole.SACCO_ADMIN);
    });

    it('throws ConflictException when updating to an email already in use', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123', email: 'old@example.com' });
      userRepo.findOne
        .mockResolvedValueOnce(existing)      // load target
        .mockResolvedValueOnce(makeUser());   // duplicate check hit

      await expect(
        service.updateUser('target-1', { email: 'taken@example.com' }, saccoAdminRequester)
      ).rejects.toThrow(ConflictException);
    });

    it('does not re-check duplicates when email/phone are unchanged', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123', email: 'jane@example.com' });
      userRepo.findOne.mockResolvedValueOnce(existing); // only the initial load
      userRepo.save.mockImplementation(async (u) => u);

      await service.updateUser('target-1', { email: 'jane@example.com' }, saccoAdminRequester);

      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // deleteUser()
  // ─────────────────────────────────────────────────────────────────────────

  describe('deleteUser()', () => {
    const saccoAdminRequester = { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' };
    const superAdminRequester = { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null };

    it('soft-deletes a user within a sacco admin scope', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123', isActive: true, tokenVersion: 0 });
      userRepo.findOne.mockResolvedValueOnce(existing);
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.deleteUser('target-1', saccoAdminRequester);

      expect(existing.isActive).toBe(false);
      expect(existing.tokenVersion).toBe(1); // bumped to invalidate existing tokens
      expect(result.success).toBe(true);
    });

    it('erases an invited user who never set a password, and revokes their link', async () => {
      const pending = makeUser({ id: 'target-1', saccoId: 'sacco-123', passwordSetAt: null });
      userRepo.findOne.mockResolvedValueOnce(pending);

      const result = await service.deleteUser('target-1', saccoAdminRequester);

      expect(passwordResetService.revokeTokensFor).toHaveBeenCalledWith('target-1');
      expect(userRepo.remove).toHaveBeenCalledWith(pending);
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(result.message).toContain('Invite cancelled');
    });

    it('falls back to a soft delete when a pending user is already on a trip', async () => {
      const pending = makeUser({ id: 'target-1', saccoId: 'sacco-123', passwordSetAt: null });
      userRepo.findOne.mockResolvedValueOnce(pending);
      userRepo.manager.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      userRepo.save.mockImplementation(async (u) => u);

      await service.deleteUser('target-1', saccoAdminRequester);

      expect(userRepo.remove).not.toHaveBeenCalled();
      expect(pending.isActive).toBe(false);
    });

    it('never erases a user who has actually set a password', async () => {
      const active = makeUser({ id: 'target-1', saccoId: 'sacco-123' });
      userRepo.findOne.mockResolvedValueOnce(active);
      userRepo.save.mockImplementation(async (u) => u);

      await service.deleteUser('target-1', saccoAdminRequester);

      expect(userRepo.remove).not.toHaveBeenCalled();
      expect(active.isActive).toBe(false);
    });

    it('throws BadRequestException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deleteUser('missing', superAdminRequester)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when a sacco admin deletes a user outside their sacco', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'other-sacco' });
      userRepo.findOne.mockResolvedValueOnce(existing);

      await expect(
        service.deleteUser('target-1', saccoAdminRequester)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when requester is neither sacco admin nor super admin', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'sacco-123' });
      userRepo.findOne.mockResolvedValueOnce(existing);
      const clerkRequester = { sub: 'clerk-1', role: UserRole.CLERK, saccoId: 'sacco-123' };

      await expect(
        service.deleteUser('target-1', clerkRequester)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when a user tries to delete their own account', async () => {
      const existing = makeUser({ id: 'admin-1', saccoId: 'sacco-123' });
      userRepo.findOne.mockResolvedValueOnce(existing);

      await expect(
        service.deleteUser('admin-1', saccoAdminRequester)
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a super admin to delete a user in any sacco', async () => {
      const existing = makeUser({ id: 'target-1', saccoId: 'some-other-sacco' });
      userRepo.findOne.mockResolvedValueOnce(existing);
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.deleteUser('target-1', superAdminRequester);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // forgotPassword()
  // ─────────────────────────────────────────────────────────────────────────

  describe('forgotPassword()', () => {
    it('sends a reset link to a user who already has a password', async () => {
      const user = makeUser({ email: 'jane@example.com' });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.forgotPassword('Jane@Example.com ');

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'jane@example.com', isActive: true },
      });
      expect(passwordResetService.issueToken).toHaveBeenCalledWith(user.id, 'reset');
      expect(emailService.sendPasswordLink).toHaveBeenCalledWith(
        user.email,
        user.fullName,
        expect.any(String),
        'reset',
        '1 hour',
      );
      expect(result.success).toBe(true);
    });

    it('sends invite wording to a user who never set a password', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ passwordSetAt: null }));

      await service.forgotPassword('jane@example.com');

      expect(passwordResetService.issueToken).toHaveBeenCalledWith('user-uuid-1', 'invite');
    });

    it('returns the same response for an unknown email and sends nothing', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.forgotPassword('nobody@example.com');

      expect(emailService.sendPasswordLink).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'If that email is registered, a reset link is on its way.',
      });
    });

    it('does not reveal the cooldown — same response, no second email', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      passwordResetService.isOnCooldown.mockResolvedValueOnce(true);

      const result = await service.forgotPassword('jane@example.com');

      expect(emailService.sendPasswordLink).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('throws BadRequestException when no email is given at all', async () => {
      await expect(service.forgotPassword('')).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resetPassword()
  // ─────────────────────────────────────────────────────────────────────────

  describe('resetPassword()', () => {
    it('sets the new password, stamps passwordSetAt, and invalidates sessions', async () => {
      passwordResetService.consumeToken.mockResolvedValue({
        userId: 'user-uuid-1',
        purpose: 'invite',
      });
      const user = makeUser({ tokenVersion: 3, passwordSetAt: null });
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.resetPassword('raw-token', 'brand-new-pass');

      const saved = userRepo.save.mock.calls[0][0];
      expect(await bcrypt.compare('brand-new-pass', saved.passwordHash)).toBe(true);
      expect(saved.passwordSetAt).toBeInstanceOf(Date);
      expect(saved.tokenVersion).toBe(4);
      expect(result.success).toBe(true);
    });

    it('rejects an expired or already-used token', async () => {
      passwordResetService.consumeToken.mockResolvedValue(null);

      await expect(
        service.resetPassword('stale-token', 'brand-new-pass'),
      ).rejects.toThrow(BadRequestException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a password shorter than 8 characters before spending the token', async () => {
      await expect(service.resetPassword('raw-token', 'short')).rejects.toThrow(
        BadRequestException,
      );
      expect(passwordResetService.consumeToken).not.toHaveBeenCalled();
    });

    it('rejects a token belonging to a deactivated account', async () => {
      passwordResetService.consumeToken.mockResolvedValue({
        userId: 'user-uuid-1',
        purpose: 'reset',
      });
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword('raw-token', 'brand-new-pass'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // changePassword()
  // ─────────────────────────────────────────────────────────────────────────

  describe('changePassword()', () => {
    const currentPassword = 'current-pass';
    let passwordHash: string;

    beforeEach(async () => {
      passwordHash = await bcrypt.hash(currentPassword, 8);
      jwtService.signAsync.mockResolvedValue('signed-token');
    });

    it('replaces the hash and hands back a fresh token pair', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ passwordHash, tokenVersion: 1 }));
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.changePassword(
        'user-uuid-1',
        currentPassword,
        'a-different-pass',
      );

      const saved = userRepo.save.mock.calls[0][0];
      expect(await bcrypt.compare('a-different-pass', saved.passwordHash)).toBe(true);
      expect(saved.tokenVersion).toBe(2);
      expect(result.access_token).toBe('signed-token');
      expect(result.refresh_token).toBe('signed-token');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('throws UnauthorizedException when the current password is wrong', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ passwordHash }));

      await expect(
        service.changePassword('user-uuid-1', 'not-my-password', 'a-different-pass'),
      ).rejects.toThrow(UnauthorizedException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects reusing the same password', async () => {
      await expect(
        service.changePassword('user-uuid-1', currentPassword, currentPassword),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a new password shorter than 8 characters', async () => {
      await expect(
        service.changePassword('user-uuid-1', currentPassword, 'short'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sendPasswordLinkForUser()
  // ─────────────────────────────────────────────────────────────────────────

  describe('sendPasswordLinkForUser()', () => {
    const saccoAdminRequester = { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' };
    const superAdminRequester = { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null };

    it('re-sends an invite when the user has never set a password', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ saccoId: 'sacco-123', passwordSetAt: null }),
      );

      const result = await service.sendPasswordLinkForUser('user-uuid-1', saccoAdminRequester);

      expect(passwordResetService.issueToken).toHaveBeenCalledWith('user-uuid-1', 'invite');
      expect(result).toMatchObject({ success: true, purpose: 'invite' });
    });

    it('sends a reset link when the user already has a password', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ saccoId: 'other-sacco' }));

      const result = await service.sendPasswordLinkForUser('user-uuid-1', superAdminRequester);

      expect(passwordResetService.issueToken).toHaveBeenCalledWith('user-uuid-1', 'reset');
      expect(result).toMatchObject({ success: true, purpose: 'reset' });
    });

    it('blocks a sacco admin from touching a user in another sacco', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ saccoId: 'other-sacco' }));

      await expect(
        service.sendPasswordLinkForUser('user-uuid-1', saccoAdminRequester),
      ).rejects.toThrow(UnauthorizedException);
      expect(emailService.sendPasswordLink).not.toHaveBeenCalled();
    });

    it('refuses to send to a deactivated account', async () => {
      userRepo.findOne.mockResolvedValue(
        makeUser({ saccoId: 'sacco-123', isActive: false }),
      );

      await expect(
        service.sendPasswordLinkForUser('user-uuid-1', saccoAdminRequester),
      ).rejects.toThrow(BadRequestException);
    });

    it('surfaces a send failure to the admin instead of reporting success', async () => {
      userRepo.findOne.mockResolvedValue(makeUser({ saccoId: 'sacco-123' }));
      emailService.sendPasswordLink.mockRejectedValueOnce(new Error('Resend down'));

      await expect(
        service.sendPasswordLinkForUser('user-uuid-1', saccoAdminRequester),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // restoreUser()
  // ─────────────────────────────────────────────────────────────────────────

  describe('restoreUser()', () => {
    const saccoAdminRequester = { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' };
    const superAdminRequester = { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null };

    it('reactivates a removed user without touching their password', async () => {
      const removed = makeUser({ id: 'target-1', saccoId: 'sacco-123', isActive: false });
      userRepo.findOne.mockResolvedValueOnce(removed);
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.restoreUser('target-1', saccoAdminRequester);

      expect(removed.isActive).toBe(true);
      expect(removed.passwordHash).toBe('$2b$08$hashedpassword');
      expect(emailService.sendPasswordLink).not.toHaveBeenCalled();
      expect(result.message).toContain('existing password still works');
    });

    it('sends a fresh invite when the restored account never set a password', async () => {
      const removed = makeUser({
        id: 'target-1',
        saccoId: 'sacco-123',
        isActive: false,
        passwordSetAt: null,
      });
      userRepo.findOne.mockResolvedValueOnce(removed);
      userRepo.save.mockImplementation(async (u) => u);

      const result = await service.restoreUser('target-1', saccoAdminRequester);

      expect(passwordResetService.issueToken).toHaveBeenCalledWith('target-1', 'invite');
      expect(result.inviteSent).toBe(true);
    });

    it('still restores the account when the invite email fails', async () => {
      const removed = makeUser({ id: 'target-1', saccoId: 'sacco-123', isActive: false, passwordSetAt: null });
      userRepo.findOne.mockResolvedValueOnce(removed);
      userRepo.save.mockImplementation(async (u) => u);
      emailService.sendPasswordLink.mockRejectedValueOnce(new Error('Resend down'));

      const result = await service.restoreUser('target-1', saccoAdminRequester);

      expect(removed.isActive).toBe(true);
      expect(result.inviteSent).toBe(false);
    });

    it('rejects restoring an account that is already active', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser({ saccoId: 'sacco-123' }));

      await expect(
        service.restoreUser('target-1', saccoAdminRequester),
      ).rejects.toThrow(BadRequestException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('blocks a sacco admin from restoring a user in another sacco', async () => {
      userRepo.findOne.mockResolvedValueOnce(
        makeUser({ saccoId: 'other-sacco', isActive: false }),
      );

      await expect(
        service.restoreUser('target-1', saccoAdminRequester),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lets a super admin restore a user in any sacco', async () => {
      const removed = makeUser({ saccoId: 'other-sacco', isActive: false });
      userRepo.findOne.mockResolvedValueOnce(removed);
      userRepo.save.mockImplementation(async (u) => u);

      await service.restoreUser('target-1', superAdminRequester);

      expect(removed.isActive).toBe(true);
    });

    it('throws BadRequestException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.restoreUser('missing', superAdminRequester),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
