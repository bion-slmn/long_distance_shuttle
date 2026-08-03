import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
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
  assignedStage: null,
  createdAt: new Date('2024-01-01'),
};

const mockAuthResponse = { ...mockTokenPair, user: mockUser };

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth/refresh';

const expectedCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: REFRESH_COOKIE_PATH,
};

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const mockAuthService = () => ({
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  createStaffUser: jest.fn(),
  getUsers: jest.fn(),
  createManager: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
});

const mockResponse = () => {
  const res: any = {};
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

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
      role: UserRole.PASSENGER,
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
      const res = mockResponse();

      await controller.login(loginDto, res);

      expect(authService.login).toHaveBeenCalledTimes(1);
      expect(authService.login).toHaveBeenCalledWith(
        loginDto.identifier,
        loginDto.password,
      );
    });

    it('sets the refresh token as an httpOnly cookie', async () => {
      authService.login.mockResolvedValue(mockAuthResponse);
      const res = mockResponse();

      await controller.login(loginDto, res);

      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        mockTokenPair.refresh_token,
        expectedCookieOptions,
      );
    });

    it('returns only access_token and user in the body (never the refresh token)', async () => {
      authService.login.mockResolvedValue(mockAuthResponse);
      const res = mockResponse();

      const result = await controller.login(loginDto, res);

      expect(result).toEqual({
        access_token: mockTokenPair.access_token,
        user: mockUser,
      });
      expect(result).not.toHaveProperty('refresh_token');
    });

    it('works with a phone number as identifier', async () => {
      const phoneLogin = { identifier: '0712345678', password: 'secret123' };
      authService.login.mockResolvedValue(mockAuthResponse);
      const res = mockResponse();

      await controller.login(phoneLogin, res);

      expect(authService.login).toHaveBeenCalledWith('0712345678', 'secret123');
    });

    it('propagates UnauthorizedException from authService.login', async () => {
      authService.login.mockRejectedValue(new Error('Unauthorized'));
      const res = mockResponse();

      await expect(controller.login(loginDto, res)).rejects.toThrow('Unauthorized');
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // refresh()
  // ─────────────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('reads the refresh token from the cookie and calls authService.refresh', async () => {
      const req: any = { cookies: { [REFRESH_COOKIE_NAME]: 'valid-refresh-token' } };
      const res = mockResponse();
      authService.refresh.mockResolvedValue(mockTokenPair);

      await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledTimes(1);
      expect(authService.refresh).toHaveBeenCalledWith('valid-refresh-token');
    });

    it('throws UnauthorizedException when no refresh_token cookie is present', async () => {
      const req: any = { cookies: {} };
      const res = mockResponse();

      await expect(controller.refresh(req, res)).rejects.toThrow(UnauthorizedException);
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when req.cookies itself is undefined', async () => {
      const req: any = {};
      const res = mockResponse();

      await expect(controller.refresh(req, res)).rejects.toThrow(UnauthorizedException);
    });

    it('re-sets the refresh_token cookie with the rotated value', async () => {
      const req: any = { cookies: { [REFRESH_COOKIE_NAME]: 'valid-refresh-token' } };
      const res = mockResponse();
      authService.refresh.mockResolvedValue({
        access_token: 'new-access',
        refresh_token: 'same-or-new-refresh',
      });

      await controller.refresh(req, res);

      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'same-or-new-refresh',
        expectedCookieOptions,
      );
    });

    it('returns the full result from authService.refresh', async () => {
      const req: any = { cookies: { [REFRESH_COOKIE_NAME]: 'valid-refresh-token' } };
      const res = mockResponse();
      authService.refresh.mockResolvedValue(mockTokenPair);

      const result = await controller.refresh(req, res);

      expect(result).toEqual(mockTokenPair);
    });

    it('propagates errors from authService.refresh (e.g. expired/stale token)', async () => {
      const req: any = { cookies: { [REFRESH_COOKIE_NAME]: 'stale-token' } };
      const res = mockResponse();
      authService.refresh.mockRejectedValue(
        new Error('Session expired. Please log in again.')
      );

      await expect(controller.refresh(req, res)).rejects.toThrow(
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
      const res = mockResponse();
      authService.logout.mockResolvedValue({
        success: true,
        message: 'Logged out successfully. Safe travels!',
      });

      await controller.logout(mockReq, res);

      expect(authService.logout).toHaveBeenCalledTimes(1);
      expect(authService.logout).toHaveBeenCalledWith('user-uuid-1');
    });

    it('clears the refresh_token cookie', async () => {
      const res = mockResponse();
      authService.logout.mockResolvedValue({ success: true, message: 'Logged out' });

      await controller.logout(mockReq, res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expectedCookieOptions,
      );
    });

    it('returns success true and a message', async () => {
      const res = mockResponse();
      authService.logout.mockResolvedValue({
        success: true,
        message: 'Logged out successfully. Safe travels!',
      });

      const result = await controller.logout(mockReq, res);

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining('Logged out'),
      });
    });

    it('extracts user id from req.user.sub', async () => {
      const res = mockResponse();
      const differentReq = { user: { sub: 'another-uuid' } };
      authService.logout.mockResolvedValue({ success: true, message: 'Logged out' });

      await controller.logout(differentReq, res);

      expect(authService.logout).toHaveBeenCalledWith('another-uuid');
    });

    it('propagates errors from authService.logout', async () => {
      const res = mockResponse();
      authService.logout.mockRejectedValue(new Error('User not found'));

      await expect(controller.logout(mockReq, res)).rejects.toThrow('User not found');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createStaff()
  // ─────────────────────────────────────────────────────────────────────────

  describe('createStaff()', () => {
    const staffDto = {
      fullName: 'Clerk One',
      email: 'clerk@example.com',
      phoneNumber: '0711111111',
      password: 'secret123',
      role: UserRole.CLERK,
      saccoId: 'sacco-123',
      assignedStage: 'stage-a',
    };
    const req: any = { user: { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' } };

    it('delegates to authService.createStaffUser with the body and req.user', async () => {
      authService.createStaffUser.mockResolvedValue({ id: 'staff-1', ...staffDto });

      await controller.createStaff(staffDto, req);

      expect(authService.createStaffUser).toHaveBeenCalledWith(staffDto, req.user);
    });

    it('returns whatever authService.createStaffUser returns', async () => {
      const created = { id: 'staff-1', ...staffDto };
      authService.createStaffUser.mockResolvedValue(created);

      const result = await controller.createStaff(staffDto, req);

      expect(result).toEqual(created);
    });

    it('propagates authorization errors (e.g. cross-sacco creation)', async () => {
      authService.createStaffUser.mockRejectedValue(new UnauthorizedException());

      await expect(controller.createStaff(staffDto, req)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getUsers()
  // ─────────────────────────────────────────────────────────────────────────

  describe('getUsers()', () => {
    const paginatedResult = {
      data: [mockUser],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    };

    it('locks sacco admins to their own saccoId regardless of query param', async () => {
      const req: any = { user: { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' } };
      authService.getUsers.mockResolvedValue(paginatedResult);

      await controller.getUsers('someone-elses-sacco', undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-123' })
      );
    });

    it('lets super admins filter by whatever saccoId is passed', async () => {
      const req: any = { user: { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null } };
      authService.getUsers.mockResolvedValue(paginatedResult);

      await controller.getUsers('sacco-999', undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-999' })
      );
    });

    it('lets super admins omit saccoId to get all users', async () => {
      const req: any = { user: { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null } };
      authService.getUsers.mockResolvedValue(paginatedResult);

      await controller.getUsers(undefined, undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined })
      );
    });

    it('converts page and limit query strings to numbers', async () => {
      const req: any = { user: { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null } };
      authService.getUsers.mockResolvedValue(paginatedResult);

      await controller.getUsers(undefined, '3', '10', undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, limit: 10 })
      );
    });

    it('leaves page and limit undefined when not provided', async () => {
      const req: any = { user: { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null } };
      authService.getUsers.mockResolvedValue(paginatedResult);

      await controller.getUsers(undefined, undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: undefined, limit: undefined })
      );
    });

    it('passes the search term through', async () => {
      const req: any = { user: { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null } };
      authService.getUsers.mockResolvedValue(paginatedResult);

      await controller.getUsers(undefined, undefined, undefined, 'jane', req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'jane' })
      );
    });

    it('returns whatever authService.getUsers returns', async () => {
      const req: any = { user: { sub: 'super-1', role: UserRole.SUPER_ADMIN, saccoId: null } };
      authService.getUsers.mockResolvedValue(paginatedResult);

      const result = await controller.getUsers(undefined, undefined, undefined, undefined, req);

      expect(result).toEqual(paginatedResult);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createManager()
  // ─────────────────────────────────────────────────────────────────────────

  describe('createManager()', () => {
    const managerDto = {
      fullName: 'Sacco Manager',
      email: 'manager@example.com',
      phoneNumber: '0700000000',
      password: 'secret123',
      saccoId: 'sacco-123',
    };

    it('delegates to authService.createManager with the dto', async () => {
      authService.createManager.mockResolvedValue({ id: 'manager-1', ...managerDto });

      await controller.createManager(managerDto);

      expect(authService.createManager).toHaveBeenCalledWith(managerDto);
    });

    it('returns whatever authService.createManager returns', async () => {
      const created = { id: 'manager-1', ...managerDto };
      authService.createManager.mockResolvedValue(created);

      const result = await controller.createManager(managerDto);

      expect(result).toEqual(created);
    });

    it('propagates errors from authService.createManager', async () => {
      authService.createManager.mockRejectedValue(new Error('Conflict'));

      await expect(controller.createManager(managerDto)).rejects.toThrow('Conflict');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateUser()
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateUser()', () => {
    const req: any = { user: { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' } };
    const updateDto = { fullName: 'New Name' };

    it('delegates to authService.updateUser with id, dto, and req.user', async () => {
      authService.updateUser.mockResolvedValue({ ...mockUser, fullName: 'New Name' });

      await controller.updateUser('target-1', updateDto, req);

      expect(authService.updateUser).toHaveBeenCalledWith('target-1', updateDto, req.user);
    });

    it('returns whatever authService.updateUser returns', async () => {
      const updated = { ...mockUser, fullName: 'New Name' };
      authService.updateUser.mockResolvedValue(updated);

      const result = await controller.updateUser('target-1', updateDto, req);

      expect(result).toEqual(updated);
    });

    it('propagates authorization errors (e.g. cross-sacco edit)', async () => {
      authService.updateUser.mockRejectedValue(new UnauthorizedException());

      await expect(controller.updateUser('target-1', updateDto, req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // deleteUser()
  // ─────────────────────────────────────────────────────────────────────────

  describe('deleteUser()', () => {
    const req: any = { user: { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-123' } };

    it('delegates to authService.deleteUser with id and req.user', async () => {
      authService.deleteUser.mockResolvedValue({ success: true, message: 'User removed.' });

      await controller.deleteUser('target-1', req);

      expect(authService.deleteUser).toHaveBeenCalledWith('target-1', req.user);
    });

    it('returns whatever authService.deleteUser returns', async () => {
      const deleted = { success: true, message: 'User removed.' };
      authService.deleteUser.mockResolvedValue(deleted);

      const result = await controller.deleteUser('target-1', req);

      expect(result).toEqual(deleted);
    });

    it('propagates errors (e.g. self-delete attempt)', async () => {
      authService.deleteUser.mockRejectedValue(new Error('You cannot delete your own account.'));

      await expect(controller.deleteUser('admin-1', req)).rejects.toThrow(
        'You cannot delete your own account.',
      );
    });
  });
});