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
    vehicleCount?: number
    userCount?: number
    routeCount?: number
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface SaccoCountStats {
    currentCount: number;
    lastWeekCount: number;
    percentageChange: number;
    changeDirection: 'up' | 'down' | 'no-change';
}

// GET /saccos/stats/count — SUPER_ADMIN only
export const getSaccoCountStatsRequest = async (
    includeInactive = false,
): Promise<SaccoCountStats> => {
    const params = new URLSearchParams({ includeInactive: String(includeInactive) });
    const { data } = await api.get<SaccoCountStats>(`/saccos/stats/count?${params.toString()}`);
    return data;
};

export interface SaccoPerformanceSummary {
    saccoId: string;
    saccoName: string;
    isActive: boolean;
    tripsThisWeek: number;
    tripsLastWeek: number;
    tripsChangePercent: number | null;
    bookingsThisWeek: number;
    uniquePassengersThisWeek: number;
    grossFaresThisWeek: number;
    lastActiveDate: string | null;
    status: 'Healthy' | 'Low Activity' | 'Inactive';
}

// GET /saccos/stats/performance — SUPER_ADMIN (all saccos) or SACCO_ADMIN (own sacco only)
export const getSaccoPerformanceStatsRequest = async (
    includeInactive = false,
): Promise<SaccoPerformanceSummary[]> => {
    const params = new URLSearchParams({ includeInactive: String(includeInactive) });
    const { data } = await api.get<SaccoPerformanceSummary[]>(
        `/saccos/stats/performance?${params.toString()}`,
    );
    return data;
};

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
    withCounts?: boolean
}

interface GetSaccosResponse {
    data: Sacco[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export async function getSaccosRequest(
    options: GetSaccosOptions = {},
): Promise<GetSaccosResponse> {
    const {
        includeInactive = false,
        page = 1,
        limit = 20,
        minimalFields = false,
        search,
        withCounts = false,
    } = options;

    const params = new URLSearchParams({
        includeInactive: String(includeInactive),
        page: String(page),
        limit: String(limit),
    });

    if (minimalFields) params.set("minimalFields", "true");
    if (search?.trim()) params.set("search", search.trim());
    if (withCounts) params.set("withCounts", "true");

    const res = await api.get<GetSaccosResponse>(`/saccos?${params.toString()}`);
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

// ─── Sacco Settings ──────────────────────────────────────────────────────────

export interface SaccoSettings {
    saccoId: string;
    commissionRate: number;
    isAcceptingBookings: boolean;
    acceptsMpesa: boolean;
    acceptsCash: boolean;
    mpesaShortcode?: string;
    mpesaConfigured: boolean;
    // ── Pre-booking limits — fixed MVP defaults, read-only for now ──
    // Not yet editable via updateSaccoSettingsRequest; included here so
    // the frontend can display current limits once needed (e.g. a
    // "Booking limits" info panel), even before an edit form exists.
    preBookingEnabled: boolean;
    preBookingMorningStart: string; // 'HH:mm:ss'
    preBookingMorningEnd: string;   // 'HH:mm:ss'
    preBookingMaxMorningVehicles: number;
    preBookingMaxSeatsPerTrip: number;
    createdAt: string;
    updatedAt: string;
    // Note: mpesaConsumerKey, mpesaConsumerSecretEncrypted, and
    // mpesaPasskeyEncrypted are intentionally never returned by the API.
}

export interface UpdateSaccoSettingsDto {
    commissionRate?: number;
    isAcceptingBookings?: boolean;
    acceptsCash?: boolean;
    // Pre-booking limits are intentionally NOT included here — the backend
    // doesn't accept them via PATCH yet (see SaccoSettingsService.update()).
    // Add them here once that becomes editable.
}



export interface ConfigureMpesaDto {
    shortcode: string;
    consumerKey: string;
    consumerSecret: string;
    passkey: string;
}

// GET /saccos/:saccoId/settings — SUPER_ADMIN, SACCO_ADMIN (own sacco only)
export const getSaccoSettingsRequest = async (
    saccoId: string,
): Promise<SaccoSettings> => {
    const { data } = await api.get<SaccoSettings>(`/saccos/${saccoId}/settings`);
    return data;
};

// The clerk-readable slice of settings. Deliberately narrow — the booking
// sheet needs to know which payment pills to offer, and nothing else from
// the settings row is safe to hand a clerk.
export interface SaccoPaymentOptions {
    saccoId: string;
    acceptsCash: boolean;
    acceptsMpesa: boolean;
    mpesaConfigured: boolean;
    mpesaShortcode: string | null;
}

// GET /saccos/:saccoId/settings/payment-options — SUPER_ADMIN, SACCO_ADMIN, CLERK
export const getSaccoPaymentOptionsRequest = async (
    saccoId: string,
): Promise<SaccoPaymentOptions> => {
    const { data } = await api.get<SaccoPaymentOptions>(
        `/saccos/${saccoId}/settings/payment-options`,
    );
    return data;
};

// PATCH /saccos/:saccoId/settings — SUPER_ADMIN, SACCO_ADMIN (own sacco only)
export const updateSaccoSettingsRequest = async (
    saccoId: string,
    payload: UpdateSaccoSettingsDto,
): Promise<SaccoSettings> => {
    const { data } = await api.patch<SaccoSettings>(`/saccos/${saccoId}/settings`, payload);
    return data;
};

// POST /saccos/:saccoId/settings/mpesa — SUPER_ADMIN, SACCO_ADMIN (own sacco only)
export const configureSaccoMpesaRequest = async (
    saccoId: string,
    payload: ConfigureMpesaDto,
): Promise<SaccoSettings> => {
    const { data } = await api.post<SaccoSettings>(
        `/saccos/${saccoId}/settings/mpesa`,
        payload,
    );
    return data;
};

// POST /saccos/:saccoId/settings/mpesa/disable — SUPER_ADMIN, SACCO_ADMIN (own sacco only)
export const disableSaccoMpesaRequest = async (
    saccoId: string,
): Promise<SaccoSettings> => {
    const { data } = await api.post<SaccoSettings>(
        `/saccos/${saccoId}/settings/mpesa/disable`,
    );
    return data;
};