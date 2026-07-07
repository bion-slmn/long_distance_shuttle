import api from "./axios";

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

export interface AuthResponse {
    access_token: string;
    refresh_token: string;
    user: {
        id: string;
        fullName: string;
        email?: string;
        phoneNumber?: string;
        role: UserRole;
        saccoId?: string;
    };
}

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
    const { data } = await api.post<AuthResponse>('/auth/refresh');
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