import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRole } from './entities/user.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockTokenPair = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
};

const mockUser = {
  id: 'user-uuid-1',
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phoneNumber: '0712345678',
  role: UserRole.DRIVER,
  saccoId: null,
  createdAt: new Date('2024-01-01'),
};

const mockAuthResponse = { ...mockTokenPair, user: mockUser };

// ─── AuthService mock ─────────────────────────────────────────────────────────

const mockAuthService = () => ({
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AuthController', () => {
  let controller: AuthController;
  let authService: ReturnType<typeof mockAuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useFactory: mockAuthService },
      ],
    })
      // Override the guard so it never blocks controller tests
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Sanity ────────────────────────────────────────────────────────────────

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // register()
  // ─────────────────────────────────────────────────────────────────────────

  describe('register()', () => {
    const registerDto = {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phoneNumber: '0712345678',
      password: 'secret123',
      role: UserRole.DRIVER,
    };

    it('calls authService.register with the request body', async () => {
      authService.register.mockResolvedValue(mockUser);

      await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledTimes(1);
      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });

    it('returns whatever authService.register returns', async () => {
      authService.register.mockResolvedValue(mockUser);

      const result = await controller.register(registerDto);

      expect(result).toEqual(mockUser);
    });

    it('propagates exceptions from authService.register', async () => {
      authService.register.mockRejectedValue(new Error('Conflict'));

      await expect(controller.register(registerDto)).rejects.toThrow('Conflict');
    });

    it('works with phone-only registration (no email)', async () => {
      const phoneOnlyDto = { ...registerDto, email: undefined };
      authService.register.mockResolvedValue({ ...mockUser, email: null });

      const result = await controller.register(phoneOnlyDto);

      expect(authService.register).toHaveBeenCalledWith(phoneOnlyDto);
      expect(result).toBeDefined();
    });

    it('passes saccoId through when provided', async () => {
      const withSacco = { ...registerDto, saccoId: 'sacco-123' };
      authService.register.mockResolvedValue({ ...mockUser, saccoId: 'sacco-123' });

      await controller.register(withSacco);

      expect(authService.register).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-123' })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // login()
  // ─────────────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const loginDto = { identifier: 'jane@example.com', password: 'secret123' };

    it('calls authService.login with identifier and password', async () => {
      authService.login.mockResolvedValue(mockAuthResponse);

      await controller.login(loginDto);

      expect(authService.login).toHaveBeenCalledTimes(1);
      expect(authService.login).toHaveBeenCalledWith(
        loginDto.identifier,
        loginDto.password,
      );
    });

    it('returns the full auth response (tokens + user)', async () => {
      authService.login.mockResolvedValue(mockAuthResponse);

      const result = await controller.login(loginDto);

      expect(result).toMatchObject({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        user: expect.objectContaining({ id: mockUser.id }),
      });
    });

    it('works with a phone number as identifier', async () => {
      const phoneLogin = { identifier: '0712345678', password: 'secret123' };
      authService.login.mockResolvedValue(mockAuthResponse);

      await controller.login(phoneLogin);

      expect(authService.login).toHaveBeenCalledWith('0712345678', 'secret123');
    });

    it('propagates UnauthorizedException from authService.login', async () => {
      authService.login.mockRejectedValue(new Error('Unauthorized'));

      await expect(controller.login(loginDto)).rejects.toThrow('Unauthorized');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // refresh()
  // ─────────────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    const refreshDto = { refresh_token: 'valid-refresh-token' };

    it('calls authService.refresh with the refresh token', async () => {
      authService.refresh.mockResolvedValue(mockTokenPair);

      await controller.refresh(refreshDto);

      expect(authService.refresh).toHaveBeenCalledTimes(1);
      expect(authService.refresh).toHaveBeenCalledWith(refreshDto.refresh_token);
    });

    it('returns a new token pair', async () => {
      authService.refresh.mockResolvedValue(mockTokenPair);

      const result = await controller.refresh(refreshDto);

      expect(result).toEqual({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
      });
    });

    it('propagates UnauthorizedException for expired tokens', async () => {
      authService.refresh.mockRejectedValue(new Error('Token expired'));

      await expect(controller.refresh(refreshDto)).rejects.toThrow('Token expired');
    });

    it('propagates UnauthorizedException for stale tokenVersion', async () => {
      authService.refresh.mockRejectedValue(
        new Error('Session expired. Please log in again.')
      );

      await expect(controller.refresh(refreshDto)).rejects.toThrow(
        'Session expired. Please log in again.'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // logout()
  // ─────────────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    const mockReq = { user: { sub: 'user-uuid-1' } };

    it('calls authService.logout with the user id from the request', async () => {
      authService.logout.mockResolvedValue({
        success: true,
        message: 'Logged out successfully. Safe travels!',
      });

      await controller.logout(mockReq);

      expect(authService.logout).toHaveBeenCalledTimes(1);
      expect(authService.logout).toHaveBeenCalledWith('user-uuid-1');
    });

    it('returns success true and a message', async () => {
      authService.logout.mockResolvedValue({
        success: true,
        message: 'Logged out successfully. Safe travels!',
      });

      const result = await controller.logout(mockReq);

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining('Logged out'),
      });
    });

    it('extracts user id from req.user.sub', async () => {
      const differentReq = { user: { sub: 'another-uuid' } };
      authService.logout.mockResolvedValue({ success: true, message: 'Logged out' });

      await controller.logout(differentReq);

      expect(authService.logout).toHaveBeenCalledWith('another-uuid');
    });

    it('propagates errors from authService.logout', async () => {
      authService.logout.mockRejectedValue(new Error('User not found'));

      await expect(controller.logout(mockReq)).rejects.toThrow('User not found');
    });
  });
});