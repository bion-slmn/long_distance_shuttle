// src/features/booking/BookingsList.tsx
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getBookingsRequest, type Booking, type BookingStatus } from "@/api/bookingApi";
import { getPaymentStatusForBookingRequest } from "@/api/paymentApi";
import { useAuth } from "@/features/auth/AuthContext";
import { VehicleCombobox } from "@/features/fleet/VehicleCombobox";
import { SaccoCombobox } from "@/features/sacco/SaccoCombobox";
import { BookingsCharts } from "./BookingsCharts";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Smartphone,
    Banknote,
    Calendar,
    User,
    Phone,
    Clock,
    AlertCircle,
    Car,
    ClipboardList,
    SlidersHorizontal,
    ChevronDown,
    ChevronRight,
    Search,
    ArrowRight,
} from "lucide-react";
import { RouteCombobox } from "../routes/RouteCombobox";
import { useVehicleNumberPlate } from "@/hooks/useVehicleNumberPlate";
import { getFleetVehicleRequest } from "@/api/fleetApi";
import { cn } from "@/lib/utils";

// toISOString() is UTC: between midnight and 03:00 in Nairobi (UTC+3) it
// still reads as yesterday, which would quietly show the wrong day now that
// the list defaults to "today".
function toLocalDateString(d: Date): string {
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

function todayString(): string {
    return toLocalDateString(new Date());
}

function daysAgoString(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return toLocalDateString(d);
}

// Quick ranges; `days` is how far back from today the range starts.
const RANGE_PRESETS = [
    { label: "Today", days: 0 },
    { label: "7 days", days: 6 },
    { label: "30 days", days: 29 },
] as const;

function formatTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-KE", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDateTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-KE", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// travelDate is a bare "YYYY-MM-DD"; parsing it as local midnight keeps the
// weekday right (a UTC parse shifts it to the previous evening in Nairobi).
function formatTravelDate(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString("en-KE", {
        weekday: "short",
        day: "numeric",
        month: "short",
    });
}

// An M-Pesa booking whose hold has lapsed while still PENDING can no longer
// resolve: the reconcile ladder force-expires a payment three minutes after
// the STK push, so anything unpaid past holdExpiresAt is dead, not in flight.
// A null expiry on a PENDING M-Pesa row means the same thing — legacy rows
// predate the column and are treated as already lapsed.
function isHoldLapsed(booking: Booking): boolean {
    if (booking.paymentMethod !== "MPESA") return false;
    if (booking.paymentStatus !== "PENDING") return false;
    if (!booking.holdExpiresAt) return true;
    return new Date(booking.holdExpiresAt).getTime() < Date.now();
}

function statusBadge(status: BookingStatus) {
    switch (status) {
        case "CONFIRMED":
            return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Confirmed</Badge>;
        case "BOARDED":
            return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Boarded</Badge>;
        case "AWAITING_TRIP":
            return <Badge variant="secondary">Awaiting trip</Badge>;
        case "CANCELLED":
            return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Cancelled</Badge>;
        case "NO_SHOW":
            return <Badge variant="destructive">No-show</Badge>;
        default:
            return <Badge variant="outline">{status}</Badge>;
    }
}

function paymentStatusBadge(status: Booking["paymentStatus"]) {
    switch (status) {
        case "PAID":
            return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Paid</Badge>;
        case "PENDING":
            return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Pending</Badge>;
        case "FAILED":
            return <Badge variant="destructive">Failed</Badge>;
        case "REFUNDED":
            return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Refunded</Badge>;
        default:
            return <Badge variant="outline">{status}</Badge>;
    }
}


function BookingDetailDialog({
    booking,
    open,
    onOpenChange,
}: {
    booking: Booking | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    // Only worth checking payment detail for M-Pesa bookings — cash never
    // has a Payment row tied to it the same way.
    const paymentQuery = useQuery({
        queryKey: ["payment-for-booking", booking?.id],
        queryFn: () => getPaymentStatusForBookingRequest(booking!.id),
        enabled: !!booking && booking.paymentMethod === "MPESA",
    });

    // Only fetches once a trip/vehicle is actually assigned — no-ops for
    // AWAITING_TRIP bookings since booking.trip is null there.
    const { numberPlate, isLoading: plateLoading } = useVehicleNumberPlate(
        booking?.trip?.vehicleId,
    );

    if (!booking) return null;

    const payment = paymentQuery.data;
    const lapsed = isHoldLapsed(booking);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 flex-wrap">
                        {booking.route?.origin ?? "—"} → {booking.route?.destination ?? "—"}
                        {statusBadge(booking.status)}
                    </DialogTitle>
                    <DialogDescription>
                        #{booking.id.slice(0, 6).toUpperCase()} · {booking.route?.description}
                    </DialogDescription>
                </DialogHeader>

                {/* ── Passenger ── */}
                <div className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {booking.passengerName}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {booking.passengerPhone}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        {booking.travelDate}
                        {booking.seatNumber && ` · Seat ${booking.seatNumber}`}
                    </div>
                    {booking.preferredBoardingFrom && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            Preferred: {booking.preferredBoardingFrom}–{booking.preferredBoardingTo}
                        </div>
                    )}
                    {booking.trip && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Car className="h-3.5 w-3.5 shrink-0" />
                            {plateLoading ? (
                                <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" />
                            ) : (
                                numberPlate ?? "Unknown vehicle"
                            )}
                            {" · "}
                            {booking.trip.status}
                        </div>
                    )}
                </div>

                {/* ── Payment ── */}
                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground">Fare</span>
                        <span className="font-medium">KES {Number(booking.fare).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground">Method</span>
                        <span className="font-medium flex items-center gap-1.5">
                            {booking.paymentMethod === "MPESA" ? (
                                <Smartphone className="h-3.5 w-3.5" />
                            ) : (
                                <Banknote className="h-3.5 w-3.5" />
                            )}
                            {booking.paymentMethod === "MPESA" ? "M-Pesa" : "Cash"}
                        </span>
                    </div>
                    <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground">Payment status</span>
                        {paymentStatusBadge(booking.paymentStatus)}
                    </div>
                    {booking.mpesaReceiptNumber && (
                        <div className="flex items-center justify-between border-b pb-2">
                            <span className="text-muted-foreground">Receipt no.</span>
                            <span className="font-medium font-mono">{booking.mpesaReceiptNumber}</span>
                        </div>
                    )}
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Booked</span>
                        <span className="font-medium">{formatDateTime(booking.createdAt)}</span>
                    </div>
                </div>

                {/* ── M-Pesa payment state ── */}
                {booking.paymentMethod === "MPESA" && (
                    <>
                        {paymentQuery.isLoading && <Skeleton className="h-14 w-full" />}
                        {payment?.status === "FAILED" && payment.errorMessage && (
                            <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5 flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-destructive">Payment failed</p>
                                    <p className="text-xs text-destructive/80 mt-0.5">{payment.errorMessage}</p>
                                </div>
                            </div>
                        )}
                        {/* A PROCESSING payment past its hold isn't "in flight" — nothing
                            can resolve it any more, so saying "waiting" sends the clerk
                            off to wait for something that will never arrive. */}
                        {payment?.status === "PROCESSING" && !lapsed && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                                <p className="text-xs text-blue-700">
                                    STK push sent — waiting for the passenger to complete it.
                                </p>
                            </div>
                        )}
                        {lapsed && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-amber-800">
                                        Payment never completed
                                    </p>
                                    <p className="text-xs text-amber-700 mt-0.5">
                                        The hold lapsed{" "}
                                        {booking.holdExpiresAt
                                            ? `at ${formatDateTime(booking.holdExpiresAt)}`
                                            : "some time ago"}
                                        {" "}and seat {booking.seatNumber ?? "—"} has been released
                                        for re-sale. Take cash or re-send the STK push before
                                        letting this passenger board.
                                    </p>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}


// ─── Grouping ─────────────────────────────────────────────────────────────

// One card per trip. Every booking on a trip shares its route, date and
// vehicle, so those live in the card header once instead of on every row.
// Bookings not yet assigned a vehicle are grouped by route + travel date and
// flagged as awaiting a trip.
interface TripGroup {
    key: string;
    route: Booking["route"];
    travelDate: string;
    trip: NonNullable<Booking["trip"]> | null;
    bookings: Booking[];
    /** Newest booking in the group — drives the ordering of the cards. */
    latestCreatedAt: string;
}

function groupByTrip(bookings: Booking[]): TripGroup[] {
    const groups = new Map<string, TripGroup>();
    for (const b of bookings) {
        const key = b.trip?.id ?? `awaiting:${b.routeId}:${b.travelDate}`;
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                route: b.route,
                travelDate: b.travelDate,
                trip: b.trip ?? null,
                bookings: [],
                latestCreatedAt: b.createdAt,
            };
            groups.set(key, group);
        }
        group.bookings.push(b);
        if (b.createdAt > group.latestCreatedAt) group.latestCreatedAt = b.createdAt;
    }

    for (const group of groups.values()) {
        // Manifest order inside a card: by seat, unseated rows last.
        group.bookings.sort((a, b) => {
            if (a.seatNumber == null && b.seatNumber == null) return b.createdAt.localeCompare(a.createdAt);
            if (a.seatNumber == null) return 1;
            if (b.seatNumber == null) return -1;
            return a.seatNumber - b.seatNumber;
        });
    }

    // The trip a clerk just booked onto floats to the top.
    return [...groups.values()].sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
}

// Rows that actually hold a seat on the vehicle right now.
function holdsSeat(b: Booking): boolean {
    if (b.seatNumber == null) return false;
    if (b.status === "CANCELLED" || b.status === "NO_SHOW") return false;
    return !isHoldLapsed(b);
}

const COLLAPSED_ROWS = 6;

function PassengerRow({ booking, onSelect }: { booking: Booking; onSelect: (b: Booking) => void }) {
    const lapsed = isHoldLapsed(booking);
    const paid = booking.paymentStatus === "PAID";

    return (
        <button
            type="button"
            onClick={() => onSelect(booking)}
            className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                // CONFIRMED + unpaid looks identical to a real sale otherwise —
                // and this is the row that costs the sacco money.
                lapsed && "bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-500/10",
            )}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div
                    className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold",
                        lapsed
                            ? "bg-amber-500 text-white"
                            : booking.status === "BOARDED"
                                ? "bg-blue-100 text-blue-700"
                                : paid
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted text-foreground",
                    )}
                >
                    {booking.seatNumber != null ? String(booking.seatNumber).padStart(2, "0") : "—"}
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold">{booking.passengerName}</p>
                        {lapsed && (
                            <span className="shrink-0 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                LAPSED
                            </span>
                        )}
                    </div>
                    <p className={cn("truncate text-xs", lapsed ? "font-medium text-amber-700" : "text-muted-foreground")}>
                        {lapsed
                            ? `Hold lapsed ${formatTime(booking.holdExpiresAt)} · unpaid`
                            : `${booking.passengerPhone} • KES ${Number(booking.fare).toLocaleString()}`}
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                {booking.paymentMethod === "MPESA" ? (
                    <Smartphone className={cn("size-3.5", lapsed ? "text-amber-600" : "text-muted-foreground")} />
                ) : (
                    <Banknote className="size-3.5 text-muted-foreground" />
                )}
                {statusBadge(booking.status)}
            </div>
        </button>
    );
}

function TripCard({
    group,
    numberPlate,
    plateLoading,
    filtered,
    onSelect,
}: {
    group: TripGroup;
    numberPlate: string | undefined;
    plateLoading: boolean;
    /** A status filter or search is active, so seat counts don't describe the whole trip. */
    filtered: boolean;
    onSelect: (b: Booking) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    const seated = group.bookings.filter(holdsSeat).length;
    const capacity = group.trip?.vehicleCapacity;
    const paidTotal = group.bookings
        .filter((b) => b.paymentStatus === "PAID")
        .reduce((sum, b) => sum + Number(b.fare), 0);
    const lapsedCount = group.bookings.filter(isHoldLapsed).length;
    const full = !filtered && capacity != null && seated >= capacity;

    const rows = expanded ? group.bookings : group.bookings.slice(0, COLLAPSED_ROWS);
    const hidden = group.bookings.length - rows.length;

    return (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="space-y-1.5 border-b bg-muted/30 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-sm font-bold text-primary">
                            {formatTravelDate(group.travelDate)}
                        </span>
                        {group.trip ? (
                            plateLoading ? (
                                <span className="inline-block h-4 w-16 animate-pulse rounded bg-muted" />
                            ) : (
                                <span className="truncate rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] font-bold tracking-wide">
                                    {numberPlate ?? "Unknown vehicle"}
                                </span>
                            )
                        ) : (
                            <Badge variant="secondary" className="text-[10px]">Awaiting trip</Badge>
                        )}
                    </div>
                    <span
                        className={cn(
                            "shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold",
                            full
                                ? "bg-emerald-100 text-emerald-700"
                                : lapsedCount > 0
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-primary/10 text-primary",
                        )}
                    >
                        {filtered || capacity == null
                            ? `${group.bookings.length} shown`
                            : full
                                ? `${seated}/${capacity} FULL`
                                : `${seated}/${capacity} booked`}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-bold text-foreground">{group.route?.origin ?? "—"}</span>
                        <ArrowRight className="size-3.5 shrink-0" />
                        <span className="truncate font-bold text-foreground">{group.route?.destination ?? "—"}</span>
                        {group.trip && (
                            <span className="ml-1 hidden shrink-0 sm:inline">· {group.trip.status.toLowerCase()}</span>
                        )}
                    </div>
                    <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">
                        KES {paidTotal.toLocaleString()} paid
                    </span>
                </div>
            </div>

            <div className="divide-y">
                {rows.map((booking) => (
                    <PassengerRow key={booking.id} booking={booking} onSelect={onSelect} />
                ))}
            </div>

            {(hidden > 0 || expanded) && group.bookings.length > COLLAPSED_ROWS && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="flex w-full items-center justify-center gap-1 border-t bg-muted/20 py-2 text-xs font-semibold text-primary hover:bg-muted/40"
                >
                    {expanded ? "Show fewer" : `View all ${group.bookings.length} passengers`}
                    <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
                </button>
            )}
        </div>
    );
}

// ─── Main list ───────────────────────────────────────────────────────────
export default function BookingsList() {
    const { user } = useAuth();
    const isSuperAdmin = user?.role === "SUPER_ADMIN";

    const [saccoId, setSaccoId] = useState<string | undefined>(undefined);
    const [routeId, setRouteId] = useState<string | undefined>(undefined);
    const [vehicleId, setVehicleId] = useState<string | undefined>(undefined);
    // Today only by default — an active shuttle books enough in one day that a
    // week-long range buries what the clerk actually just did.
    const [from, setFrom] = useState(todayString());
    const [to, setTo] = useState(todayString());
    const [status, setStatus] = useState<BookingStatus | "ALL">("ALL");
    const [search, setSearch] = useState("");
    const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
    const [showFilters, setShowFilters] = useState(false);

    const bookingsQuery = useQuery({
        queryKey: ["bookings-report", saccoId, routeId, vehicleId, from, to, status],
        queryFn: () =>
            getBookingsRequest({
                saccoId: isSuperAdmin ? saccoId : undefined,
                routeId,
                vehicleId,
                from,
                to,
                status: status === "ALL" ? undefined : status,
            }),
        staleTime: 15 * 1000,
    });

    // Newest first: the booking a clerk needs is nearly always the one just
    // made. Sorted here rather than in the API because findAll() is shared
    // with the manifest, which wants its rows oldest-first.
    const bookings = useMemo(() => {
        const rows = [...(bookingsQuery.data ?? [])].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
        );
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (b) =>
                b.passengerName.toLowerCase().includes(q) ||
                b.passengerPhone.includes(q) ||
                b.id.slice(0, 6).toLowerCase().includes(q) ||
                (b.mpesaReceiptNumber?.toLowerCase().includes(q) ?? false),
        );
    }, [bookingsQuery.data, search]);

    const totalFare = bookings
        .filter((b) => b.paymentStatus === "PAID")
        .reduce((sum, b) => sum + Number(b.fare), 0);

    const groups = useMemo(() => groupByTrip(bookings), [bookings]);

    // One plate lookup per distinct vehicle, on the same query key as
    // useVehicleNumberPlate so the detail dialog reuses the cached answer.
    const vehicleIds = useMemo(
        () => [...new Set(groups.map((g) => g.trip?.vehicleId).filter((id): id is string => !!id))],
        [groups],
    );
    const vehicleQueries = useQueries({
        queries: vehicleIds.map((id) => ({
            queryKey: ["fleet", "vehicle", id],
            queryFn: () => getFleetVehicleRequest(id),
            staleTime: 5 * 60 * 1000,
            retry: 1,
        })),
    });
    const plates = new Map<string, { numberPlate?: string; isLoading: boolean }>();
    vehicleIds.forEach((id, i) => {
        plates.set(id, { numberPlate: vehicleQueries[i]?.data?.numberPlate, isLoading: vehicleQueries[i]?.isLoading ?? false });
    });
    const filtered = status !== "ALL" || search.trim().length > 0;

    // Drives the mobile filter-toggle badge — counts anything set away from
    // its "no filter" default. Date range is excluded since it always has
    // a value and isn't really an "active filter" in the same sense.
    const activeFilterCount = [
        isSuperAdmin && saccoId,
        routeId,
        vehicleId,
        status !== "ALL" ? status : null,
    ].filter(Boolean).length;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-semibold">Bookings</h2>

                <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2">
                        <div className="hidden sm:flex rounded-md bg-primary/10 p-1.5 shrink-0">
                            <ClipboardList className="size-3.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[9px] font-semibold text-primary/70 uppercase tracking-wide truncate">
                                Bookings
                            </p>
                            <p className="text-base font-bold leading-none mt-0.5">
                                {bookings.length}
                            </p>
                        </div>
                    </div>

                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
                        <div className="hidden sm:flex rounded-md bg-emerald-500/10 p-1.5 shrink-0">
                            <Banknote className="size-3.5 text-emerald-500" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide truncate">
                                Paid
                            </p>
                            <p className="text-base font-bold leading-none mt-0.5">
                                KES {totalFare.toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick ranges + search — the two things reached for most often, so
                they stay out of the collapsible filter drawer. */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex rounded-lg border border-border p-0.5">
                    {RANGE_PRESETS.map((preset) => {
                        const active = from === daysAgoString(preset.days) && to === todayString();
                        return (
                            <button
                                key={preset.label}
                                type="button"
                                onClick={() => {
                                    setFrom(daysAgoString(preset.days));
                                    setTo(todayString());
                                }}
                                className={cn(
                                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                                    active
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {preset.label}
                            </button>
                        );
                    })}
                </div>

                <div className="relative flex-1 min-w-[10rem]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Name, phone, receipt or #ID"
                        className="h-9 pl-8"
                    />
                </div>
            </div>

            {/* Mobile filter toggle — filters grid is always visible on sm+ */}
            <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="sm:hidden flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
                <SlidersHorizontal className="size-3.5" />
                Filters
                {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        {activeFilterCount}
                    </Badge>
                )}
                <ChevronDown className={cn("size-3.5 transition-transform", showFilters && "rotate-180")} />
            </button>

            <div
                className={cn(
                    "grid grid-cols-2 gap-2 sm:grid",
                    isSuperAdmin ? "sm:grid-cols-6" : "sm:grid-cols-5",
                    !showFilters && "hidden sm:grid"
                )}
            >
                {isSuperAdmin && (
                    <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Sacco</Label>
                        <SaccoCombobox value={saccoId} onChange={setSaccoId} placeholder="All saccos" />
                    </div>
                )}
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Route</Label>
                    <RouteCombobox value={routeId} onChange={setRouteId} placeholder="All routes" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Vehicle</Label>
                    <VehicleCombobox value={vehicleId} onChange={setVehicleId} saccoId={saccoId} placeholder="All vehicles" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input type="date" value={to} min={from} max={todayString()} onChange={(e) => setTo(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={status} onValueChange={(v) => setStatus(v as BookingStatus | "ALL")}>
                        <SelectTrigger className="h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All statuses</SelectItem>
                            <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                            <SelectItem value="BOARDED">Boarded</SelectItem>
                            <SelectItem value="AWAITING_TRIP">Awaiting trip</SelectItem>
                            <SelectItem value="CANCELLED">Cancelled</SelectItem>
                            <SelectItem value="NO_SHOW">No-show</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {bookingsQuery.isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : bookingsQuery.isError ? (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                    <p className="text-sm text-destructive">Couldn't load bookings. Please try again.</p>
                </div>
            ) : bookings.length === 0 ? (
                <div className="bg-muted/30 rounded-lg px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                        {search.trim()
                            ? `No booking matches "${search.trim()}" in this range.`
                            : "No bookings in this range."}
                    </p>
                </div>
            ) : (
                <>
                    {/* A one-day range is a single bar — not worth the space. */}
                    {from !== to && <BookingsCharts bookings={bookings} />}
                    <div className="space-y-3">
                        {groups.map((group) => {
                            const plate = group.trip ? plates.get(group.trip.vehicleId) : undefined;
                            return (
                                <TripCard
                                    key={group.key}
                                    group={group}
                                    numberPlate={plate?.numberPlate}
                                    plateLoading={plate?.isLoading ?? false}
                                    filtered={filtered}
                                    onSelect={setSelectedBooking}
                                />
                            );
                        })}
                    </div>
                </>
            )}

            <BookingDetailDialog
                booking={selectedBooking}
                open={!!selectedBooking}
                onOpenChange={(open) => !open && setSelectedBooking(null)}
            />
        </div>
    );
}