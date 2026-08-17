// src/features/payments/PaymentsCharts.tsx
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
    Cell,
} from "recharts";
import type { Payment } from "@/api/paymentApi";

const STATUS_COLORS: Record<string, string> = {
    SUCCESS: "#10b981", // emerald-500
    FAILED: "#ef4444",  // red-500
    PROCESSING: "#3b82f6", // blue-500
    PENDING: "#a1a1aa", // zinc-400
    EXPIRED: "#f59e0b", // amber-500
};

function dateKey(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10);
}

function shortDateLabel(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}

// ─── Daily success/failure breakdown ────────────────────────────────────
function DailyStatusChart({ payments }: { payments: Payment[] }) {
    const data = useMemo(() => {
        const byDate = new Map<string, Record<string, number>>();

        for (const p of payments) {
            const key = dateKey(p.createdAt);
            if (!byDate.has(key)) {
                byDate.set(key, { SUCCESS: 0, FAILED: 0, PROCESSING: 0, PENDING: 0, EXPIRED: 0 });
            }
            byDate.get(key)![p.status] += 1;
        }

        return Array.from(byDate.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, counts]) => ({
                date: shortDateLabel(date),
                ...counts,
            }));
    }, [payments]);

    if (data.length === 0) return null;

    return (
        <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium mb-3">Payments by day</h3>
            <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        axisLine={{ stroke: "hsl(var(--border))" }}
                        tickLine={false}
                    />
                    <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                    />
                    <Tooltip
                        contentStyle={{
                            fontSize: 12,
                            borderRadius: 8,
                            border: "1px solid hsl(var(--border))",
                        }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="SUCCESS" stackId="a" fill={STATUS_COLORS.SUCCESS} name="Success" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="FAILED" stackId="a" fill={STATUS_COLORS.FAILED} name="Failed" />
                    <Bar dataKey="PROCESSING" stackId="a" fill={STATUS_COLORS.PROCESSING} name="Processing" />
                    <Bar dataKey="PENDING" stackId="a" fill={STATUS_COLORS.PENDING} name="Pending" />
                    <Bar dataKey="EXPIRED" stackId="a" fill={STATUS_COLORS.EXPIRED} name="Expired" radius={[4, 4, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─── Failure reason breakdown ────────────────────────────────────────────
function FailureReasonChart({ payments }: { payments: Payment[] }) {
    const data = useMemo(() => {
        const counts = new Map<string, number>();

        for (const p of payments) {
            if (p.status !== "FAILED") continue;
            const reason = p.resultDesc ?? p.initiationErrorMessage ?? "Unknown reason";
            counts.set(reason, (counts.get(reason) ?? 0) + 1);
        }

        return Array.from(counts.entries())
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8); // cap so the chart doesn't grow unbounded
    }, [payments]);

    if (data.length === 0) {
        return (
            <div className="rounded-lg border border-border p-4 flex items-center justify-center h-[220px]">
                <p className="text-sm text-muted-foreground">No failures in this range 🎉</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium mb-3">Failure reasons</h3>
            <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                        type="category"
                        dataKey="reason"
                        width={140}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value: string) => (value.length > 22 ? value.slice(0, 22) + "…" : value)}
                    />
                    <Tooltip
                        contentStyle={{
                            fontSize: 12,
                            borderRadius: 8,
                            border: "1px solid hsl(var(--border))",
                        }}
                    />
                    <Bar dataKey="count" fill={STATUS_COLORS.FAILED} radius={[0, 4, 4, 0]}>
                        {data.map((_, i) => (
                            <Cell key={i} fillOpacity={1 - i * 0.08} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─── Combined export ──────────────────────────────────────────────────────
export function PaymentsCharts({ payments }: { payments: Payment[] }) {
    if (payments.length === 0) return null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DailyStatusChart payments={payments} />
            <FailureReasonChart payments={payments} />
        </div>
    );
}