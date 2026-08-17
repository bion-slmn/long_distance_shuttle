// SuperAdminDashboard.tsx
import { useMemo, useState } from "react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import {
    Building2,
    Bus,
    Ticket,
    DollarSign,
    Users,
    Activity,
    CheckCircle,
    AlertCircle,
    AlertTriangle,
    Clock,
    Calendar,
    RefreshCw,
    TrendingUp,
    TrendingDown,
    Zap,
    Bell,
    FileText,
    Minus,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { getSaccoCountStatsRequest, getSaccoPerformanceStatsRequest } from "@/api/saccoApi";
import { getTodayPassengerStatsRequest, getTripCountSummary, getTripTrendRequest } from "@/api/tripApi";
import { getRevenueTrendRequest, getTodayEarningsRequest, getUniquePassengerStatsRequest } from "@/api/bookingApi";
import { getSystemHealthRequest } from "@/api/healthApi";

// ── Dummy Data (unchanged) ─────────────────────────────────────────────────

const recentActivity = [
    { time: "09:15", action: "New Sacco registered" },
    { time: "09:21", action: "Vehicle KDL 245A dispatched" },
    { time: "09:40", action: "Clerk John created Route Nairobi–Kisumu" },
    { time: "10:02", action: "Admin suspended user" },
    { time: "10:15", action: "Payment of KSh 12,000 processed" },
];

const topRoutes = [
    { route: "Nairobi → Kisumu", bookings: 1250 },
    { route: "Nairobi → Eldoret", bookings: 980 },
    { route: "Nairobi → Mombasa", bookings: 820 },
    { route: "Nairobi → Nakuru", bookings: 620 },
    { route: "Nairobi → Thika", bookings: 480 },
];

const metrics = {
    bookingsToday: 3421,
};

// ── Utility ──────────────────────────────────────────────────────────────

function formatCurrency(amount: number) {
    return `KSh ${amount.toLocaleString()}`;
}

function getStatusBadge(status: string) {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
        Healthy: { label: "Healthy", variant: "secondary" },
        "Low Activity": { label: "Low Activity", variant: "outline" },
        critical: { label: "Critical", variant: "destructive" },
        warning: { label: "Warning", variant: "outline" },
        info: { label: "Info", variant: "secondary" },
    };
    const s = map[status] || { label: status, variant: "outline" as const };
    return (
        <Badge variant={s.variant} className="text-[10px] font-medium">
            {s.label}
        </Badge>
    );
}

// ── Components ──────────────────────────────────────────────────────────────

function CardHeader({ title, icon }: { title: string; icon?: React.ReactNode }) {
    return (
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
    );
}

interface SuperAdminDashboardProps {
    onRefresh?: () => void;
}

function TrendBadge({ percent, direction }: { percent: number | null; direction: 'up' | 'down' | 'no-change' }) {
    if (percent === null) {
        return <p className="text-[10px] text-muted-foreground mt-0.5">vs yesterday: n/a</p>;
    }
    const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
    const color = direction === 'up' ? 'text-emerald-500' : direction === 'down' ? 'text-red-500' : 'text-muted-foreground';
    return (
        <div className="flex items-center gap-1 mt-0.5">
            <Icon size={10} className={color} />
            <p className={cn("text-[10px]", color)}>
                {percent > 0 ? "+" : ""}{percent.toFixed(1)}%
            </p>
        </div>
    );
}

export default function SuperAdminDashboard({ onRefresh }: SuperAdminDashboardProps) {
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const { data: saccoStats, isLoading: saccoStatsLoading } = useQuery({
        queryKey: ["saccoCountStats"],
        queryFn: () => getSaccoCountStatsRequest(false),
        staleTime: 60_000,
    });

    const { data: tripStats, isLoading: tripStatsLoading } = useQuery({
        queryKey: ["tripCountSummary"],
        queryFn: () => getTripCountSummary(),
        staleTime: 60_000,
    });

    const { data: todayEarnings, isLoading: earningsLoading } = useQuery({
        queryKey: ["todayEarnings"],
        queryFn: () => getTodayEarningsRequest(),
        staleTime: 60_000,
    });

    const { data: revenueTrend, isLoading: revenueTrendLoading } = useQuery({
        queryKey: ["revenueTrend", 7],
        queryFn: () => getRevenueTrendRequest(7),
        staleTime: 5 * 60_000,
    });

    const { data: tripTrend, isLoading: tripTrendLoading } = useQuery({
        queryKey: ["tripTrend", 7],
        queryFn: () => getTripTrendRequest(7),
        staleTime: 5 * 60_000,
    });

    const { data: passengerStats, isLoading: passengerStatsLoading } = useQuery({
        queryKey: ["uniquePassengerStats"],
        queryFn: () => getUniquePassengerStatsRequest(),
        staleTime: 5 * 60_000,
    });

    const { data: passengerCountStats, isLoading: passengerCountLoading } = useQuery({
        queryKey: ["todayPassengerStats"],
        queryFn: () => getTodayPassengerStatsRequest(),
        staleTime: 60_000,
    });

    const { data: systemHealth, isLoading: systemHealthLoading } = useQuery({
        queryKey: ["systemHealth"],
        queryFn: () => getSystemHealthRequest(),
        staleTime: 60_000,
    });

    const combinedTrend = (revenueTrend ?? []).map((r) => {
        const match = tripTrend?.find((t) => t.date === r.date);
        return { date: r.date, revenue: r.revenue, trips: match?.trips ?? 0 };
    });

    const { data: saccoPerformance, isLoading: saccoPerformanceLoading } = useQuery({
        queryKey: ["saccoPerformance"],
        queryFn: () => getSaccoPerformanceStatsRequest(false),
        staleTime: 5 * 60_000,
    });

    const alerts = useMemo(() => {
        if (!saccoPerformance) return [];

        const derived: { type: 'critical' | 'warning' | 'info'; message: string }[] = [];

        for (const s of saccoPerformance) {
            if (s.status === 'Inactive') {
                derived.push({
                    type: 'critical',
                    message: `${s.saccoName} has no trips logged — inactive`,
                });
            } else if (s.status === 'Low Activity') {
                derived.push({
                    type: 'warning',
                    message: `${s.saccoName} only ran ${s.tripsThisWeek} trip${s.tripsThisWeek === 1 ? '' : 's'} this week`,
                });
            }

            if (s.tripsChangePercent !== null && s.tripsChangePercent <= -30) {
                derived.push({
                    type: 'warning',
                    message: `${s.saccoName} trips down ${Math.abs(s.tripsChangePercent)}% vs last week`,
                });
            }
        }

        const order = { critical: 0, warning: 1, info: 2 };
        return derived.sort((a, b) => order[a.type] - order[b.type]);
    }, [saccoPerformance]);

    const trendLoading = revenueTrendLoading || tripTrendLoading;

    const handleRefresh = () => {
        if (onRefresh) {
            setLoading(true);
            onRefresh();
            setTimeout(() => setLoading(false), 1000);
        }
    };

    return (
        <div className="flex-1 flex flex-col min-w-0 bg-background text-foreground">

            {/* Top Bar */}
            <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
                <div>
                    <h1 className="text-sm font-bold">Super Admin</h1>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-2">
                        <Calendar size={10} />
                        Wed, 23 Jul 2025
                        <span className="opacity-30">·</span>
                        <Clock size={10} />
                        09:24 EAT
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="relative size-8">
                        <Bell size={14} />
                        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className={cn("size-8", loading && "animate-spin")}
                        onClick={handleRefresh}
                    >
                        <RefreshCw size={14} />
                    </Button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* ── Section 1: Top Cards ── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                    <button
                        onClick={() => navigate("/sacco")}
                        className="bg-card border border-border rounded-lg p-3 text-left hover:border-foreground/20 hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <Building2 size={14} />
                            <span className="text-[10px]">Saccos</span>
                        </div>

                        {saccoStatsLoading ? (
                            <div className="h-7 w-10 bg-muted rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold">{saccoStats?.currentCount ?? 0}</p>
                        )}

                        {!saccoStatsLoading && saccoStats && (
                            <TrendBadge percent={saccoStats.percentageChange} direction={saccoStats.changeDirection} />
                        )}
                    </button>

                    <div
                        className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => navigate("/trips")}
                    >
                        <div className="flex items-center gap-2 text-emerald-500 mb-1">
                            <Bus size={14} />
                            <span className="text-[10px] text-muted-foreground">Trips</span>
                        </div>

                        {tripStatsLoading ? (
                            <div className="h-7 w-10 bg-muted rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold">{tripStats?.today ?? 0}</p>
                        )}

                        {!tripStatsLoading && tripStats && (
                            <TrendBadge
                                percent={tripStats.changePercent}
                                direction={
                                    tripStats.changeCount > 0 ? 'up' : tripStats.changeCount < 0 ? 'down' : 'no-change'
                                }
                            />
                        )}
                    </div>

                    <div className="bg-card border border-border rounded-lg p-3">
                        <div className="flex items-center gap-2 text-blue-500 mb-1">
                            <Ticket size={14} />
                            <span className="text-[10px] text-muted-foreground">Bookings</span>
                        </div>
                        <p className="font-mono text-xl font-bold">{metrics.bookingsToday.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground">today</p>
                    </div>

                    {/* Revenue card — kept as a brand accent, not part of the dark palette */}
                    <div className="bg-primary rounded-lg p-3 col-span-1">
                        <div className="flex items-center gap-2 text-primary-foreground/80 mb-1">
                            <DollarSign size={14} />
                            <span className="text-[10px] text-primary-foreground/70">Revenue</span>
                        </div>

                        {earningsLoading ? (
                            <div className="h-7 w-20 bg-primary-foreground/20 rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold text-primary-foreground">
                                {formatCurrency(todayEarnings?.grossRevenue ?? 0)}
                            </p>
                        )}
                        <p className="text-[10px] text-primary-foreground/70">today, all saccos</p>
                    </div>

                    <div className="bg-card border border-border rounded-lg p-3">
                        <div className="flex items-center gap-2 text-cyan-500 mb-1">
                            <Users size={14} />
                            <span className="text-[10px] text-muted-foreground">Total Passengers</span>
                        </div>

                        {passengerCountLoading ? (
                            <div className="h-7 w-10 bg-muted rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold">{passengerCountStats?.today ?? 0}</p>
                        )}

                        <p className="text-[10px] text-muted-foreground">today</p>

                        {!passengerCountLoading && passengerCountStats && (
                            <TrendBadge
                                percent={passengerCountStats.changePercent}
                                direction={
                                    passengerCountStats.changeCount > 0 ? 'up' : passengerCountStats.changeCount < 0 ? 'down' : 'no-change'
                                }
                            />
                        )}
                    </div>

                    <div className="bg-card border border-border rounded-lg p-3">
                        <div className="flex items-center gap-2 text-amber-500 mb-1">
                            <Users size={14} />
                            <span className="text-[10px] text-muted-foreground">Unique Riders</span>
                        </div>

                        {passengerStatsLoading ? (
                            <div className="h-7 w-10 bg-muted rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold">{passengerStats?.thisWeekUnique ?? 0}</p>
                        )}

                        <p className="text-[10px] text-muted-foreground">this week</p>

                        {!passengerStatsLoading && passengerStats && (
                            <>
                                <p className="text-[10px] text-muted-foreground">
                                    {passengerStats.newThisWeek} new · {passengerStats.returningThisWeek} returning
                                </p>
                                <TrendBadge
                                    percent={passengerStats.changePercent}
                                    direction={
                                        passengerStats.changePercent === null
                                            ? 'no-change'
                                            : passengerStats.changePercent > 0
                                                ? 'up'
                                                : passengerStats.changePercent < 0
                                                    ? 'down'
                                                    : 'no-change'
                                    }
                                />
                            </>
                        )}
                    </div>
                </div>

                {/* ── Section 2: System Health ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="System Health" icon={<Activity size={14} />} />
                    <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        {systemHealthLoading ? (
                            <div className="col-span-full h-6 bg-muted rounded animate-pulse" />
                        ) : (
                            <>
                                <div className="flex items-center gap-2">
                                    {systemHealth?.api.status === 'up' ? (
                                        <CheckCircle size={14} className="text-emerald-500" />
                                    ) : (
                                        <AlertCircle size={14} className="text-red-500" />
                                    )}
                                    <span className="text-xs">API</span>
                                    <span className="text-xs text-muted-foreground">
                                        {systemHealth?.api.status ?? "unknown"}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    {systemHealth?.database.status === 'up' ? (
                                        <CheckCircle size={14} className="text-emerald-500" />
                                    ) : (
                                        <AlertCircle size={14} className="text-red-500" />
                                    )}
                                    <span className="text-xs">Database</span>
                                    <span className="text-xs text-muted-foreground">
                                        {systemHealth?.database.responseTime ?? 0}ms
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Errors</span>
                                    <span className={cn(
                                        "text-xs font-mono",
                                        (systemHealth?.failedRequests ?? 0) > 0 ? "text-amber-500" : "text-emerald-500"
                                    )}>
                                        {systemHealth?.failedRequests ?? 0}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Zap size={14} className="text-blue-500" />
                                    <span className="text-xs">Jobs</span>
                                    <span className="text-xs text-muted-foreground">
                                        {systemHealth?.queueJobs ?? "Not tracked"}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Clock size={14} className="text-muted-foreground" />
                                    <span className="text-xs">Backup</span>
                                    <span className="text-xs text-muted-foreground">
                                        {systemHealth?.lastBackup ?? "Not tracked"}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Section 3: Revenue & Trips Trend (7 days) ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Revenue & Trips (Last 7 Days)" icon={<TrendingUp size={14} />} />
                    <div className="p-4">
                        {trendLoading ? (
                            <div className="h-[180px] bg-muted rounded animate-pulse" />
                        ) : (
                            <ResponsiveContainer width="100%" height={180}>
                                <LineChart data={combinedTrend}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                                    />
                                    <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: "hsl(var(--popover))",
                                            border: "1px solid hsl(var(--border))",
                                            borderRadius: "8px",
                                        }}
                                        labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: "10px" }}
                                        labelFormatter={(label) => {
                                            const d = new Date(label as string);
                                            return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                                        }}
                                        formatter={(value, name) => {
                                            const numValue = Array.isArray(value) ? Number(value[0] ?? 0) : Number(value ?? 0);
                                            return name === "revenue" ? [formatCurrency(numValue), "Revenue"] : [numValue, "Trips"];
                                        }}
                                    />
                                    <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                                    <Line yAxisId="right" type="monotone" dataKey="trips" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                        <div className="flex justify-center gap-6 text-[10px] text-muted-foreground mt-2">
                            <span><span className="inline-block w-2 h-2 rounded-full bg-primary mr-1"></span> Revenue (fares)</span>
                            <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1"></span> Trips</span>
                        </div>
                    </div>
                </div>

                {/* ── Section 4: Sacco Performance Table ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Sacco Performance" icon={<Building2 size={14} />} />
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Sacco</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Trips</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Bookings</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Fares Collected</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Last Active</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {saccoPerformanceLoading ? (
                                    Array.from({ length: 4 }).map((_, i) => (
                                        <tr key={i} className="border-b border-border">
                                            <td colSpan={6} className="px-4 py-2.5">
                                                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                                            </td>
                                        </tr>
                                    ))
                                ) : saccoPerformance && saccoPerformance.length > 0 ? (
                                    saccoPerformance.map((s) => (
                                        <tr key={s.saccoId} className="border-b border-border hover:bg-muted/50 transition-colors">
                                            <td className="px-4 py-2.5 text-xs font-medium">{s.saccoName}</td>
                                            <td className="px-4 py-2.5 text-xs">
                                                {s.tripsThisWeek}
                                                {s.tripsChangePercent !== null && (
                                                    <span className={s.tripsChangePercent >= 0 ? "text-emerald-500 ml-1" : "text-red-500 ml-1"}>
                                                        ({s.tripsChangePercent > 0 ? "+" : ""}{s.tripsChangePercent}%)
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2.5 text-xs">{s.bookingsThisWeek}</td>
                                            <td className="px-4 py-2.5 text-xs font-mono text-primary">
                                                {formatCurrency(s.grossFaresThisWeek)}
                                            </td>
                                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                                {s.lastActiveDate
                                                    ? new Date(s.lastActiveDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                                                    : "Never"}
                                            </td>
                                            <td className="px-4 py-2.5">{getStatusBadge(s.status)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                                            No saccos found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── Section 5: Alerts ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Alerts" icon={<AlertCircle size={14} />} />
                    <div className="divide-y divide-border">
                        {saccoPerformanceLoading ? (
                            <div className="px-4 py-2.5">
                                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                            </div>
                        ) : alerts.length === 0 ? (
                            <div className="px-4 py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                                <CheckCircle size={14} className="text-emerald-500" />
                                All saccos healthy — no alerts
                            </div>
                        ) : (
                            alerts.map((alert, idx) => {
                                const Icon = alert.type === 'critical' ? AlertCircle : alert.type === 'warning' ? AlertTriangle : AlertCircle;
                                const color = alert.type === 'critical' ? 'text-red-500' : alert.type === 'warning' ? 'text-amber-500' : 'text-blue-500';
                                return (
                                    <div key={idx} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                                        <Icon size={14} className={color} />
                                        <span className="text-foreground">{alert.message}</span>
                                        {getStatusBadge(alert.type)}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ── Section 6: Recent Activity ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Recent Activity" icon={<Zap size={14} />} />
                    <div className="divide-y divide-border max-h-40 overflow-y-auto">
                        {recentActivity.map((item, idx) => (
                            <div key={idx} className="px-4 py-2 flex items-center gap-3 text-xs hover:bg-muted/50 transition-colors">
                                <span className="text-muted-foreground font-mono w-12">{item.time}</span>
                                <span className="text-foreground/80">{item.action}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Section 7: Top Routes ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Top Routes" icon={<Bus size={14} />} />
                    <div className="divide-y divide-border">
                        {topRoutes.map((route, idx) => (
                            <div key={idx} className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-muted/50 transition-colors">
                                <span className="text-foreground">{route.route}</span>
                                <span className="text-muted-foreground font-mono">{route.bookings} bookings</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Section 8: Quick Actions ── */}
                <div className="bg-card border border-border rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-foreground mb-3">Quick Actions</h3>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                            <Building2 size={14} /> Add Sacco
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                            <Bus size={14} /> Add Route
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                            <Users size={14} /> Create Admin
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                            <FileText size={14} /> View Reports
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                            <Activity size={14} /> System Logs
                        </Button>
                    </div>
                </div>

            </main>
        </div>
    );
}