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
    Car,
    ClipboardList,
    ChevronRight,
    ArrowRight,
} from "lucide-react";
import { RouteCombobox } from "../routes/RouteCombobox";
import { useVehicleNumberPlate } from "@/hooks/useVehicleNumberPlate";
import { getFleetVehicleRequest } from "@/api/fleetApi";
import { StatTile } from "@/components/report/StatTile";
import {
    DateRangeFields,
    FilterField,
    FilterPanel,
    RangePresets,
    SearchInput,
} from "@/components/report/Filters";
import { ListPlaceholder } from "@/components/report/ListPlaceholder";
import { Callout, DetailRow, DetailRows, InfoBlock, InfoLine } from "@/components/report/Detail";
import { formatDateTime, formatDay, formatTime, todayString } from "@/lib/dateRange";
import { cn } from "@/lib/utils";

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
                <InfoBlock>
                    <InfoLine icon={User} primary>{booking.passengerName}</InfoLine>
                    <InfoLine icon={Phone}>{booking.passengerPhone}</InfoLine>
                    <InfoLine icon={Calendar}>
                        {booking.travelDate}
                        {booking.seatNumber && ` · Seat ${booking.seatNumber}`}
                    </InfoLine>
                    {booking.preferredBoardingFrom && (
                        <InfoLine icon={Clock}>
                            Preferred: {booking.preferredBoardingFrom}–{booking.preferredBoardingTo}
                        </InfoLine>
                    )}
                    {booking.trip && (
                        <InfoLine icon={Car}>
                            {plateLoading ? (
                                <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" />
                            ) : (
                                numberPlate ?? "Unknown vehicle"
                            )}
                            {" · "}
                            {booking.trip.status}
                        </InfoLine>
                    )}
                </InfoBlock>

                {/* ── Payment ── */}
                <DetailRows>
                    <DetailRow label="Fare">KES {Number(booking.fare).toLocaleString()}</DetailRow>
                    <DetailRow label="Method">
                        {booking.paymentMethod === "MPESA" ? (
                            <Smartphone className="h-3.5 w-3.5" />
                        ) : (
                            <Banknote className="h-3.5 w-3.5" />
                        )}
                        {booking.paymentMethod === "MPESA" ? "M-Pesa" : "Cash"}
                    </DetailRow>
                    <DetailRow label="Payment status">{paymentStatusBadge(booking.paymentStatus)}</DetailRow>
                    {booking.mpesaReceiptNumber && (
                        <DetailRow label="Receipt no." mono>{booking.mpesaReceiptNumber}</DetailRow>
                    )}
                    <DetailRow label="Booked">{formatDateTime(booking.createdAt)}</DetailRow>
                </DetailRows>

                {/* ── M-Pesa payment state ── */}
                {booking.paymentMethod === "MPESA" && (
                    <>
                        {paymentQuery.isLoading && <Skeleton className="h-14 w-full" />}
                        {payment?.status === "FAILED" && payment.errorMessage && (
                            <Callout tone="destructive" title="Payment failed">
                                {payment.errorMessage}
                            </Callout>
                        )}
                        {/* A PROCESSING payment past its hold isn't "in flight" — nothing
                            can resolve it any more, so saying "waiting" sends the clerk
                            off to wait for something that will never arrive. */}
                        {payment?.status === "PROCESSING" && !lapsed && (
                            <Callout tone="blue">
                                STK push sent — waiting for the passenger to complete it.
                            </Callout>
                        )}
                        {lapsed && (
                            <Callout tone="amber" title="Payment never completed">
                                The hold lapsed{" "}
                                {booking.holdExpiresAt
                                    ? `at ${formatDateTime(booking.holdExpiresAt)}`
                                    : "some time ago"}
                                {" "}and seat {booking.seatNumber ?? "—"} has been released
                                for re-sale. Take cash or re-send the STK push before
                                letting this passenger board.
                            </Callout>
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
                            {formatDay(group.travelDate)}
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
                    <StatTile icon={ClipboardList} label="Bookings" value={bookings.length} />
                    <StatTile icon={Banknote} label="Paid" value={`KES ${totalFare.toLocaleString()}`} tone="emerald" />
                </div>
            </div>

            {/* Quick ranges + search — the two things reached for most often, so
                they stay out of the collapsible filter drawer. */}
            <div className="flex items-center gap-2 flex-wrap">
                <RangePresets
                    from={from}
                    to={to}
                    onChange={(f, t) => {
                        setFrom(f);
                        setTo(t);
                    }}
                />
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Name, phone, receipt or #ID"
                />
            </div>

            <FilterPanel activeCount={activeFilterCount} columns={isSuperAdmin ? 6 : 5}>
                {isSuperAdmin && (
                    <FilterField label="Sacco">
                        <SaccoCombobox value={saccoId} onChange={setSaccoId} placeholder="All saccos" />
                    </FilterField>
                )}
                <FilterField label="Route">
                    <RouteCombobox value={routeId} onChange={setRouteId} placeholder="All routes" />
                </FilterField>
                <FilterField label="Vehicle">
                    <VehicleCombobox value={vehicleId} onChange={setVehicleId} saccoId={saccoId} placeholder="All vehicles" />
                </FilterField>
                <DateRangeFields from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
                <FilterField label="Status">
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
                </FilterField>
            </FilterPanel>

            {bookingsQuery.isLoading ? (
                <ListPlaceholder state="loading" />
            ) : bookingsQuery.isError ? (
                <ListPlaceholder state="error" message="Couldn't load bookings. Please try again." />
            ) : bookings.length === 0 ? (
                <ListPlaceholder
                    state="empty"
                    message={
                        search.trim()
                            ? `No booking matches "${search.trim()}" in this range.`
                            : "No bookings in this range."
                    }
                />
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
