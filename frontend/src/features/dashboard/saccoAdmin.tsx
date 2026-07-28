// Dashboard.tsx - Pure Dashboard Component (No Sidebar)
import { useState } from "react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts";
import {
    Bell,
    Calendar,
    Clock,
    AlertTriangle,
    Ticket,
    RefreshCw,
    Repeat,
    Clock as ClockIcon,
    Percent,
    Trophy,
    ChevronUp,
    ChevronDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getRevenueTrendRequest, getTodayEarningsRequest } from "@/api/bookingApi";
import { getTripCountSummary, getTrips, type Trip } from "@/api/tripApi";
import { useAuth } from "../auth/AuthContext";
import { getFastestRoutesTodayRequest, getFillTimeComparisonRequest, getRoutePerformanceVsYesterdayRequest } from "@/api/routeApi";
import { useRouteName } from "@/hooks/useRoute";
import { useVehicleNumberPlate } from "@/hooks/useVehicleNumberPlate";

// ── Config ───────────────────────────────────────────────────────────────────

const SACCO_COMMISSION_RATE = 0.02; // SACCO's cut per fare, collected on dispatch

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; cls: string }> = {
        BOARDING: { label: "Boarding", cls: "text-primary bg-primary/10" },
        EN_ROUTE: { label: "En Route", cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
        COMPLETED: { label: "Completed", cls: "text-muted-foreground bg-muted" },
        CANCELLED: { label: "Cancelled", cls: "text-destructive bg-destructive/10" },
    };
    const fallback = { label: status, cls: "text-muted-foreground bg-muted" };
    const s = map[status] ?? fallback;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${s.cls}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {s.label}
        </span>
    );
}

function CardHeader({ title }: { title: string }) {
    return (
        <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
    );
}

function formatCurrency(amount: number) {
    return `KSh ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function commissionOf(amount: number) {
    return amount * SACCO_COMMISSION_RATE;
}

// ── Main Component ──────────────────────────────────────────────────────────

interface DashboardProps {
    onNewBooking?: () => void;
    saccoId?: string; // omitted → super admin, platform-wide
}

// ── Recent Trip Row (own component so useRouteName/useVehicleNumberPlate
// can be called per-row without violating Rules of Hooks) ──────────────
function RecentTripRow({ trip }: { trip: Trip }) {
    const routeName = useRouteName(trip.routeId);
    const { numberPlate } = useVehicleNumberPlate(trip.vehicleId);

    return (
        <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
            <div>
                <p className="text-xs font-medium text-foreground">
                    {routeName ?? "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                    {numberPlate ?? "—"} ·{" "}
                    {new Date(trip.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </p>
            </div>
            <div className="flex items-center gap-3">
                <div className="text-right">
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                        +{formatCurrency(commissionOf(trip.fare))}
                    </p>
                </div>
                <StatusBadge status={trip.status} />
            </div>
        </div>
    );
}

export default function SaccoAdminDashboard({ onNewBooking }: DashboardProps) {
    const [showAllRoutes, setShowAllRoutes] = useState(false);
    const user = useAuth()
    const saccoId = user?.user?.saccoId

    // ── Live data: earnings/trips ──
    const {
        data: earnings,
        isLoading: earningsLoading,
        refetch: refetchEarnings,
    } = useQuery({
        queryKey: ["earnings-today", saccoId],
        queryFn: () => getTodayEarningsRequest(saccoId),
    });

    const {
        data: trend = [],
        isLoading: trendLoading,
        refetch: refetchTrend,
    } = useQuery({
        queryKey: ["earnings-trend", saccoId],
        queryFn: () => getRevenueTrendRequest(7, saccoId),
    });

    const {
        data: recentTripsData,
        isLoading: recentTripsLoading,
        refetch: refetchRecentTrips,
    } = useQuery({
        queryKey: ["recent-trips", saccoId],
        queryFn: () => getTrips({ page: 1, limit: 5 }),
    });

    const recentTrips = recentTripsData?.data ?? [];

    const {
        data: tripSummary,
        isLoading: tripsLoading,
        refetch: refetchTrips,
    } = useQuery({
        queryKey: ["trip-count-summary", saccoId],
        queryFn: () => getTripCountSummary(saccoId),
    });

    // ── Live data: route performance ──
    const {
        data: fillTimeComparison,
        isLoading: fillTimeLoading,
        refetch: refetchFillTime,
    } = useQuery({
        queryKey: ["fill-time-comparison", saccoId],
        queryFn: () => getFillTimeComparisonRequest(),
    });

    const {
        data: fastestRoutes = [],
        isLoading: fastestRoutesLoading,
        refetch: refetchFastestRoutes,
    } = useQuery({
        queryKey: ["fastest-routes-today", saccoId],
        queryFn: () => getFastestRoutesTodayRequest(),
    });

    const {
        data: routePerformance = [],
        isLoading: routePerformanceLoading,
        refetch: refetchRoutePerformance,
    } = useQuery({
        queryKey: ["route-performance-vs-yesterday", saccoId],
        queryFn: () => getRoutePerformanceVsYesterdayRequest(),
    });

    const isLoading =
        earningsLoading ||
        trendLoading ||
        tripsLoading ||
        fillTimeLoading ||
        fastestRoutesLoading ||
        routePerformanceLoading ||
        recentTripsLoading;

    const handleRefresh = () => {
        refetchEarnings();
        refetchTrend();
        refetchTrips();
        refetchFillTime();
        refetchFastestRoutes();
        refetchRoutePerformance();
        refetchRecentTrips();
    };

    const allFastestRoutes = fastestRoutes; // already sorted ascending by the backend
    const visibleRoutes = showAllRoutes ? allFastestRoutes : allFastestRoutes.slice(0, 5);

    // ── Revenue (from API) ──
    const totalGrossRevenue = earnings?.grossRevenue ?? 0;
    const totalCommissionEarned = earnings?.commission ?? 0;

    // ── Route Performance (from API) ──
    const avgFillTime = fillTimeComparison?.today ?? 0;
    const avgFillTimeChangeMinutes = fillTimeComparison?.changeMinutes ?? null;

    const sortedByDeviation = [...routePerformance].sort(
        (a, b) => (b.today - b.dayAvg) - (a.today - a.dayAvg)
    );
    // ── Worst Performing Route (replaces mock queueVehicles card) ──
    const worstRoute = sortedByDeviation[0] ?? null;
    const worstRouteDeviation = worstRoute ? worstRoute.today - worstRoute.dayAvg : 0;
    const worstRouteIsBad = worstRoute ? worstRouteDeviation > 0 : false;
    // ── Trips (from API) ──
    const totalTrips = tripSummary?.today ?? 0;
    const tripChangePercent = tripSummary?.changePercent ?? null;

    // ── Render ──
    return (
        <div className="flex-1 flex flex-col min-w-0 bg-background">
            {/* Top Bar */}
            <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
                <div>
                    <h1 className="text-sm font-bold text-foreground">Dashboard</h1>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-2">
                        <Calendar size={10} />
                        Wed, 23 Jul 2025
                        <span className="opacity-30">·</span>
                        <Clock size={10} />
                        09:24 EAT
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {onNewBooking && (
                        <button
                            onClick={onNewBooking}
                            className="hidden sm:flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                        >
                            <Ticket size={13} /> New Booking
                        </button>
                    )}
                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* ── KPIs ── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-primary rounded-xl p-4">
                        <Percent size={16} className="text-primary-foreground/80 mb-2" />
                        <p className="font-mono text-xl font-bold text-primary-foreground">
                            {formatCurrency(totalCommissionEarned)}
                        </p>
                        <p className="text-[10px] text-primary-foreground/70 mt-1">SACCO Earnings Today</p>
                        <p className="text-[10px] text-primary-foreground/50">
                            From {formatCurrency(totalGrossRevenue)} gross fares
                        </p>
                    </div>

                    {/* Trips KPI card */}
                    <div className="bg-card border border-border rounded-xl p-4">
                        <Repeat size={16} className="text-emerald-600 dark:text-emerald-400 mb-2" />
                        <p className="font-mono text-xl font-bold text-foreground">{totalTrips}</p>
                        <p className="text-[10px] text-muted-foreground">
                            Trips Today
                            {tripChangePercent !== null && (
                                <span className={tripChangePercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                                    {" "}· {tripChangePercent >= 0 ? "+" : ""}
                                    {tripChangePercent.toFixed(0)}% vs yesterday
                                </span>
                            )}
                        </p>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-4">
                        <ClockIcon
                            size={16}
                            className={
                                avgFillTime <= 10
                                    ? "text-emerald-600 dark:text-emerald-400 mb-2"
                                    : "text-amber-600 dark:text-amber-400 mb-2"
                            }
                        />
                        <p
                            className={`font-mono text-xl font-bold ${avgFillTime <= 10 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                                }`}
                        >
                            {avgFillTime.toFixed(1)}m
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                            Average Fill Time Today
                            {avgFillTimeChangeMinutes !== null && (
                                <span className={avgFillTimeChangeMinutes <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                                    {" "}· {avgFillTimeChangeMinutes >= 0 ? "+" : ""}
                                    {avgFillTimeChangeMinutes.toFixed(1)}m vs yesterday
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="bg-card border border-border rounded-xl p-4">
                        {worstRouteIsBad ? (
                            <AlertTriangle size={16} className="text-destructive mb-2" />
                        ) : (
                            <ClockIcon size={16} className="text-emerald-600 dark:text-emerald-400 mb-2" />
                        )}
                        <p
                            className={`font-mono text-xl font-bold ${worstRouteIsBad ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                        >
                            {worstRoute ? `${worstRoute.today.toFixed(1)}m` : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                            {worstRoute ? (
                                <>
                                    <span className="text-foreground font-medium">{worstRoute.route}</span>
                                    {" "}· {worstRouteIsBad ? "+" : ""}
                                    {worstRouteDeviation.toFixed(1)}m vs yesterday
                                </>
                            ) : (
                                "Worst Turnaround"
                            )}
                        </p>
                    </div>
                </div>

                {/* ── Revenue Chart ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Gross Fare Revenue Trend" />
                    <div className="p-4">
                        <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={trend}>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="var(--border)"
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                                />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: "var(--card)",
                                        border: "1px solid var(--border)",
                                        borderRadius: "8px",
                                        color: "var(--foreground)",
                                    }}
                                    formatter={(value: number, name: string) => [
                                        formatCurrency(value),
                                        name === "revenue" ? "Gross Revenue" : "Commission",
                                    ]}
                                />
                                <Legend
                                    wrapperStyle={{ fontSize: 10, color: "var(--muted-foreground)" }}
                                    formatter={(value) => (value === "revenue" ? "Gross Revenue" : "Commission")}
                                />
                                <Line type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="commission" stroke="var(--chart-2, #34d399)" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                {/* ── Route Performance Card ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Route Performance" />

                    {/* Section 1: Fastest Routes Today */}
                    <div className="px-4 py-3 border-b border-border">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <Trophy size={12} className="text-amber-500" />
                                Fastest Routes Today
                            </p>
                            {allFastestRoutes.length > 5 && (
                                <button
                                    onClick={() => setShowAllRoutes((prev) => !prev)}
                                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {showAllRoutes ? "Show top 5" : `Show all (${allFastestRoutes.length})`}
                                    {showAllRoutes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {visibleRoutes.map((r, i) => (
                                <div
                                    key={r.route}
                                    className="flex items-center justify-between bg-muted/50 px-2 py-1.5 rounded-lg"
                                >
                                    <span className="text-[11px] text-muted-foreground font-mono w-4">{i + 1}</span>
                                    <span className="text-[11px] font-medium text-foreground flex-1 truncate px-1">
                                        {r.route}
                                    </span>
                                    <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                        {r.today.toFixed(1)}m
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Section 2: Turnaround vs Yesterday Average */}
                    <div className="px-4 py-2 border-b border-border flex justify-between text-[10px] text-muted-foreground">
                        <span>Route</span>
                        <span>Today vs Yesterday avg</span>
                    </div>
                    <div className="divide-y divide-border">
                        {sortedByDeviation.map((r) => {
                            const deviation = r.today - r.dayAvg;
                            const isWorse = deviation > 0;
                            return (
                                <div
                                    key={r.route}
                                    className="px-4 py-3 hover:bg-muted/50 transition-colors"
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs font-medium text-foreground">{r.route}</p>
                                            <p className="text-[10px] text-muted-foreground">
                                                {r.vehicles} vehicle{r.vehicles > 1 ? "s" : ""}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span
                                                className={`text-xs font-mono font-bold ${isWorse ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                                                    }`}
                                            >
                                                {isWorse ? "🔺" : "🔻"} {isWorse ? "+" : ""}
                                                {deviation.toFixed(1)} min
                                            </span>
                                            <p className="text-[10px] text-muted-foreground font-mono">
                                                {r.today.toFixed(1)}m today{" "}
                                                <span className="opacity-40">|</span> Wed avg{" "}
                                                {r.dayAvg.toFixed(1)}m
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── Recent Trips ── */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <CardHeader title="Recent Trips" />
                    <div className="divide-y divide-border">
                        {recentTrips.map((t) => (
                            <RecentTripRow key={t.id} trip={t} />
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
}