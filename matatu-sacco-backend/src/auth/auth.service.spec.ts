import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService, CreateStaffDto } from './auth.service';
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
  ...overrides,
} as User);

// ─── Repository mock ──────────────────────────────────────────────────────────

const mockUserRepository = () => ({
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  increment: jest.fn(),
});

// ─── JWT + Config mocks ───────────────────────────────────────────────────────

const mockJwtService = () => ({
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
});

const mockConfigService = () => ({
  get: jest.fn((key: string) => {
    if (key === 'JWT_ACCESS_SECRET') return 'test-access-secret';
    if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
    return null;
  }),
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepository>;
  let jwtService: ReturnType<typeof mockJwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepository },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: ConfigService, useFactory: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepo = module.get(getRepositoryToken(User));
    jwtService = module.get(JwtService);
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

    it('stores saccoId when provided', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ saccoId: 'sacco-123' });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.register({ ...dto, role: UserRole.PASSENGER, saccoId: 'sacco-123' });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-123' })
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
      });
      userRepo.findOne.mockResolvedValue(user);
      jwtService.signAsync.mockResolvedValueOnce('new-access');

      const result = await service.refresh('valid-refresh-token');

      expect(result.access_token).toBe('new-access');
      // refresh token is NOT rotated — the same raw token is echoed back
      expect(result.refresh_token).toBe('valid-refresh-token');
    });

    it('throws UnauthorizedException for an invalid/expired token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is not found', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'ghost-id', tokenVersion: 0 });
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('some-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when tokenVersion is stale (logged-out session)', async () => {
      const user = makeUser({ tokenVersion: 5 });
      jwtService.verifyAsync.mockResolvedValue({
        sub: user.id,
        tokenVersion: 3,          // old version — session was revoked
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
      password: 'secret123',
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

    it('throws BadRequestException when neither email nor phone provided', async () => {
      await expect(
        service.createManager({ ...dto, email: undefined, phoneNumber: undefined })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on duplicate email', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser());

      await expect(service.createManager(dto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on duplicate phone number', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeUser());

      await expect(service.createManager(dto)).rejects.toThrow(ConflictException);
    });

    it('hashes the password before saving', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ role: UserRole.SACCO_ADMIN });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.createManager(dto);

      const createCall = userRepo.create.mock.calls[0][0];
      const isHashed = await bcrypt.compare(dto.password, createCall.passwordHash);
      expect(isHashed).toBe(true);
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
      password: 'secret123',
      role: UserRole.CLERK,
      saccoId: 'sacco-123',
      assignedStage: 'stage-a',
    };

    const driverDto: CreateStaffDto = {
      fullName: 'Driver One',
      email: 'driver@example.com',
      phoneNumber: '0722222222',
      password: 'secret123',
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

    it('throws BadRequestException when neither email nor phone provided', async () => {
      await expect(
        service.createStaffUser({ ...clerkDto, email: undefined, phoneNumber: undefined }, saccoAdminCreator)
      ).rejects.toThrow(BadRequestException);
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
});