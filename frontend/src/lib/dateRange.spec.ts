import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    daysAgoString,
    formatDateTime,
    formatDay,
    formatTime,
    RANGE_PRESETS,
    toLocalDateString,
    todayString,
} from "./dateRange";

describe("dateRange", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("formats a local date as YYYY-MM-DD with zero padding", () => {
        expect(toLocalDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
        expect(toLocalDateString(new Date(2026, 11, 25))).toBe("2026-12-25");
    });

    it("uses the local calendar day, not the UTC one", () => {
        // 00:30 local. In any zone east of UTC toISOString() would still
        // read as the previous day; the helper must not.
        const localMidnightish = new Date(2026, 8, 8, 0, 30);
        vi.setSystemTime(localMidnightish);

        expect(todayString()).toBe("2026-09-08");
    });

    it("counts days back from today across a month boundary", () => {
        vi.setSystemTime(new Date(2026, 8, 3, 12)); // 3 Sep

        expect(daysAgoString(0)).toBe("2026-09-03");
        expect(daysAgoString(6)).toBe("2026-08-28");
        expect(daysAgoString(29)).toBe("2026-08-05");
    });

    it("has presets whose day offsets match their labels", () => {
        const byLabel = Object.fromEntries(RANGE_PRESETS.map((p) => [p.label, p.days]));

        expect(byLabel).toEqual({ Today: 0, "7 days": 6, "30 days": 29 });
    });

    it("renders a dash for missing timestamps", () => {
        expect(formatTime(null)).toBe("—");
        expect(formatDateTime(null)).toBe("—");
    });

    it("includes seconds only when asked", () => {
        const iso = new Date(2026, 8, 8, 14, 5, 9).toISOString();

        expect(formatDateTime(iso)).not.toMatch(/:09/);
        expect(formatDateTime(iso, { seconds: true })).toMatch(/:09/);
    });

    it("keeps the weekday of a bare date in local time", () => {
        // 2026-09-08 is a Tuesday.
        expect(formatDay("2026-09-08")).toMatch(/^Tue/);
    });
});
