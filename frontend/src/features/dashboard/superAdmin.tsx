// SuperAdminDashboard.tsx
//
// Pilot-stage platform view. Deliberately NOT a revenue dashboard: no
// commission is charged yet, so every shilling shown here was collected by a
// sacco, not earned by the platform. What actually matters at this stage is
// whether saccos are using the system and whether the M-Pesa integration is
// taking money cleanly — so those get the space that revenue would normally
// occupy.
import { useEffect, useMemo, useState } from "react";
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
    Smartphone,
    Wallet,
    Banknote,
    FileText,
    Minus,
    Link2Off,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { getSaccoCountStatsRequest, getSaccoPerformanceStatsRequest } from "@/api/saccoApi";
import { getTripCountSummary, getTripTrendRequest } from "@/api/tripApi";
import {
    getRevenueTrendRequest,
    getTodayBookingSummaryRequest,
    getUniquePassengerStatsRequest,
} from "@/api/bookingApi";
import { getUnmatchedMpesaSummaryRequest } from "@/api/paymentApi";
import { getFastestRoutesTodayRequest } from "@/api/routeApi";
import { getSystemHealthRequest } from "@/api/healthApi";

// ── Utility ──────────────────────────────────────────────────────────────

function formatCurrency(amount: number) {
    return `KSh ${Math.round(amount).toLocaleString()}`;
}

function formatMinutes(mins: number) {
    if (!mins || mins <= 0) return "—";
    if (mins < 60) return `${Math.round(mins)}m`;
    const h = Math.floor(mins / 60);
    return `${h}h ${Math.round(mins % 60)}m`;
}

/** How long that money has been sitting unclaimed, in words a human reads. */
function formatAge(iso: string | null): string | null {
    if (!iso) return null;
    const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (hours < 1) return "under an hour";
    if (hours < 24) return `${Math.floor(hours)}h`;
    return `${Math.floor(hours / 24)}d`;
}

function getStatusBadge(status: string) {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
        Healthy: { label: "Healthy", variant: "secondary" },
        "Low Activity": { label: "Low Activity", variant: "outline" },
        Inactive: { label: "Inactive", variant: "destructive" },
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

function CardHeader({ title, icon, hint }: { title: string; icon?: React.ReactNode; hint?: string }) {
    return (
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {hint && <span className="text-[10px] text-muted-foreground ml-auto">{hint}</span>}
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

function StatCard({
    icon,
    iconClass,
    label,
    value,
    sub,
    loading,
    onClick,
    children,
}: {
    icon: React.ReactNode;
    iconClass?: string;
    label: string;
    value: React.ReactNode;
    sub?: string;
    loading?: boolean;
    onClick?: () => void;
    children?: React.ReactNode;
}) {
    const Wrapper = onClick ? "button" : "div";
    return (
        <Wrapper
            onClick={onClick}
            className={cn(
                "bg-card border border-border rounded-lg p-3 text-left",
                onClick && "hover:border-foreground/20 hover:bg-muted/50 transition-colors cursor-pointer",
            )}
        >
            <div className={cn("flex items-center gap-2 mb-1", iconClass ?? "text-muted-foreground")}>
                {icon}
                <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
            {loading ? (
                <div className="h-7 w-12 bg-muted rounded animate-pulse" />
            ) : (
                <p className="font-mono text-xl font-bold">{value}</p>
            )}
            {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
            {children}
        </Wrapper>
    );
}

/** One number in the payment-health strip. */
function PaymentStat({
    label,
    value,
    tone = "neutral",
    sub,
}: {
    label: string;
    value: React.ReactNode;
    tone?: "neutral" | "good" | "warn" | "bad";
    sub?: string;
}) {
    const toneClass = {
        neutral: "text-foreground",
        good: "text-emerald-500",
        warn: "text-amber-500",
        bad: "text-red-500",
    }[tone];
    return (
        <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
            <p className={cn("font-mono text-lg font-bold", toneClass)}>{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
    );
}

export default function SuperAdminDashboard({ onRefresh }: SuperAdminDashboardProps) {
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    // The header used to carry a date typed into the source. A dashboard that
    // lies about what day it is undermines every number under it.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(timer);
    }, []);

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

    const { data: todaySummary, isLoading: todaySummaryLoading } = useQuery({
        queryKey: ["todayBookingSummary"],
        queryFn: () => getTodayBookingSummaryRequest(),
        staleTime: 60_000,
    });

    const { data: unmatched, isLoading: unmatchedLoading } = useQuery({
        queryKey: ["unmatchedMpesa"],
        queryFn: () => getUnmatchedMpesaSummaryRequest(),
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

    const { data: systemHealth, isLoading: systemHealthLoading } = useQuery({
        queryKey: ["systemHealth"],
        queryFn: () => getSystemHealthRequest(),
        staleTime: 60_000,
    });

    const { data: saccoPerformance, isLoading: saccoPerformanceLoading } = useQuery({
        queryKey: ["saccoPerformance"],
        queryFn: () => getSaccoPerformanceStatsRequest(false),
        staleTime: 5 * 60_000,
    });

    // Replaces a hardcoded "top routes" list. Fill time is what the analytics
    // service actually measures, so the panel reports vehicles filled and how
    // long each took rather than inventing booking counts.
    const { data: routeActivity, isLoading: routeActivityLoading } = useQuery({
        queryKey: ["fastestRoutesToday"],
        queryFn: () => getFastestRoutesTodayRequest(),
        staleTime: 5 * 60_000,
    });

    const combinedTrend = (revenueTrend ?? []).map((r) => {
        const match = tripTrend?.find((t) => t.date === r.date);
        return { date: r.date, fares: r.revenue, trips: match?.trips ?? 0 };
    });

    const busiestRoutes = useMemo(
        () => [...(routeActivity ?? [])].sort((a, b) => b.vehicles - a.vehicles).slice(0, 6),
        [routeActivity],
    );

    // M-Pesa adoption is the pilot's headline question, so it gets counted
    // once here and read in three places.
    const mpesaReadyCount = (saccoPerformance ?? []).filter((s) => s.mpesaReady).length;
    const saccoTotal = saccoPerformance?.length ?? 0;
    const notReady = (saccoPerformance ?? []).filter((s) => !s.mpesaReady);

    const alerts = useMemo(() => {
        const derived: { type: 'critical' | 'warning' | 'info'; message: string }[] = [];

        // Money received against no seat — the worst state the system can be
        // in, so it sorts above every activity alert.
        if (unmatched && unmatched.count > 0) {
            const age = formatAge(unmatched.oldestTransactionTime);
            derived.push({
                type: unmatched.count > 5 ? 'critical' : 'warning',
                message: `${unmatched.count} unmatched M-Pesa payment${unmatched.count === 1 ? '' : 's'} — ${formatCurrency(unmatched.totalAmount)} received against no booking${age ? `, oldest ${age}` : ''}`,
            });
        }

        if (todaySummary && todaySummary.failed > 0) {
            derived.push({
                type: 'warning',
                message: `${todaySummary.failed} payment${todaySummary.failed === 1 ? '' : 's'} failed today`,
            });
        }

        for (const s of (saccoPerformance ?? []).filter((s) => !s.mpesaReady)) {
            derived.push({
                type: 'info',
                message: `${s.saccoName} can't take M-Pesa — no Daraja credentials configured`,
            });
        }

        for (const s of saccoPerformance ?? []) {
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
    }, [saccoPerformance, todaySummary, unmatched]);

    const trendLoading = revenueTrendLoading || tripTrendLoading;
    const alertsLoading = saccoPerformanceLoading || todaySummaryLoading || unmatchedLoading;

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
                    <div className="flex items-center gap-2">
                        <h1 className="text-sm font-bold">Super Admin</h1>
                        <Badge variant="outline" className="text-[10px] font-medium">Pilot</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-2">
                        <Calendar size={10} />
                        {now.toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            timeZone: "Africa/Nairobi",
                        })}
                        <span className="opacity-30">·</span>
                        <Clock size={10} />
                        {now.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Africa/Nairobi",
                        })} EAT
                    </p>
                </div>
                <div className="flex items-center gap-2">
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

                {/* ── Section 1: Adoption & activity ── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <StatCard
                        icon={<Building2 size={14} />}
                        label="Saccos"
                        value={saccoStats?.currentCount ?? 0}
                        loading={saccoStatsLoading}
                        onClick={() => navigate("/sacco")}
                    >
                        {!saccoStatsLoading && saccoStats && (
                            <TrendBadge percent={saccoStats.percentageChange} direction={saccoStats.changeDirection} />
                        )}
                    </StatCard>

                    {/* The pilot's integration-adoption number, not buried in settings. */}
                    <StatCard
                        icon={<Smartphone size={14} />}
                        iconClass={
                            saccoTotal > 0 && mpesaReadyCount === saccoTotal
                                ? "text-emerald-500"
                                : "text-amber-500"
                        }
                        label="M-Pesa Ready"
                        value={`${mpesaReadyCount}/${saccoTotal}`}
                        sub={notReady.length > 0 ? `${notReady.length} cash-only` : "all saccos live"}
                        loading={saccoPerformanceLoading}
                        onClick={() => navigate("/sacco")}
                    />

                    <StatCard
                        icon={<Bus size={14} />}
                        iconClass="text-emerald-500"
                        label="Trips"
                        value={tripStats?.today ?? 0}
                        sub="today"
                        loading={tripStatsLoading}
                        onClick={() => navigate("/trips")}
                    >
                        {!tripStatsLoading && tripStats && (
                            <TrendBadge
                                percent={tripStats.changePercent}
                                direction={
                                    tripStats.changeCount > 0 ? 'up' : tripStats.changeCount < 0 ? 'down' : 'no-change'
                                }
                            />
                        )}
                    </StatCard>

                    <StatCard
                        icon={<Ticket size={14} />}
                        iconClass="text-blue-500"
                        label="Bookings"
                        value={todaySummary?.total ?? 0}
                        sub={
                            todaySummary
                                ? `today · ${todaySummary.paid} paid, ${todaySummary.pending} pending`
                                : "today"
                        }
                        loading={todaySummaryLoading}
                        onClick={() => navigate("/bookings-report")}
                    />

                    {/* Fares, framed honestly: this is the saccos' money. No
                        commission is charged during the pilot, so it is not
                        platform revenue and must not be dressed up as such. */}
                    <StatCard
                        icon={<Banknote size={14} />}
                        iconClass="text-cyan-500"
                        label="Fares Collected"
                        value={formatCurrency(todaySummary?.grossFares ?? 0)}
                        sub="today · by saccos, not platform income"
                        loading={todaySummaryLoading}
                    />
                </div>

                {/* ── Section 2: Payments & M-Pesa health ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader
                        title="Payments & M-Pesa Health"
                        icon={<Smartphone size={14} />}
                        hint="today"
                    />
                    <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        {todaySummaryLoading ? (
                            <div className="col-span-full h-10 bg-muted rounded animate-pulse" />
                        ) : (
                            <>
                                <PaymentStat
                                    label="Paid"
                                    value={todaySummary?.paid ?? 0}
                                    tone="good"
                                />
                                <PaymentStat
                                    label="In flight"
                                    value={todaySummary?.pending ?? 0}
                                    tone={(todaySummary?.pending ?? 0) > 0 ? "warn" : "neutral"}
                                    sub="seats held"
                                />
                                <PaymentStat
                                    label="Failed"
                                    value={todaySummary?.failed ?? 0}
                                    tone={(todaySummary?.failed ?? 0) > 0 ? "bad" : "good"}
                                />
                                <PaymentStat
                                    label="Cancelled"
                                    value={todaySummary?.cancelled ?? 0}
                                    tone="neutral"
                                />
                                <div>
                                    <p className="text-[10px] text-muted-foreground mb-0.5">Cash vs M-Pesa</p>
                                    <p className="font-mono text-lg font-bold flex items-center gap-1.5">
                                        <Wallet size={13} className="text-emerald-600" />
                                        {todaySummary?.cash ?? 0}
                                        <span className="text-muted-foreground/40">/</span>
                                        <Smartphone size={13} className="text-emerald-600" />
                                        {todaySummary?.mpesa ?? 0}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">integration uptake</p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
                                        <Link2Off size={10} /> Unmatched C2B
                                    </p>
                                    {unmatchedLoading ? (
                                        <div className="h-6 w-12 bg-muted rounded animate-pulse" />
                                    ) : (
                                        <>
                                            <p className={cn(
                                                "font-mono text-lg font-bold",
                                                (unmatched?.count ?? 0) > 0 ? "text-red-500" : "text-emerald-500",
                                            )}>
                                                {unmatched?.count ?? 0}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">
                                                {(unmatched?.count ?? 0) > 0
                                                    ? `${formatCurrency(unmatched?.totalAmount ?? 0)} unclaimed`
                                                    : "all payments matched"}
                                            </p>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Section 3: System Health ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="System Health" icon={<Activity size={14} />} />
                    <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
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
                                    <span className="text-xs text-muted-foreground">Failed requests</span>
                                    <span className={cn(
                                        "text-xs font-mono",
                                        (systemHealth?.failedRequests ?? 0) > 0 ? "text-amber-500" : "text-emerald-500"
                                    )}>
                                        {systemHealth?.failedRequests ?? 0}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Section 4: Fares & Trips Trend (7 days) ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader
                        title="Fares & Trips (Last 7 Days)"
                        icon={<TrendingUp size={14} />}
                        hint="fares collected by saccos"
                    />
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
                                            return name === "fares" ? [formatCurrency(numValue), "Fares"] : [numValue, "Trips"];
                                        }}
                                    />
                                    <Line yAxisId="left" type="monotone" dataKey="fares" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                                    <Line yAxisId="right" type="monotone" dataKey="trips" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                        <div className="flex justify-center gap-6 text-[10px] text-muted-foreground mt-2">
                            <span><span className="inline-block w-2 h-2 rounded-full bg-primary mr-1"></span> Fares collected</span>
                            <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1"></span> Trips</span>
                        </div>
                    </div>
                </div>

                {/* ── Section 5: Alerts ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader
                        title="Needs Attention"
                        icon={<AlertCircle size={14} />}
                        hint={alerts.length > 0 ? `${alerts.length} open` : undefined}
                    />
                    <div className="divide-y divide-border max-h-72 overflow-y-auto">
                        {alertsLoading ? (
                            <div className="px-4 py-2.5">
                                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                            </div>
                        ) : alerts.length === 0 ? (
                            <div className="px-4 py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                                <CheckCircle size={14} className="text-emerald-500" />
                                Nothing needs attention — saccos active, payments matched
                            </div>
                        ) : (
                            alerts.map((alert, idx) => {
                                const Icon = alert.type === 'critical' ? AlertCircle : alert.type === 'warning' ? AlertTriangle : AlertCircle;
                                const color = alert.type === 'critical' ? 'text-red-500' : alert.type === 'warning' ? 'text-amber-500' : 'text-blue-500';
                                return (
                                    <div key={idx} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                                        <Icon size={14} className={cn(color, "shrink-0")} />
                                        <span className="text-foreground">{alert.message}</span>
                                        <span className="ml-auto shrink-0">{getStatusBadge(alert.type)}</span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ── Section 6: Sacco Performance Table ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Sacco Performance" icon={<Building2 size={14} />} hint="this week" />
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Sacco</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Trips</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Bookings</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Fares Collected</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">M-Pesa</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Last Active</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {saccoPerformanceLoading ? (
                                    Array.from({ length: 4 }).map((_, i) => (
                                        <tr key={i} className="border-b border-border">
                                            <td colSpan={7} className="px-4 py-2.5">
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
                                            <td className="px-4 py-2.5 text-xs font-mono">
                                                {formatCurrency(s.grossFaresThisWeek)}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                {s.mpesaReady ? (
                                                    <span className="text-[10px] text-emerald-600 flex items-center gap-1">
                                                        <CheckCircle size={11} /> Live
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-amber-600 flex items-center gap-1">
                                                        <Wallet size={11} /> Cash only
                                                    </span>
                                                )}
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
                                        <td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">
                                            No saccos found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── Section 7: Route activity today ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Route Activity Today" icon={<Bus size={14} />} hint="vehicles filled · avg fill time" />
                    <div className="divide-y divide-border">
                        {routeActivityLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="px-4 py-2.5">
                                    <div className="h-4 w-full bg-muted rounded animate-pulse" />
                                </div>
                            ))
                        ) : busiestRoutes.length === 0 ? (
                            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                                No vehicles have completed a fill cycle today yet
                            </div>
                        ) : (
                            busiestRoutes.map((route) => (
                                <div key={route.routeId} className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-muted/50 transition-colors">
                                    <span className="text-foreground">{route.route}</span>
                                    <span className="text-muted-foreground font-mono">
                                        {route.vehicles} vehicle{route.vehicles === 1 ? "" : "s"}
                                        <span className="opacity-30 mx-1.5">·</span>
                                        {formatMinutes(route.today)}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* ── Section 8: Riders (pilot reach) ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Riders" icon={<Users size={14} />} hint="this week" />
                    <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                        {passengerStatsLoading ? (
                            <div className="col-span-full h-10 bg-muted rounded animate-pulse" />
                        ) : (
                            <>
                                <PaymentStat label="Unique riders" value={passengerStats?.thisWeekUnique ?? 0} />
                                <PaymentStat label="New" value={passengerStats?.newThisWeek ?? 0} tone="good" />
                                <PaymentStat
                                    label="Returning"
                                    value={passengerStats?.returningThisWeek ?? 0}
                                    sub="the number that says it's working"
                                />
                                <div>
                                    <p className="text-[10px] text-muted-foreground mb-0.5">vs last week</p>
                                    <TrendBadge
                                        percent={passengerStats?.changePercent ?? null}
                                        direction={
                                            !passengerStats?.changePercent
                                                ? 'no-change'
                                                : passengerStats.changePercent > 0
                                                    ? 'up'
                                                    : 'down'
                                        }
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Section 9: Quick Actions ── */}
                <div className="bg-card border border-border rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-foreground mb-3">Quick Actions</h3>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate("/sacco")}>
                            <Building2 size={14} /> Saccos
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate("/routes")}>
                            <Bus size={14} /> Routes
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate("/users-saccos")}>
                            <Users size={14} /> Users
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate("/payments")}>
                            <Smartphone size={14} /> Payments
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate("/bookings-report")}>
                            <FileText size={14} /> Bookings
                        </Button>
                    </div>
                </div>

            </main>
        </div>
    );
}
