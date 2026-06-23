import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
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
  tokenVersion: 0,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  ...overrides,
} as User);

// ─── Repository mock ──────────────────────────────────────────────────────────

const mockUserRepository = () => ({
  findOne: jest.fn(),
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

      const result = await service.register(dto);

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

    it('throws BadRequestException when neither email nor phone provided', async () => {
      await expect(
        service.register({ ...dto, email: undefined, phoneNumber: undefined })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on duplicate email', async () => {
      userRepo.findOne.mockResolvedValueOnce(makeUser()); // email clash

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on duplicate phone number', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)        // email → no clash
        .mockResolvedValueOnce(makeUser()); // phone → clash

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('hashes the password before saving', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser();
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.register(dto);

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
        email: undefined,
      });

      expect(result).toBeDefined();
    });

    it('stores saccoId when provided', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = makeUser({ saccoId: 'sacco-123' });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.register({ ...dto, saccoId: 'sacco-123' });

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
      jwtService.signAsync
        .mockResolvedValueOnce('new-access')
        .mockResolvedValueOnce('new-refresh');

      const result = await service.refresh('valid-refresh-token');

      expect(result.access_token).toBe('new-access');
      expect(result.refresh_token).toBe('new-refresh');
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
});