// src/api/saccoApi.ts
import api from "@/api/axios";
export interface SaccoContact {
    label: string;
    phone: string;
}

export interface SaccoEmail {
    label: string;
    email: string;
}
// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateSaccoDto {
    name: string;
    registrationNumber?: string;
    contacts?: SaccoContact[];
    emails?: SaccoEmail[];
    headquarters?: string;
}

export interface UpdateSaccoDto {
    name?: string;
    registrationNumber?: string;
    contacts?: SaccoContact[];
    emails?: SaccoEmail[];
    headquarters?: string;
    isActive?: boolean;
}

export interface Sacco {
    id: string;
    name: string;
    registrationNumber?: string;
    contacts: SaccoContact[];
    emails: SaccoEmail[];
    headquarters?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt?: string;
}

// ─── Requests ────────────────────────────────────────────────────────────────

// POST /saccos — SUPER_ADMIN only
export const createSaccoRequest = async (payload: CreateSaccoDto): Promise<Sacco> => {
    const { data } = await api.post<Sacco>("/saccos", payload);
    return data;
};

// GET /saccos — SUPER_ADMIN, SACCO_ADMIN, CLERK (scoped server-side)
interface GetSaccosOptions {
    includeInactive?: boolean;
    page?: number;
    limit?: number;
    minimalFields?: boolean;
    search?: string;
}

export async function getSaccosRequest(
    options: GetSaccosOptions = {},
) {
    const {
        includeInactive = false,
        page = 1,
        limit = 20,
        minimalFields = false,
        search,
    } = options;

    const params = new URLSearchParams({
        includeInactive: String(includeInactive),
        page: String(page),
        limit: String(limit),
    });

    if (minimalFields) params.set("minimalFields", "true");
    if (search?.trim()) params.set("search", search.trim());

    const res = await api.get(`/saccos?${params.toString()}`);
    return res.data;
}

// GET /saccos/:id
export const getSaccoByIdRequest = async (id: string): Promise<Sacco> => {
    const { data } = await api.get<Sacco>(`/saccos/${id}`);
    return data;
};

// PATCH /saccos/:id — SUPER_ADMIN, SACCO_ADMIN (own sacco only)
export const updateSaccoRequest = async (
    id: string,
    payload: UpdateSaccoDto,
): Promise<Sacco> => {
    const { data } = await api.patch<Sacco>(`/saccos/${id}`, payload);
    return data;
};

// PATCH /saccos/:id/deactivate — SUPER_ADMIN only
export const deactivateSaccoRequest = async (id: string): Promise<Sacco> => {
    const { data } = await api.patch<Sacco>(`/saccos/${id}/deactivate`);
    return data;
};

// PATCH /saccos/:id/reactivate — SUPER_ADMIN only
export const reactivateSaccoRequest = async (id: string): Promise<Sacco> => {
    const { data } = await api.patch<Sacco>(`/saccos/${id}/reactivate`);
    return data;
};

// POST /saccos/:id/contacts — SUPER_ADMIN, SACCO_ADMIN (own sacco only)
export const addSaccoContactRequest = async (
    id: string,
    contact: SaccoContact,
): Promise<Sacco> => {
    const { data } = await api.post<Sacco>(`/saccos/${id}/contacts`, contact);
    return data;
};

// DELETE /saccos/:id/contacts/:phone
export const removeSaccoContactRequest = async (
    id: string,
    phone: string,
): Promise<Sacco> => {
    const { data } = await api.delete<Sacco>(
        `/saccos/${id}/contacts/${encodeURIComponent(phone)}`,
    );
    return data;
};

// POST /saccos/:id/emails — SUPER_ADMIN, SACCO_ADMIN (own sacco only)
export const addSaccoEmailRequest = async (
    id: string,
    email: SaccoEmail,
): Promise<Sacco> => {
    const { data } = await api.post<Sacco>(`/saccos/${id}/emails`, email);
    return data;
};

// DELETE /saccos/:id/emails/:emailAddress
export const removeSaccoEmailRequest = async (
    id: string,
    emailAddress: string,
): Promise<Sacco> => {
    const { data } = await api.delete<Sacco>(
        `/saccos/${id}/emails/${encodeURIComponent(emailAddress)}`,
    );
    return data;
};