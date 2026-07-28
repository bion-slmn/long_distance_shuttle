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
    BarChart,
    Bar,
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
import { getSaccoCountStatsRequest, getSaccoPerformanceStatsRequest } from "@/api/saccoApi";
import { useNavigate } from "react-router-dom";
import { getTodayPassengerStatsRequest, getTripCountSummary, getTripTrendRequest } from "@/api/tripApi";
import { getRevenueTrendRequest, getTodayEarningsRequest, getUniquePassengerStatsRequest } from "@/api/bookingApi";
import { getSystemHealthRequest } from "@/api/healthApi";

// ── Dummy Data ──────────────────────────────────────────────────────────────

// Top cards
const metrics = {
    totalSaccos: 18,
    activeSaccosToday: 16,
    tripsToday: 245,
    bookingsToday: 3421,
    revenueToday: 412000,
    activeUsers: 912,
};

// System health
const systemHealth = {
    api: { status: "healthy", responseTime: 180 },
    database: { status: "healthy" },
    failedRequests: 4,
    queueJobs: "Running",
    lastBackup: "2025-07-27 02:00 AM",
};

// Bookings trend (hourly)
const bookingsTrend = [
    { hour: "06:00", bookings: 120, trips: 18 },
    { hour: "07:00", bookings: 340, trips: 45 },
    { hour: "08:00", bookings: 580, trips: 72 },
    { hour: "09:00", bookings: 490, trips: 68 },
    { hour: "10:00", bookings: 320, trips: 42 },
    { hour: "11:00", bookings: 210, trips: 30 },
    { hour: "12:00", bookings: 390, trips: 52 },
    { hour: "13:00", bookings: 280, trips: 38 },
    { hour: "14:00", bookings: 190, trips: 25 },
    { hour: "15:00", bookings: 220, trips: 28 },
    { hour: "16:00", bookings: 410, trips: 55 },
    { hour: "17:00", bookings: 470, trips: 62 },
];



// Recent activity
const recentActivity = [
    { time: "09:15", action: "New Sacco registered" },
    { time: "09:21", action: "Vehicle KDL 245A dispatched" },
    { time: "09:40", action: "Clerk John created Route Nairobi–Kisumu" },
    { time: "10:02", action: "Admin suspended user" },
    { time: "10:15", action: "Payment of KSh 12,000 processed" },
];

// Top routes
const topRoutes = [
    { route: "Nairobi → Kisumu", bookings: 1250 },
    { route: "Nairobi → Eldoret", bookings: 980 },
    { route: "Nairobi → Mombasa", bookings: 820 },
    { route: "Nairobi → Nakuru", bookings: 620 },
    { route: "Nairobi → Thika", bookings: 480 },
];

// User statistics
const userStats = {
    totalUsers: 2340,
    activeToday: 912,
    newThisWeek: 48,
    suspended: 12,
};

// ── Utility ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number) {
    return `KSh ${amount.toLocaleString()}`;
}

function getStatusBadge(status: string) {
    const map: Record<string, { label: string; cls: string }> = {
        Healthy: { label: "Healthy", cls: "bg-emerald-400/10 text-emerald-400" },
        "Low Activity": { label: "Low Activity", cls: "bg-amber-400/10 text-amber-400" },
        critical: { label: "Critical", cls: "bg-red-400/10 text-red-400" },
        warning: { label: "Warning", cls: "bg-amber-400/10 text-amber-400" },
        info: { label: "Info", cls: "bg-blue-400/10 text-blue-400" },
    };
    const s = map[status] || { label: status, cls: "bg-gray-400/10 text-gray-400" };
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}

// ── Components ──────────────────────────────────────────────────────────────

function CardHeader({ title, icon }: { title: string; icon?: React.ReactNode }) {
    return (
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
            {icon && <span className="text-gray-400">{icon}</span>}
            <h2 className="text-sm font-semibold text-white">{title}</h2>
        </div>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface SuperAdminDashboardProps {
    onRefresh?: () => void;
}

function TrendBadge({ percent, direction }: { percent: number | null; direction: 'up' | 'down' | 'no-change' }) {
    if (percent === null) {
        return <p className="text-[10px] text-gray-400 mt-0.5">vs yesterday: n/a</p>;
    }
    const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
    const color = direction === 'up' ? 'text-emerald-400' : direction === 'down' ? 'text-red-400' : 'text-gray-400';
    return (
        <div className="flex items-center gap-1 mt-0.5">
            <Icon size={10} className={color} />
            <p className={`text-[10px] ${color}`}>
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
        staleTime: 60_000, // 1 min — this doesn't need to be hyper-fresh
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
        staleTime: 5 * 60_000, // trend chart doesn't need to be as fresh as KPI cards
    });

    const { data: tripTrend, isLoading: tripTrendLoading } = useQuery({
        queryKey: ["tripTrend", 7],
        queryFn: () => getTripTrendRequest(7),
        staleTime: 5 * 60_000,
    });

    // inside the component
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

    // Merge revenue + trip trend by date into one array recharts can plot
    const combinedTrend = (revenueTrend ?? []).map((r) => {
        const match = tripTrend?.find((t) => t.date === r.date);
        return { date: r.date, revenue: r.revenue, trips: match?.trips ?? 0 };
    });

    const { data: saccoPerformance, isLoading: saccoPerformanceLoading } = useQuery({
        queryKey: ["saccoPerformance"],
        queryFn: () => getSaccoPerformanceStatsRequest(false),
        staleTime: 5 * 60_000, // this is a weekly-cadence stat, doesn't need to be hyper-fresh
    });

    // derive alerts from sacco performance data already in memory
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

        // worst-first
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
        <div className="flex-1 flex flex-col min-w-0 bg-[#0a0e17] text-white">

            {/* Top Bar */}
            <header className="sticky top-0 z-10 bg-[#0a0e17]/90 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center justify-between">
                <div>
                    <h1 className="text-sm font-bold">Super Admin</h1>
                    <p className="text-[10px] text-gray-400 flex items-center gap-2">
                        <Calendar size={10} />
                        Wed, 23 Jul 2025
                        <span className="opacity-30">·</span>
                        <Clock size={10} />
                        09:24 EAT
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button className="relative w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
                        <Bell size={14} />
                        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-400 rounded-full" />
                    </button>
                    <button
                        onClick={handleRefresh}
                        className={`w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-colors ${loading ? 'animate-spin' : ''}`}
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* ── Section 1: Top Cards ── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                    {/* Saccos card — real data + click-through */}
                    <button
                        onClick={() => navigate("/sacco")}
                        className="bg-[#0f1420] border border-white/5 rounded-lg p-3 text-left hover:border-white/10 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    >
                        <div className="flex items-center gap-2 text-gray-400 mb-1">
                            <Building2 size={14} />
                            <span className="text-[10px]">Saccos</span>
                        </div>

                        {saccoStatsLoading ? (
                            <div className="h-7 w-10 bg-white/5 rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold">{saccoStats?.currentCount ?? 0}</p>
                        )}

                        {!saccoStatsLoading && saccoStats && (
                            <TrendBadge percent={saccoStats.percentageChange} direction={saccoStats.changeDirection} />
                        )}
                    </button>

                    {/* Trips card — real data, day-over-day */}
                    <div className="bg-[#0f1420] border border-white/5 rounded-lg p-3"
                        onClick={() => navigate("/trips")}>
                        <div className="flex items-center gap-2 text-emerald-400 mb-1">
                            <Bus size={14} />
                            <span className="text-[10px] text-gray-400">Trips</span>
                        </div>

                        {tripStatsLoading ? (
                            <div className="h-7 w-10 bg-white/5 rounded animate-pulse" />
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

                    <div className="bg-[#0f1420] border border-white/5 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-blue-400 mb-1">
                            <Ticket size={14} />
                            <span className="text-[10px] text-gray-400">Bookings</span>
                        </div>
                        <p className="font-mono text-xl font-bold">{metrics.bookingsToday.toLocaleString()}</p>
                        <p className="text-[10px] text-gray-400">today</p>
                    </div>

                    {/* Revenue card — real data, gross fares only (no commission model yet) */}
                    <div className="bg-[#f97316] rounded-lg p-3 col-span-1">
                        <div className="flex items-center gap-2 text-white/80 mb-1">
                            <DollarSign size={14} />
                            <span className="text-[10px] text-white/70">Revenue</span>
                        </div>

                        {earningsLoading ? (
                            <div className="h-7 w-20 bg-white/20 rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold text-white">
                                {formatCurrency(todayEarnings?.grossRevenue ?? 0)}
                            </p>
                        )}
                        <p className="text-[10px] text-white/70">today, all saccos</p>
                    </div>



                    {/* Total Passengers card — real data, daily headcount, day-over-day */}
                    <div className="bg-[#0f1420] border border-white/5 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-cyan-400 mb-1">
                            <Users size={14} />
                            <span className="text-[10px] text-gray-400">Total Passengers</span>
                        </div>

                        {passengerCountLoading ? (
                            <div className="h-7 w-10 bg-white/5 rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold">{passengerCountStats?.today ?? 0}</p>
                        )}

                        <p className="text-[10px] text-gray-400">today</p>

                        {!passengerCountLoading && passengerCountStats && (
                            <TrendBadge
                                percent={passengerCountStats.changePercent}
                                direction={
                                    passengerCountStats.changeCount > 0 ? 'up' : passengerCountStats.changeCount < 0 ? 'down' : 'no-change'
                                }
                            />
                        )}
                    </div>

                    {/* Replaces the old "New Users" card — this tracks real riders, not staff accounts */}
                    {/* Unique Riders card */}
                    <div className="bg-[#0f1420] border border-white/5 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-amber-400 mb-1">
                            <Users size={14} />
                            <span className="text-[10px] text-gray-400">Unique Riders</span>
                        </div>

                        {passengerStatsLoading ? (
                            <div className="h-7 w-10 bg-white/5 rounded animate-pulse" />
                        ) : (
                            <p className="font-mono text-xl font-bold">{passengerStats?.thisWeekUnique ?? 0}</p>
                        )}

                        <p className="text-[10px] text-gray-400">this week</p>

                        {!passengerStatsLoading && passengerStats && (
                            <>
                                <p className="text-[10px] text-gray-400">
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
                <div className="bg-[#0f1420] border border-white/5 rounded-xl overflow-hidden">
                    <CardHeader title="System Health" icon={<Activity size={14} />} />
                    <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        {systemHealthLoading ? (
                            <div className="col-span-full h-6 bg-white/5 rounded animate-pulse" />
                        ) : (
                            <>
                                <div className="flex items-center gap-2">
                                    {systemHealth?.api.status === 'up' ? (
                                        <CheckCircle size={14} className="text-emerald-400" />
                                    ) : (
                                        <AlertCircle size={14} className="text-red-400" />
                                    )}
                                    <span className="text-xs">API</span>
                                    <span className="text-xs text-gray-400">
                                        {systemHealth?.api.status ?? "unknown"}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    {systemHealth?.database.status === 'up' ? (
                                        <CheckCircle size={14} className="text-emerald-400" />
                                    ) : (
                                        <AlertCircle size={14} className="text-red-400" />
                                    )}
                                    <span className="text-xs">Database</span>
                                    <span className="text-xs text-gray-400">
                                        {systemHealth?.database.responseTime ?? 0}ms
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">Errors</span>
                                    <span className={`text-xs font-mono ${(systemHealth?.failedRequests ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        {systemHealth?.failedRequests ?? 0}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Zap size={14} className="text-blue-400" />
                                    <span className="text-xs">Jobs</span>
                                    <span className="text-xs text-gray-400">
                                        {systemHealth?.queueJobs ?? "Not tracked"}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Clock size={14} className="text-gray-400" />
                                    <span className="text-xs">Backup</span>
                                    <span className="text-xs text-gray-400">
                                        {systemHealth?.lastBackup ?? "Not tracked"}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Section 3: Revenue & Trips Trend (7 days) ── */}
                <div className="bg-[#0f1420] border border-white/5 rounded-xl overflow-hidden">
                    <CardHeader title="Revenue & Trips (Last 7 Days)" icon={<TrendingUp size={14} />} />
                    <div className="p-4">
                        {trendLoading ? (
                            <div className="h-[180px] bg-white/5 rounded animate-pulse" />
                        ) : (
                            <ResponsiveContainer width="100%" height={180}>
                                <LineChart data={combinedTrend}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fill: "#6b7694", fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                                    />
                                    <YAxis yAxisId="left" tick={{ fill: "#6b7694", fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "#6b7694", fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        labelStyle={{ color: '#6b7694', fontSize: '10px' }}
                                        labelFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                        formatter={(value: number, name: string) =>
                                            name === "revenue" ? [formatCurrency(value), "Revenue"] : [value, "Trips"]
                                        }
                                    />
                                    <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#f97316" strokeWidth={2} dot={false} />
                                    <Line yAxisId="right" type="monotone" dataKey="trips" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                        <div className="flex justify-center gap-6 text-[10px] text-gray-400 mt-2">
                            <span><span className="inline-block w-2 h-2 rounded-full bg-[#f97316] mr-1"></span> Revenue (fares)</span>
                            <span><span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1"></span> Trips</span>
                        </div>
                    </div>
                </div>

                {/* ── Section 4: Sacco Performance Table ── */}
                {/* ── Section 4: Sacco Performance Table ── */}
                <div className="bg-[#0f1420] border border-white/5 rounded-xl overflow-hidden">
                    <CardHeader title="Sacco Performance" icon={<Building2 size={14} />} />
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/5">
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-gray-400">Sacco</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-gray-400">Trips</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-gray-400">Bookings</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-gray-400">Fares Collected</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-gray-400">Last Active</th>
                                    <th className="text-left px-4 py-2 text-[10px] font-mono text-gray-400">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {saccoPerformanceLoading ? (
                                    Array.from({ length: 4 }).map((_, i) => (
                                        <tr key={i} className="border-b border-white/5">
                                            <td colSpan={6} className="px-4 py-2.5">
                                                <div className="h-4 w-full bg-white/5 rounded animate-pulse" />
                                            </td>
                                        </tr>
                                    ))
                                ) : saccoPerformance && saccoPerformance.length > 0 ? (
                                    saccoPerformance.map((s) => (
                                        <tr key={s.saccoId} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-2.5 text-xs font-medium">{s.saccoName}</td>
                                            <td className="px-4 py-2.5 text-xs">
                                                {s.tripsThisWeek}
                                                {s.tripsChangePercent !== null && (
                                                    <span className={s.tripsChangePercent >= 0 ? "text-emerald-400 ml-1" : "text-red-400 ml-1"}>
                                                        ({s.tripsChangePercent > 0 ? "+" : ""}{s.tripsChangePercent}%)
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2.5 text-xs">{s.bookingsThisWeek}</td>
                                            <td className="px-4 py-2.5 text-xs font-mono text-[#f97316]">
                                                {formatCurrency(s.grossFaresThisWeek)}
                                            </td>
                                            <td className="px-4 py-2.5 text-xs text-gray-400">
                                                {s.lastActiveDate
                                                    ? new Date(s.lastActiveDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                                                    : "Never"}
                                            </td>
                                            <td className="px-4 py-2.5">{getStatusBadge(s.status)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-6 text-center text-xs text-gray-400">
                                            No saccos found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── Section 5: Alerts ── */}
                <div className="bg-[#0f1420] border border-white/5 rounded-xl overflow-hidden">
                    <CardHeader title="Alerts" icon={<AlertCircle size={14} />} />
                    <div className="divide-y divide-white/5">
                        {saccoPerformanceLoading ? (
                            <div className="px-4 py-2.5">
                                <div className="h-4 w-full bg-white/5 rounded animate-pulse" />
                            </div>
                        ) : alerts.length === 0 ? (
                            <div className="px-4 py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                                <CheckCircle size={14} className="text-emerald-400" />
                                All saccos healthy — no alerts
                            </div>
                        ) : (
                            alerts.map((alert, idx) => {
                                const Icon = alert.type === 'critical' ? AlertCircle : alert.type === 'warning' ? AlertTriangle : AlertCircle;
                                const color = alert.type === 'critical' ? 'text-red-400' : alert.type === 'warning' ? 'text-amber-400' : 'text-blue-400';
                                return (
                                    <div key={idx} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                                        <Icon size={14} className={color} />
                                        <span className="text-white">{alert.message}</span>
                                        {getStatusBadge(alert.type)}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ── Section 6: Recent Activity ── */}
                <div className="bg-[#0f1420] border border-white/5 rounded-xl overflow-hidden">
                    <CardHeader title="Recent Activity" icon={<Zap size={14} />} />
                    <div className="divide-y divide-white/5 max-h-40 overflow-y-auto">
                        {recentActivity.map((item, idx) => (
                            <div key={idx} className="px-4 py-2 flex items-center gap-3 text-xs hover:bg-white/[0.02] transition-colors">
                                <span className="text-gray-500 font-mono w-12">{item.time}</span>
                                <span className="text-gray-300">{item.action}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Section 7: Top Routes ── */}
                <div className="bg-[#0f1420] border border-white/5 rounded-xl overflow-hidden">
                    <CardHeader title="Top Routes" icon={<Bus size={14} />} />
                    <div className="divide-y divide-white/5">
                        {topRoutes.map((route, idx) => (
                            <div key={idx} className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-white/[0.02] transition-colors">
                                <span className="text-white">{route.route}</span>
                                <span className="text-gray-400 font-mono">{route.bookings} bookings</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Section 8: Quick Actions ── */}
                <div className="bg-[#0f1420] border border-white/5 rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-white mb-3">Quick Actions</h3>
                    <div className="flex flex-wrap gap-2">
                        <button className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white text-xs px-3 py-2 rounded-lg transition-colors">
                            <Building2 size={14} /> Add Sacco
                        </button>
                        <button className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white text-xs px-3 py-2 rounded-lg transition-colors">
                            <Bus size={14} /> Add Route
                        </button>
                        <button className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white text-xs px-3 py-2 rounded-lg transition-colors">
                            <Users size={14} /> Create Admin
                        </button>
                        <button className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white text-xs px-3 py-2 rounded-lg transition-colors">
                            <FileText size={14} /> View Reports
                        </button>
                        <button className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white text-xs px-3 py-2 rounded-lg transition-colors">
                            <Activity size={14} /> System Logs
                        </button>
                    </div>
                </div>

            </main>
        </div>
    );
}