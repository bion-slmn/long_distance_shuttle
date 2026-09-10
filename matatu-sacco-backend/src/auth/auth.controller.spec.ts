// src/auth/auth.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRole } from './entities/user.entity';

type MockAuthService = Partial<Record<keyof AuthService, jest.Mock>>;

describe('AuthController', () => {
  let controller: AuthController;
  let authService: MockAuthService;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      forgotPassword: jest.fn(),
      verifyPasswordToken: jest.fn(),
      resetPassword: jest.fn(),
      changePassword: jest.fn(),
      createStaffUser: jest.fn(),
      getUsers: jest.fn(),
      createManager: jest.fn(),
      updateUser: jest.fn(),
      sendPasswordLinkForUser: jest.fn(),
      restoreUser: jest.fn(),
      deleteUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── register ────────────────────────────────────────────────────────
  describe('register', () => {
    it('delegates to authService.register with the request body', () => {
      const body = {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123',
        role: UserRole.SACCO_ADMIN,
      };
      const expected = { id: 'user-1' };
      authService.register!.mockResolvedValue(expected);

      const result = controller.register(body as any);

      expect(authService.register).toHaveBeenCalledWith(body);
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── login ───────────────────────────────────────────────────────────
  describe('login', () => {
    it('delegates to authService.login with identifier and password', () => {
      const body = { identifier: 'jane@example.com', password: 'password123' };
      const expected = { access_token: 'a', refresh_token: 'r', user: { id: 'user-1' } };
      authService.login!.mockResolvedValue(expected);

      const result = controller.login(body as any);

      expect(authService.login).toHaveBeenCalledWith(body.identifier, body.password);
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── refresh ─────────────────────────────────────────────────────────
  describe('refresh', () => {
    it('throws UnauthorizedException when no refresh_token is provided', async () => {
      await expect(controller.refresh({ refresh_token: '' } as any)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when refresh_token is undefined', async () => {
      await expect(controller.refresh({} as any)).rejects.toThrow(UnauthorizedException);
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('delegates to authService.refresh when a token is provided', async () => {
      const expected = { access_token: 'new-a', refresh_token: 'new-r' };
      authService.refresh!.mockResolvedValue(expected);

      const result = await controller.refresh({ refresh_token: 'old-r' } as any);

      expect(authService.refresh).toHaveBeenCalledWith('old-r');
      expect(result).toEqual(expected);
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────
  describe('logout', () => {
    it("delegates to authService.logout with the caller's user id", () => {
      const req = { user: { sub: 'user-1' } };
      const expected = { success: true };
      authService.logout!.mockResolvedValue(expected);

      const result = controller.logout(req);

      expect(authService.logout).toHaveBeenCalledWith('user-1');
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── forgotPassword ──────────────────────────────────────────────────
  describe('forgotPassword', () => {
    it('delegates to authService.forgotPassword with the email', () => {
      const body = { email: 'jane@example.com' };
      authService.forgotPassword!.mockResolvedValue(undefined);

      controller.forgotPassword(body as any);

      expect(authService.forgotPassword).toHaveBeenCalledWith('jane@example.com');
    });
  });

  // ─── verifyResetToken ────────────────────────────────────────────────
  describe('verifyResetToken', () => {
    it('delegates to authService.verifyPasswordToken with the token query param', () => {
      const expected = { valid: true };
      authService.verifyPasswordToken!.mockResolvedValue(expected);

      const result = controller.verifyResetToken('token-abc');

      expect(authService.verifyPasswordToken).toHaveBeenCalledWith('token-abc');
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── resetPassword ───────────────────────────────────────────────────
  describe('resetPassword', () => {
    it('delegates to authService.resetPassword with token and new password', () => {
      const body = { token: 'token-abc', password: 'newpassword123' };
      authService.resetPassword!.mockResolvedValue(undefined);

      controller.resetPassword(body as any);

      expect(authService.resetPassword).toHaveBeenCalledWith('token-abc', 'newpassword123');
    });
  });

  // ─── changePassword ──────────────────────────────────────────────────
  describe('changePassword', () => {
    it("delegates to authService.changePassword with the caller's id and both passwords", () => {
      const body = { currentPassword: 'oldpass123', newPassword: 'newpass123' };
      const req = { user: { sub: 'user-1' } };
      const expected = { access_token: 'a', refresh_token: 'r' };
      authService.changePassword!.mockResolvedValue(expected);

      const result = controller.changePassword(body as any, req);

      expect(authService.changePassword).toHaveBeenCalledWith(
        'user-1',
        'oldpass123',
        'newpass123',
      );
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── createStaff ─────────────────────────────────────────────────────
  describe('createStaff', () => {
    it("delegates to authService.createStaffUser with the dto and caller's user", () => {
      const body = { fullName: 'Staff One', saccoId: 'sacco-1' };
      const req = { user: { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' } };
      const expected = { id: 'staff-1' };
      authService.createStaffUser!.mockResolvedValue(expected);

      const result = controller.createStaff(body as any, req);

      expect(authService.createStaffUser).toHaveBeenCalledWith(body, req.user);
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── getUsers ────────────────────────────────────────────────────────
  describe('getUsers', () => {
    it("scopes to the caller's saccoId when the caller is a SACCO_ADMIN, ignoring the query param", () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-own' } };
      authService.getUsers!.mockResolvedValue([]);

      controller.getUsers('sacco-other', undefined, undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-own' }),
      );
    });

    it('uses the query saccoId when the caller is a SUPER_ADMIN', () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      authService.getUsers!.mockResolvedValue([]);

      controller.getUsers('sacco-target', undefined, undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: 'sacco-target' }),
      );
    });

    it('leaves saccoId undefined for a SUPER_ADMIN with no query param', () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      authService.getUsers!.mockResolvedValue([]);

      controller.getUsers(undefined, undefined, undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: undefined }),
      );
    });

    it('converts page and limit query strings to numbers', () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      authService.getUsers!.mockResolvedValue([]);

      controller.getUsers(undefined, '2', '25', undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 25 }),
      );
    });

    it('leaves page and limit undefined when not provided', () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      authService.getUsers!.mockResolvedValue([]);

      controller.getUsers(undefined, undefined, undefined, undefined, undefined, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: undefined, limit: undefined }),
      );
    });

    it('passes search and status straight through', () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      authService.getUsers!.mockResolvedValue([]);

      controller.getUsers(undefined, undefined, undefined, 'jane', 'active' as any, req);

      expect(authService.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'jane', status: 'active' }),
      );
    });
  });

  // ─── createManager ───────────────────────────────────────────────────
  describe('createManager', () => {
    it('delegates to authService.createManager with the dto', () => {
      const dto = { fullName: 'Manager One', saccoId: 'sacco-1' };
      const expected = { id: 'manager-1' };
      authService.createManager!.mockResolvedValue(expected);

      const result = controller.createManager(dto as any);

      expect(authService.createManager).toHaveBeenCalledWith(dto);
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── updateUser ──────────────────────────────────────────────────────
  describe('updateUser', () => {
    it("delegates to authService.updateUser with id, dto, and the caller's user", () => {
      const dto = { fullName: 'Updated Name' };
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      const expected = { id: 'user-1', fullName: 'Updated Name' };
      authService.updateUser!.mockResolvedValue(expected);

      const result = controller.updateUser('user-1', dto as any, req);

      expect(authService.updateUser).toHaveBeenCalledWith('user-1', dto, req.user);
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── sendPasswordLink ────────────────────────────────────────────────
  describe('sendPasswordLink', () => {
    it("delegates to authService.sendPasswordLinkForUser with id and the caller's user", () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SACCO_ADMIN, saccoId: 'sacco-1' } };
      const expected = { sent: true };
      authService.sendPasswordLinkForUser!.mockResolvedValue(expected);

      const result = controller.sendPasswordLink('user-1', req);

      expect(authService.sendPasswordLinkForUser).toHaveBeenCalledWith('user-1', req.user);
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── restoreUser ─────────────────────────────────────────────────────
  describe('restoreUser', () => {
    it("delegates to authService.restoreUser with id and the caller's user", () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      const expected = { id: 'user-1', deletedAt: null };
      authService.restoreUser!.mockResolvedValue(expected);

      const result = controller.restoreUser('user-1', req);

      expect(authService.restoreUser).toHaveBeenCalledWith('user-1', req.user);
      expect(result).resolves.toEqual(expected);
    });
  });

  // ─── deleteUser ──────────────────────────────────────────────────────
  describe('deleteUser', () => {
    it("delegates to authService.deleteUser with id and the caller's user", () => {
      const req = { user: { sub: 'admin-1', role: UserRole.SUPER_ADMIN } };
      const expected = { deleted: true };
      authService.deleteUser!.mockResolvedValue(expected);

      const result = controller.deleteUser('user-1', req);

      expect(authService.deleteUser).toHaveBeenCalledWith('user-1', req.user);
      expect(result).resolves.toEqual(expected);
    });
  });
});