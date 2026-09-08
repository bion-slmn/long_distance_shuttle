// src/lib/dateRange.ts
//
// Date helpers shared by the report-style lists (bookings, payments). All of
// them work in the browser's local time zone on purpose: toISOString() is
// UTC, so between midnight and 03:00 in Nairobi (UTC+3) it still reads as
// yesterday, which would quietly show the wrong day on a list that defaults
// to "today".

export function toLocalDateString(d: Date): string {
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

export function todayString(): string {
    return toLocalDateString(new Date());
}

export function daysAgoString(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return toLocalDateString(d);
}

/** Quick ranges; `days` is how far back from today the range starts. */
export const RANGE_PRESETS = [
    { label: "Today", days: 0 },
    { label: "7 days", days: 6 },
    { label: "30 days", days: 29 },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export function formatTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-KE", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatDateTime(
    iso: string | null,
    options: { seconds?: boolean } = {},
): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-KE", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...(options.seconds ? { second: "2-digit" } : {}),
    });
}

/**
 * "Mon, 8 Sep" from a bare "YYYY-MM-DD". Parsing it as local midnight keeps
 * the weekday right; a UTC parse shifts it to the previous evening in Nairobi.
 */
export function formatDay(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString("en-KE", {
        weekday: "short",
        day: "numeric",
        month: "short",
    });
}
