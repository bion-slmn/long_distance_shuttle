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

// Admin-created accounts carry no password: the new user sets their own from
// a single-use link. At least one of email or phone is required. With an
// email the link is also emailed; either way it comes back in the response
// so the admin can pass it on directly (WhatsApp, in practice).
export interface CreateStaffPayload {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    role: UserRole;
    saccoId?: string;
    assignedStage?: string;
}

export interface CreateManagerPayload {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    saccoId?: string;
}

export interface CreatedUserResponse extends User {
    /** False when no email went out: the user has no address, or the send failed. */
    inviteSent: boolean;
    /** The single-use set-password link. Always present so the admin can share it. */
    inviteLink: string;
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
    const { data } = await api.post<User & { inviteSent: boolean; inviteLink: string | null; message: string }>(
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


export const loginRequest = async (
    payload: LoginPayload
): Promise<AuthResponse> => {
    const { data } = await api.post<AuthResponse>(
        "/auth/login",
        payload,
        {
            skipAuthRefresh: true,
        }
    );

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

export interface PasswordLinkResult {
    success: boolean;
    purpose: 'invite' | 'reset';
    /** Whether an email went out. False for phone-only users or a failed send. */
    sent: boolean;
    /** The link itself, for the admin to share when it wasn't (or couldn't be) emailed. */
    link: string;
    message: string;
}

// admin-only — mints a fresh invite (or reset) link for a user, emailing it
// when they have an address, and returns it either way
export const sendPasswordLinkRequest = async (id: string) => {
    const { data } = await api.post<PasswordLinkResult>(`/auth/users/${id}/password-link`);
    return data;
};