import api, { refreshApi } from "./axios";

// ─── Types (adjust to match your actual entity/DTO shapes) ─────────────────

export type UserRole = 'SUPER_ADMIN' | 'SACCO_ADMIN' | 'DRIVER' | 'CLERK' | string;

export interface RegisterPayload {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    role: UserRole;
}

export interface LoginPayload {
    identifier: string; // email or phone
    password: string;
}

// Admin-created accounts carry no password: the backend emails the new user a
// link and they choose their own.
export interface CreateStaffPayload {
    fullName: string;
    email: string;
    phoneNumber?: string;
    role: UserRole;
    saccoId?: string;
    assignedStage?: string;
}

export interface CreateManagerPayload {
    fullName: string;
    email: string;
    phoneNumber?: string;
    saccoId?: string;
}

export interface CreatedUserResponse extends User {
    /** False when the account was created but the invite email failed to go out. */
    inviteSent: boolean;
}

export interface User {
    id: string;
    fullName: string;
    email?: string | null;
    phoneNumber?: string | null;
    role: UserRole;
    saccoId?: string | null;
    createdAt?: string;
    assignedStage?: string | null
    isActive: boolean
    /** Null means the user was invited but hasn't set a password yet. */
    passwordSetAt?: string | null
}

export interface AuthResponse {
    access_token: string;
    refresh_token: string;
    user: User;
}

export type UserStatusFilter = 'active' | 'removed' | 'all';

export interface GetUsersParams {
    saccoId?: string;
    page?: number;
    limit?: number;
    search?: string
    /** Defaults to 'active' server-side — removed users are hidden unless asked for. */
    status?: UserStatusFilter
}

export interface PaginatedUsersResponse {
    data: User[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface UpdateUserPayload {
    fullName?: string;
    email?: string;
    phoneNumber?: string;
    role?: UserRole;
    saccoId?: string;
}

export const updateUserRequest = async (id: string, payload: UpdateUserPayload): Promise<User> => {
    const { data } = await api.patch<User>(`/auth/users/${id}`, payload);
    return data;
};

export const deleteUserRequest = async (id: string): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.delete<{ success: boolean; message: string }>(`/auth/users/${id}`);
    return data;
};

// Undoes a soft delete. Accounts that never set a password are erased on
// delete, so they never reach this — only real users can be restored.
export const restoreUserRequest = async (id: string) => {
    const { data } = await api.post<User & { inviteSent: boolean; message: string }>(
        `/auth/users/${id}/restore`,
    );
    return data;
};

export const getUsersRequest = async (
    params?: GetUsersParams,
): Promise<PaginatedUsersResponse> => {
    const { data } = await api.get<PaginatedUsersResponse>('/auth/users', { params });
    return data;
};

// ─── API calls ──────────────────────────────────────────────────────────────

export const registerRequest = async (payload: RegisterPayload): Promise<AuthResponse> => {
    const { data } = await api.post<AuthResponse>('/auth/register', payload);
    return data;
};

export const loginRequest = async (payload: LoginPayload): Promise<AuthResponse> => {
    const { data } = await api.post<AuthResponse>('/auth/login', payload);
    return data;
};

export const refreshRequest = async (): Promise<AuthResponse> => {
    const { data } = await refreshApi.post<AuthResponse>("/auth/refresh");
    return data;
};

export async function logoutRequest() {
    const res = await api.post("/auth/logout")
    return res.data
}

// admin-only — creates drivers/clerks (requires auth token attached via interceptor)
export const createStaffRequest = async (payload: CreateStaffPayload) => {
    const { data } = await api.post<CreatedUserResponse>('/auth/staff', payload);
    return data;
};

// super-admin-only — creates SACCO managers
export const createManagerRequest = async (payload: CreateManagerPayload) => {
    const { data } = await api.post<CreatedUserResponse>('/auth/managers', payload);
    return data;
};

// ─── Password flows ─────────────────────────────────────────────────────────

export interface PasswordLinkCheck {
    valid: boolean;
    purpose?: 'invite' | 'reset';
    fullName?: string;
    email?: string | null;
}

// Public. Always resolves with the same generic message, whether or not the
// address has an account — don't branch on it.
export const forgotPasswordRequest = async (email: string) => {
    const { data } = await api.post<{ success: boolean; message: string }>(
        '/auth/forgot-password',
        { email },
    );
    return data;
};

export const verifyPasswordLinkRequest = async (token: string) => {
    const { data } = await api.get<PasswordLinkCheck>('/auth/reset-password', {
        params: { token },
    });
    return data;
};

export const resetPasswordRequest = async (token: string, password: string) => {
    const { data } = await api.post<{ success: boolean; message: string }>(
        '/auth/reset-password',
        { token, password },
    );
    return data;
};

// Authenticated. Returns a fresh access token — the old session is invalidated
// server-side, so the caller must hand this to setSession.
export const changePasswordRequest = async (
    currentPassword: string,
    newPassword: string,
) => {
    const { data } = await api.post<{ access_token: string; user: User }>(
        '/auth/change-password',
        { currentPassword, newPassword },
    );
    return data;
};

// admin-only — re-sends the invite (or a reset link) to a user
export const sendPasswordLinkRequest = async (id: string) => {
    const { data } = await api.post<{
        success: boolean;
        purpose: 'invite' | 'reset';
        message: string;
    }>(`/auth/users/${id}/password-link`);
    return data;
};