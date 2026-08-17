// src/features/booking/BookingsCharts.tsx
import { useMemo } from "react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import type { Booking, BookingStatus } from "@/api/bookingApi";

const STATUS_COLORS: Record<BookingStatus, string> = {
    CONFIRMED: "#10b981",     // emerald-500
    BOARDED: "#3b82f6",       // blue-500
    AWAITING_TRIP: "#a1a1aa", // zinc-400
    CANCELLED: "#f59e0b",     // amber-500
    NO_SHOW: "#ef4444",       // red-500
};

function dateKey(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10);
}

function shortDateLabel(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}

export function BookingsCharts({ bookings }: { bookings: Booking[] }) {
    const data = useMemo(() => {
        const byDate = new Map<string, Record<BookingStatus, number>>();

        for (const b of bookings) {
            const key = dateKey(b.travelDate);
            if (!byDate.has(key)) {
                byDate.set(key, {
                    CONFIRMED: 0,
                    BOARDED: 0,
                    AWAITING_TRIP: 0,
                    CANCELLED: 0,
                    NO_SHOW: 0,
                });
            }
            byDate.get(key)![b.status] += 1;
        }

        return Array.from(byDate.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, counts]) => ({ date: shortDateLabel(date), ...counts }));
    }, [bookings]);

    if (data.length === 0) return null;

    return (
        <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium mb-3">Bookings by day</h3>
            <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="CONFIRMED" stackId="a" fill={STATUS_COLORS.CONFIRMED} name="Confirmed" />
                    <Bar dataKey="BOARDED" stackId="a" fill={STATUS_COLORS.BOARDED} name="Boarded" />
                    <Bar dataKey="AWAITING_TRIP" stackId="a" fill={STATUS_COLORS.AWAITING_TRIP} name="Awaiting trip" />
                    <Bar dataKey="CANCELLED" stackId="a" fill={STATUS_COLORS.CANCELLED} name="Cancelled" />
                    <Bar dataKey="NO_SHOW" stackId="a" fill={STATUS_COLORS.NO_SHOW} name="No-show" radius={[4, 4, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}