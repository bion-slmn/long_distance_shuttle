// src/features/dashboard/saccoAdmin.tsx
//
// The sacco admin's home screen. Built mobile-first: clerks and sacco
// officials read this on a phone at the stage, so everything stacks in one
// column by default and only fans out at sm/lg. Figures are large and
// tabular; labels are 12px rather than the 10px they used to be, because a
// number nobody can read at arm's length isn't reporting anything.
//
// Every panel answers a question and then hands off to the page that can act
// on it — earnings to /payments, trips to /trips, routes to /routeQueue.
//
// COMMISSION: there is exactly one source for the rate — the sacco's own
// settings row, surfaced through the earnings endpoint as `commissionRate`.
// Do not reintroduce a local constant here; the screen previously showed 2%
// on trip rows while the API reported 10% on the headline, which is how the
// same word came to mean two different amounts of money.

import { useState } from "react";
import { Link } from "react-router-dom";
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
    AlertTriangle,
    RefreshCw,
    Repeat,
    Clock as ClockIcon,
    Percent,
    Trophy,
    ChevronUp,
    ChevronDown,
    ChevronRight,
    Users,
    Smartphone,
    Wallet,
    Car,
    Inbox,
} from "lucide-react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getRevenueTrendRequest, getTodayEarningsRequest } from "@/api/bookingApi";
import {
    getTripCountSummary,
    getTrips,
    getAverageTripsPerVehicleSummary,
    getTodayPassengerStatsRequest,
    type Trip,
} from "@/api/tripApi";
import {
    getSaccoPaymentsRequest,
    PaymentMethod,
    PaymentStatus,
    type Payment,
} from "@/api/paymentApi";
import {
    getFastestRoutesTodayRequest,
    getFillTimeComparisonRequest,
    getRoutePerformanceVsYesterdayRequest,
} from "@/api/routeApi";
import { useAuth } from "../auth/AuthContext";
import { useRouteName } from "@/hooks/useRoute";
import { useVehicleNumberPlate } from "@/hooks/useVehicleNumberPlate";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number) {
    return `KSh ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

/** Payment.amount is a numeric column with no transformer — it arrives as a string. */
function amountOf(payment: Payment): number {
    return Number(payment.amount) || 0;
}

// ── Shared presentational pieces ────────────────────────────────────────────

/**
 * One consistent treatment for "up is good" / "down is good" deltas. Every
 * KPI used to hand-roll this with slightly different wording and sign rules.
 */
function Delta({
    value,
    suffix,
    lowerIsBetter = false,
    label,
}: {
    value: number | null | undefined;
    suffix: string;
    lowerIsBetter?: boolean;
    label?: string;
}) {
    if (value === null || value === undefined) return null;
    const good = lowerIsBetter ? value <= 0 : value >= 0;
    return (
        <span
            className={cn(
                "font-medium tabular-nums",
                good ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
            )}
        >
            {value >= 0 ? "+" : ""}
            {value.toFixed(suffix === "%" ? 0 : 1)}
            {suffix}
            {label ? ` ${label}` : ""}
        </span>
    );
}

/**
 * Loading / error / empty for one panel. Rendering zeros while a request is
 * failing is the one thing a money dashboard must never do — a 0 that means
 * "we couldn't ask" is indistinguishable from a 0 that means "a quiet day",
 * and only one of those is worth acting on.
 */
function QueryState({
    query,
    isEmpty,
    emptyLabel,
    skeleton,
    children,
}: {
    query: Pick<UseQueryResult, "isLoading" | "isError" | "refetch">;
    isEmpty?: boolean;
    emptyLabel?: string;
    skeleton?: React.ReactNode;
    children: React.ReactNode;
}) {
    if (query.isLoading) {
        return <>{skeleton ?? <Skeleton className="h-24 w-full rounded-lg" />}</>;
    }

    if (query.isError) {
        return (
            <div className="flex items-center gap-3 px-4 py-5 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-destructive" />
                <span className="flex-1 text-muted-foreground">Couldn't load this.</span>
                <button
                    onClick={() => query.refetch()}
                    className="min-h-9 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (isEmpty) {
        return (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <Inbox className="size-5 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">{emptyLabel ?? "Nothing yet today."}</p>
            </div>
        );
    }

    return <>{children}</>;
}

/** A KPI tile. Big number, readable label, optional delta line. */
function Stat({
    icon,
    value,
    label,
    detail,
    tone = "default",
    query,
}: {
    icon: React.ReactNode;
    value: string;
    label: string;
    detail?: React.ReactNode;
    tone?: "default" | "good" | "warn" | "bad";
    query: Pick<UseQueryResult, "isLoading" | "isError" | "refetch">;
}) {
    const toneClass = {
        default: "text-foreground",
        good: "text-emerald-600 dark:text-emerald-400",
        warn: "text-amber-600 dark:text-amber-400",
        bad: "text-destructive",
    }[tone];

    return (
        <div className="bg-card border border-border rounded-xl p-4">
            <div className="mb-2">{icon}</div>
            {query.isLoading ? (
                <Skeleton className="h-7 w-20 rounded" />
            ) : query.isError ? (
                <p className="text-2xl font-bold text-muted-foreground/40 leading-none">—</p>
            ) : (
                <p className={cn("font-mono text-2xl font-bold leading-none tabular-nums", toneClass)}>
                    {value}
                </p>
            )}
            <p className="text-xs font-medium text-foreground mt-2">{label}</p>
            {!query.isError && detail && (
                <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
            )}
            {query.isError && <p className="text-xs text-destructive mt-0.5">Couldn't load</p>}
        </div>
    );
}

/** Card shell with a heading and an optional drill-down into a real page. */
function Panel({
    title,
    to,
    toLabel = "View all",
    children,
}: {
    title: string;
    to?: string;
    toLabel?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                {to && (
                    <Link
                        to={to}
                        className="inline-flex items-center gap-0.5 -mr-1 min-h-9 px-1 text-xs font-medium text-primary hover:underline"
                    >
                        {toLabel}
                        <ChevronRight className="size-3.5" />
                    </Link>
                )}
            </div>
            {children}
        </section>
    );
}

// ── Recent trip row (own component so the per-row lookup hooks are legal) ────

function RecentTripRow({ trip, commissionRate }: { trip: Trip; commissionRate: number | null }) {
    const routeName = useRouteName(trip.routeId);
    const { numberPlate } = useVehicleNumberPlate(trip.vehicleId);

    // A trip's revenue is fare × seats sold, not one fare — showing the
    // commission on a single seat made every trip look like small change.
    const revenue = trip.fare * (trip.passengerCount ?? 0);

    return (
        <div className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{routeName ?? "—"}</p>
                <p className="text-xs text-muted-foreground truncate">
                    {numberPlate ?? "—"} · {trip.passengerCount ?? 0} pax ·{" "}
                    {new Date(trip.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </p>
            </div>
            <div className="text-right shrink-0">
                <p className="text-sm font-mono font-semibold tabular-nums text-foreground">
                    {formatCurrency(revenue)}
                </p>
                {commissionRate !== null && (
                    <p className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(revenue * commissionRate)}
                    </p>
                )}
            </div>
        </div>
    );
}

// ── Payments today ──────────────────────────────────────────────────────────

function summarisePayments(payments: Payment[]) {
    const empty = { total: 0, count: 0 };
    const summary = {
        mpesa: { ...empty },
        cash: { ...empty },
        pending: { ...empty },
        failed: { ...empty },
    };

    for (const p of payments) {
        const amount = amountOf(p);
        if (p.status === PaymentStatus.SUCCESS) {
            const bucket = p.method === PaymentMethod.MPESA ? summary.mpesa : summary.cash;
            bucket.total += amount;
            bucket.count += 1;
        } else if (p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING) {
            summary.pending.total += amount;
            summary.pending.count += 1;
        } else {
            // FAILED and EXPIRED alike — money the passenger meant to pay and
            // the sacco never received.
            summary.failed.total += amount;
            summary.failed.count += 1;
        }
    }

    return summary;
}

function PaymentSplitRow({
    icon,
    label,
    total,
    count,
    share,
}: {
    icon: React.ReactNode;
    label: string;
    total: number;
    count: number;
    share: number;
}) {
    return (
        <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {icon}
                    {label}
                </span>
                <span className="text-sm font-mono font-semibold tabular-nums">
                    {formatCurrency(total)}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, share * 100)}%` }}
                    />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                    {count} payment{count === 1 ? "" : "s"}
                </span>
            </div>
        </div>
    );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function SaccoAdminDashboard() {
    const [showAllRoutes, setShowAllRoutes] = useState(false);
    const { user } = useAuth();
    // Narrowed to `string | undefined` — the request helpers take an optional
    // saccoId, and a literal null would be sent as a query param.
    const saccoId = user?.saccoId ?? undefined;
    const today = todayISO();

    const enabled = !!saccoId;

    // ── Money ──
    const earningsQuery = useQuery({
        queryKey: ["earnings-today", saccoId],
        queryFn: () => getTodayEarningsRequest(saccoId),
        enabled,
    });

    const trendQuery = useQuery({
        queryKey: ["earnings-trend", saccoId],
        queryFn: () => getRevenueTrendRequest(7, saccoId),
        enabled,
    });

    const paymentsQuery = useQuery({
        queryKey: ["payments-today", saccoId, today],
        queryFn: () => getSaccoPaymentsRequest({ from: today, to: today }),
        enabled,
    });

    // ── Volume ──
    const passengersQuery = useQuery({
        queryKey: ["passengers-today", saccoId],
        queryFn: () => getTodayPassengerStatsRequest(saccoId),
        enabled,
    });

    const tripsQuery = useQuery({
        queryKey: ["trip-count-summary", saccoId],
        queryFn: () => getTripCountSummary(saccoId),
        enabled,
    });

    const perVehicleQuery = useQuery({
        queryKey: ["avg-trips-per-vehicle", saccoId],
        queryFn: () => getAverageTripsPerVehicleSummary(saccoId),
        enabled,
    });

    const recentTripsQuery = useQuery({
        queryKey: ["recent-trips", saccoId],
        queryFn: () => getTrips({ page: 1, limit: 5 }),
        enabled,
    });

    // ── Route performance (backend scopes these to the caller's sacco) ──
    const fillTimeQuery = useQuery({
        queryKey: ["fill-time-comparison", saccoId],
        queryFn: getFillTimeComparisonRequest,
        enabled,
    });

    const fastestRoutesQuery = useQuery({
        queryKey: ["fastest-routes-today", saccoId],
        queryFn: getFastestRoutesTodayRequest,
        enabled,
    });

    const routePerformanceQuery = useQuery({
        queryKey: ["route-performance-vs-yesterday", saccoId],
        queryFn: getRoutePerformanceVsYesterdayRequest,
        enabled,
    });

    const allQueries = [
        earningsQuery,
        trendQuery,
        paymentsQuery,
        passengersQuery,
        tripsQuery,
        perVehicleQuery,
        recentTripsQuery,
        fillTimeQuery,
        fastestRoutesQuery,
        routePerformanceQuery,
    ];

    const isRefreshing = allQueries.some((q) => q.isFetching);
    const handleRefresh = () => allQueries.forEach((q) => q.refetch());

    // ── Derived ──
    const earnings = earningsQuery.data;
    const commissionRate = earnings?.commissionRate ?? null;

    const payments = summarisePayments(paymentsQuery.data ?? []);
    const collected = payments.mpesa.total + payments.cash.total;
    const needsAttention = payments.pending.count > 0 || payments.failed.count > 0;

    const trend = trendQuery.data ?? [];
    const fastestRoutes = fastestRoutesQuery.data ?? []; // already sorted ascending by the backend
    const visibleRoutes = showAllRoutes ? fastestRoutes : fastestRoutes.slice(0, 5);

    const sortedByDeviation = [...(routePerformanceQuery.data ?? [])].sort(
        (a, b) => b.today - b.dayAvg - (a.today - a.dayAvg),
    );
    const worstRoute = sortedByDeviation[0] ?? null;
    const worstRouteDeviation = worstRoute ? worstRoute.today - worstRoute.dayAvg : 0;
    const worstRouteIsBad = worstRouteDeviation > 0;

    const avgFillTime = fillTimeQuery.data?.today ?? 0;
    const recentTrips = recentTripsQuery.data?.data ?? [];

    // A sacco admin with no sacco can't be shown anything — say so rather
    // than rendering a screen of dashes.
    if (!saccoId) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <AlertTriangle className="size-6 text-amber-500" />
                <p className="text-sm font-medium text-foreground">
                    Your account isn't assigned to a sacco.
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                    A super admin needs to link your account to a sacco before this dashboard can
                    show anything.
                </p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-w-0 bg-background">
            {/* ── Header ── */}
            {/* Title and refresh share one row, so the heading costs no extra
                vertical space on a phone. Same treatment as BookingsList. */}
            <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-4 py-2 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Dashboard</h2>
                <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    aria-label="Refresh dashboard"
                    className="size-9 shrink-0 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                </button>
            </header>

            <main className="flex-1 overflow-y-auto p-4 space-y-4 pb-10">
                {/* ── Earnings hero — the number the admin opened this for ── */}
                <section className="bg-primary rounded-xl p-5">
                    <div className="flex items-start justify-between gap-3">
                        <Percent size={18} className="text-primary-foreground/80" />
                        {commissionRate !== null && (
                            <Link
                                to="/settings"
                                className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/15 px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary-foreground/25 transition-colors"
                            >
                                {(commissionRate * 100).toFixed(commissionRate * 100 % 1 === 0 ? 0 : 2)}% rate
                                <ChevronRight className="size-3" />
                            </Link>
                        )}
                    </div>

                    {earningsQuery.isLoading ? (
                        <Skeleton className="h-10 w-40 rounded mt-3 bg-primary-foreground/20" />
                    ) : earningsQuery.isError ? (
                        <div className="mt-3">
                            <p className="text-3xl font-bold text-primary-foreground/40 font-mono">—</p>
                            <button
                                onClick={() => earningsQuery.refetch()}
                                className="mt-2 min-h-9 rounded-lg bg-primary-foreground/15 px-3 text-xs font-semibold text-primary-foreground"
                            >
                                Couldn't load · Retry
                            </button>
                        </div>
                    ) : (
                        <>
                            <p className="font-mono text-3xl font-bold text-primary-foreground tabular-nums mt-3 leading-none">
                                {formatCurrency(earnings?.commission ?? 0)}
                            </p>
                            <p className="text-sm font-medium text-primary-foreground/90 mt-2">
                                SACCO earnings today
                            </p>
                            <p className="text-xs text-primary-foreground/70 mt-0.5">
                                From {formatCurrency(earnings?.grossRevenue ?? 0)} in gross fares
                            </p>
                        </>
                    )}
                </section>

                {/* ── KPIs — 2 up on a phone, 4 across from lg ── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Stat
                        query={passengersQuery}
                        icon={<Users size={16} className="text-primary" />}
                        value={String(passengersQuery.data?.today ?? 0)}
                        label="Passengers today"
                        detail={
                            <Delta
                                value={passengersQuery.data?.changePercent}
                                suffix="%"
                                label="vs yesterday"
                            />
                        }
                    />

                    <Stat
                        query={tripsQuery}
                        icon={<Repeat size={16} className="text-emerald-600 dark:text-emerald-400" />}
                        value={String(tripsQuery.data?.today ?? 0)}
                        label="Trips today"
                        detail={
                            <Delta
                                value={tripsQuery.data?.changePercent}
                                suffix="%"
                                label="vs yesterday"
                            />
                        }
                    />

                    <Stat
                        query={fillTimeQuery}
                        icon={
                            <ClockIcon
                                size={16}
                                className={
                                    avgFillTime <= 10
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-amber-600 dark:text-amber-400"
                                }
                            />
                        }
                        tone={avgFillTime <= 10 ? "good" : "warn"}
                        value={`${avgFillTime.toFixed(1)}m`}
                        label="Avg fill time"
                        detail={
                            <Delta
                                value={fillTimeQuery.data?.changeMinutes}
                                suffix="m"
                                lowerIsBetter
                                label="vs yesterday"
                            />
                        }
                    />

                    <Stat
                        query={perVehicleQuery}
                        icon={<Car size={16} className="text-primary" />}
                        value={(perVehicleQuery.data?.todayAverage ?? 0).toFixed(1)}
                        label="Trips per vehicle"
                        detail={
                            <Delta
                                value={perVehicleQuery.data?.changePercent}
                                suffix="%"
                                label="vs yesterday"
                            />
                        }
                    />
                </div>

                {/* ── Payments today — where the money actually came from ── */}
                <Panel title="Payments today" to="/payments">
                    <QueryState
                        query={paymentsQuery}
                        isEmpty={(paymentsQuery.data?.length ?? 0) === 0}
                        emptyLabel="No payments recorded yet today."
                        skeleton={
                            <div className="p-4 space-y-3">
                                <Skeleton className="h-10 w-full rounded" />
                                <Skeleton className="h-10 w-full rounded" />
                            </div>
                        }
                    >
                        <div className="px-4 pt-3">
                            <p className="font-mono text-2xl font-bold tabular-nums text-foreground leading-none">
                                {formatCurrency(collected)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">collected and confirmed</p>
                        </div>

                        <div className="divide-y divide-border mt-1">
                            <PaymentSplitRow
                                icon={
                                    <Smartphone className="size-4 text-emerald-600 dark:text-emerald-400" />
                                }
                                label="M-Pesa"
                                total={payments.mpesa.total}
                                count={payments.mpesa.count}
                                share={collected > 0 ? payments.mpesa.total / collected : 0}
                            />
                            <PaymentSplitRow
                                icon={<Wallet className="size-4 text-primary" />}
                                label="Cash"
                                total={payments.cash.total}
                                count={payments.cash.count}
                                share={collected > 0 ? payments.cash.total / collected : 0}
                            />
                        </div>

                        {/* Money that was meant to arrive and hasn't — the only
                            part of this panel that ever needs a decision. */}
                        {needsAttention && (
                            <div className="border-t border-border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                                {payments.pending.count > 0 && (
                                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium tabular-nums">
                                        {payments.pending.count} pending ·{" "}
                                        {formatCurrency(payments.pending.total)}
                                    </span>
                                )}
                                {payments.failed.count > 0 && (
                                    <span className="text-xs text-destructive font-medium tabular-nums">
                                        {payments.failed.count} failed ·{" "}
                                        {formatCurrency(payments.failed.total)}
                                    </span>
                                )}
                            </div>
                        )}
                    </QueryState>
                </Panel>

                {/* ── Revenue trend ── */}
                <Panel title="Gross fare revenue · last 7 days">
                    <QueryState
                        query={trendQuery}
                        isEmpty={trend.every((p) => p.revenue === 0)}
                        emptyLabel="No paid bookings in the last 7 days."
                        skeleton={<Skeleton className="h-48 m-4 rounded-lg" />}
                    >
                        <div className="p-2 sm:p-4">
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(d: string) =>
                                            new Date(d).toLocaleDateString([], {
                                                day: "numeric",
                                                month: "short",
                                            })
                                        }
                                        minTickGap={16}
                                    />
                                    <YAxis
                                        tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={44}
                                        tickFormatter={(v: number) =>
                                            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                                        }
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: "var(--card)",
                                            border: "1px solid var(--border)",
                                            borderRadius: "8px",
                                            color: "var(--foreground)",
                                            fontSize: 12,
                                        }}
                                        formatter={(value, name) => [
                                            formatCurrency(Number(value ?? 0)),
                                            name === "revenue" ? "Gross revenue" : "SACCO commission",
                                        ]}
                                    />
                                    <Legend
                                        wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
                                        formatter={(value) =>
                                            value === "revenue" ? "Gross revenue" : "SACCO commission"
                                        }
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="revenue"
                                        stroke="var(--primary)"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="commission"
                                        stroke="var(--chart-2, #34d399)"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </QueryState>
                </Panel>

                {/* ── Worst turnaround — a callout, not a KPI tile ── */}
                {worstRoute && worstRouteIsBad && (
                    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                        <AlertTriangle className="size-4 shrink-0 text-destructive mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">
                                {worstRoute.route} is slowing down
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                                {worstRoute.today.toFixed(1)}m to fill today · +
                                {worstRouteDeviation.toFixed(1)}m vs its usual
                            </p>
                        </div>
                    </div>
                )}

                {/* ── Route performance ── */}
                <Panel title="Route performance" to="/routeQueue" toLabel="Queue">
                    <QueryState
                        query={fastestRoutesQuery}
                        isEmpty={fastestRoutes.length === 0 && sortedByDeviation.length === 0}
                        emptyLabel="No vehicles have filled on any route yet today."
                        skeleton={<Skeleton className="h-40 m-4 rounded-lg" />}
                    >
                        {/* Fastest today */}
                        {fastestRoutes.length > 0 && (
                            <div className="px-4 py-3 border-b border-border">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                        <Trophy size={13} className="text-amber-500" />
                                        Fastest today
                                    </p>
                                    {fastestRoutes.length > 5 && (
                                        <button
                                            onClick={() => setShowAllRoutes((prev) => !prev)}
                                            className="flex items-center gap-1 min-h-9 text-xs font-medium text-primary"
                                        >
                                            {showAllRoutes ? "Top 5" : `All ${fastestRoutes.length}`}
                                            {showAllRoutes ? (
                                                <ChevronUp size={13} />
                                            ) : (
                                                <ChevronDown size={13} />
                                            )}
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                    {visibleRoutes.map((r, i) => (
                                        <div
                                            key={r.route}
                                            className="flex items-center gap-2 bg-muted/50 px-2.5 py-2 rounded-lg"
                                        >
                                            <span className="text-xs text-muted-foreground font-mono w-4 shrink-0">
                                                {i + 1}
                                            </span>
                                            <span className="text-sm font-medium text-foreground flex-1 truncate">
                                                {r.route}
                                            </span>
                                            <span className="text-sm font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                                                {r.today.toFixed(1)}m
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Turnaround vs the same weekday's average */}
                        <div className="divide-y divide-border">
                            {sortedByDeviation.map((r) => {
                                const deviation = r.today - r.dayAvg;
                                const isWorse = deviation > 0;
                                return (
                                    <div key={r.route} className="px-4 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-foreground truncate">
                                                    {r.route}
                                                </p>
                                                <p className="text-xs text-muted-foreground tabular-nums">
                                                    {r.vehicles} vehicle{r.vehicles === 1 ? "" : "s"} ·{" "}
                                                    {r.today.toFixed(1)}m today · {r.dayAvg.toFixed(1)}m
                                                    usual
                                                </p>
                                            </div>
                                            <span
                                                className={cn(
                                                    "text-sm font-mono font-bold tabular-nums shrink-0",
                                                    isWorse
                                                        ? "text-destructive"
                                                        : "text-emerald-600 dark:text-emerald-400",
                                                )}
                                            >
                                                {isWorse ? "+" : ""}
                                                {deviation.toFixed(1)}m
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </QueryState>
                </Panel>

                {/* ── Recent trips ── */}
                <Panel title="Recent trips" to="/trips">
                    <QueryState
                        query={recentTripsQuery}
                        isEmpty={recentTrips.length === 0}
                        emptyLabel="No trips dispatched yet."
                        skeleton={<Skeleton className="h-32 m-4 rounded-lg" />}
                    >
                        <div className="divide-y divide-border">
                            {recentTrips.map((t) => (
                                <RecentTripRow key={t.id} trip={t} commissionRate={commissionRate} />
                            ))}
                        </div>
                    </QueryState>
                </Panel>
            </main>
        </div>
    );
}
