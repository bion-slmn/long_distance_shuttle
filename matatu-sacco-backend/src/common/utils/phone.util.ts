// src/common/utils/phone.util.ts

/**
 * Kenyan mobile numbers arrive in four spellings — 0712…, +254712…, 254712…
 * and the 01xx Airtel/Telkom form — and a clerk who was created with one
 * spelling must be able to log in with another. Everything that stores or
 * looks up a phone number goes through here so there is one canonical form:
 * 254 followed by nine digits.
 *
 * Anything that isn't recognisably Kenyan is returned as its bare digits, so
 * a non-Kenyan number still round-trips instead of being rejected.
 * Returns null for empty input.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;

    if (/^254[17]\d{8}$/.test(digits)) return digits;
    if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
    if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;

    return digits;
}

/**
 * Every spelling a stored row might hold for this number. Rows written
 * before normalisation existed still carry the number as typed, so lookups
 * match on the raw trimmed value as well as the canonical one.
 */
export function phoneLookupForms(raw: string): string[] {
    const forms = new Set<string>();
    const trimmed = raw.trim();
    if (trimmed) forms.add(trimmed);
    const canonical = normalizePhone(raw);
    if (canonical) {
        forms.add(canonical);
        // The local spelling most legacy rows were saved in.
        if (/^254[17]\d{8}$/.test(canonical)) forms.add(`0${canonical.slice(3)}`);
    }
    return [...forms];
}
