import api, { refreshApi } from "./axios";

// ─── Types (adjust to match your actual entity/DTO shapes) ─────────────────

export type UserRole = 'SUPER_ADMIN' | 'SACCO_ADMIN' | 'DRIVER' | 'CLERK' | string;

export interface RegisterPayload {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    role: UserRole;
    saccoId?: string;
}

export interface LoginPayload {
    identifier: string; // email or phone
    password: string;
}

export interface CreateStaffPayload {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    role: UserRole;
    saccoId?: string;
}

export interface CreateManagerPayload {
    fullName: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    saccoId?: string;
}

export interface User {
    id: string;
    fullName: string;
    email?: string | null;
    phoneNumber?: string | null;
    role: UserRole;
    saccoId?: string | null;
    createdAt?: string;
}

export interface AuthResponse {
    access_token: string;
    refresh_token: string;
    user: User;
}

export interface GetUsersParams {
    saccoId?: string;
    page?: number;
    limit?: number;
    search?: string
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

// admin-only — creates drivers/clerks (requires auth token attached via interceptor)
export const createStaffRequest = async (payload: CreateStaffPayload) => {
    const { data } = await api.post('/auth/staff', payload);
    return data;
};

// super-admin-only — creates SACCO managers
export const createManagerRequest = async (payload: CreateManagerPayload) => {
    const { data } = await api.post('/auth/managers', payload);
    return data;
};