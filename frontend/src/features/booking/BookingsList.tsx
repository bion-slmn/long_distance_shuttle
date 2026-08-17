// src/features/booking/BookingsList.tsx
import { useState } from "react";
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
} from "lucide-react";
import { RouteCombobox } from "../routes/RouteCombobox";
import { useVehicleNumberPlate } from "@/hooks/useVehicleNumberPlate";

function todayString(): string {
    return new Date().toISOString().slice(0, 10);
}

function daysAgoString(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
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

                {/* ── M-Pesa failure reason, if any ── */}
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
                        {payment?.status === "PROCESSING" && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                                <p className="text-xs text-blue-700">
                                    STK push sent — waiting for the passenger to complete it.
                                </p>
                            </div>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}


function BookingCard({ booking, onSelect }: { booking: Booking; onSelect: (b: Booking) => void }) {
    return (
        <button
            onClick={() => onSelect(booking)}
            className="w-full rounded-lg border border-border p-3 text-left transition-all hover:border-primary hover:bg-primary/5 active:scale-[0.98]"
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
                {statusBadge(booking.status)}
                {booking.paymentMethod === "MPESA" ? (
                    <Badge variant="outline" className="text-[10px] gap-1 px-1.5">
                        <Smartphone className="h-2.5 w-2.5" />
                        {booking.paymentStatus}
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
    const [from, setFrom] = useState(daysAgoString(7));
    const [to, setTo] = useState(todayString());
    const [status, setStatus] = useState<BookingStatus | "ALL">("ALL");
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

    const bookings = bookingsQuery.data ?? [];

    const totalFare = bookings
        .filter((b) => b.paymentStatus === "PAID")
        .reduce((sum, b) => sum + Number(b.fare), 0);

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">Bookings</h2>
                <p className="text-sm text-muted-foreground">
                    {bookings.length} booking{bookings.length === 1 ? "" : "s"} · KES {totalFare.toLocaleString()} paid
                </p>
            </div>

            <div className={`grid grid-cols-2 gap-2 ${isSuperAdmin ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
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
                    <p className="text-sm text-muted-foreground">No bookings in this range.</p>
                </div>
            ) : (
                <>
                    <BookingsCharts bookings={bookings} />
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