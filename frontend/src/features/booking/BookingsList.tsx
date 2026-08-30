// src/features/booking/BookingsList.tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
    Bus,
    Smartphone,
    Banknote,
    MapPin,
    Calendar,
    User,
    Phone,
    Clock,
    AlertCircle,
    Car,
    ClipboardList,
    SlidersHorizontal,
    ChevronDown,
    Search,
} from "lucide-react";
import { RouteCombobox } from "../routes/RouteCombobox";
import { useVehicleNumberPlate } from "@/hooks/useVehicleNumberPlate";
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


function BookingCard({ booking, onSelect }: { booking: Booking; onSelect: (b: Booking) => void }) {
    const lapsed = isHoldLapsed(booking);

    return (
        <button
            onClick={() => onSelect(booking)}
            className={cn(
                "w-full rounded-lg border p-3 text-left transition-all hover:border-primary hover:bg-primary/5 active:scale-[0.98]",
                // CONFIRMED + unpaid looks identical to a real sale otherwise —
                // and this is the row that costs the sacco money.
                lapsed ? "border-amber-400 bg-amber-50/50" : "border-border",
            )}
        >
            {/* ── Top row: route + amount, always side by side ── */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Bus className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <p className="text-sm font-medium truncate">
                        {booking.route ? `${booking.route.origin} → ${booking.route.destination}` : "—"}
                    </p>
                </div>
                <p className="text-sm font-semibold shrink-0">
                    KES {Number(booking.fare).toLocaleString()}
                </p>
            </div>

            {/* ── Middle row: passenger name only (phone moved to dialog) ── */}
            <p className="text-xs text-muted-foreground mt-1.5 truncate pl-10">
                {booking.passengerName}
            </p>

            {/* ── Bottom row: date + badges, wraps freely on narrow screens ── */}
            <div className="flex items-center gap-1.5 mt-2 pl-10 flex-wrap">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {booking.travelDate}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTime(booking.createdAt)}
                </span>
                {statusBadge(booking.status)}
                {booking.paymentMethod === "MPESA" ? (
                    <Badge
                        variant="outline"
                        className={cn(
                            "text-[10px] gap-1 px-1.5",
                            lapsed && "border-amber-400 bg-amber-100 text-amber-800",
                        )}
                    >
                        <Smartphone className="h-2.5 w-2.5" />
                        {lapsed ? "UNPAID" : booking.paymentStatus}
                    </Badge>
                ) : (
                    <Badge variant="outline" className="text-[10px] gap-1 px-1.5">
                        <Banknote className="h-2.5 w-2.5" />
                        Cash
                    </Badge>
                )}
            </div>
        </button>
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
                    <div className="space-y-2">
                        {bookings.map((booking) => (
                            <BookingCard key={booking.id} booking={booking} onSelect={setSelectedBooking} />
                        ))}
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