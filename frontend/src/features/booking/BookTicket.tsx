// src/components/BookTicket.tsx
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    getAvailableLocationsRequest,
    searchRoutesRequest,
    type RouteSearchResult,
} from "../../api/routeApi";
import {
    createBookingRequest,
    getBookingAvailabilityRequest,
    PaymentMethod,
    type Booking,
    type BookingAvailability,
} from "../../api/bookingApi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle2, Smartphone, Banknote, Bus } from "lucide-react";

function todayString(): string {
    return new Date().toISOString().slice(0, 10);
}

function passengerMessage(booking: Booking): string {
    if (booking.status === "CANCELLED") return "This booking was cancelled.";
    if (booking.paymentStatus !== "PAID") {
        return booking.paymentMethod === "MPESA"
            ? "Almost there — complete the M-Pesa prompt on your phone to confirm your seat."
            : "Booked — pay the conductor in cash to confirm your seat.";
    }
    if (booking.status === "CONFIRMED" && booking.seatNumber) {
        return `You're confirmed — seat ${booking.seatNumber}. We'll text you when the shuttle is ready to board.`;
    }
    return "Payment received. You're on the list — we'll seat you as soon as the next shuttle starts boarding.";
}

type Step = "search" | "details" | "confirmed";

export default function BookTicket() {
    const [origin, setOrigin] = useState("");
    const [destination, setDestination] = useState("");
    const [travelDate, setTravelDate] = useState(todayString());
    const [selectedRoute, setSelectedRoute] = useState<RouteSearchResult | null>(null);
    const [passengerName, setPassengerName] = useState("");
    const [passengerPhone, setPassengerPhone] = useState("");
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.MPESA);
    const [step, setStep] = useState<Step>("search");
    const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);

    const queryClient = useQueryClient();

    const locationsQuery = useQuery({
        queryKey: ["route-locations"],
        queryFn: getAvailableLocationsRequest,
        staleTime: 5 * 60 * 1000,
    });

    const searchQuery = useQuery({
        queryKey: ["route-search", origin, destination],
        queryFn: () => searchRoutesRequest(origin, destination),
        enabled: !!origin && !!destination,
        staleTime: 60 * 1000,
    });

    const searchResults = searchQuery.data ?? [];

    // If exactly one sacco services this origin/destination, skip the
    // picker and go straight to it — friction only shows up when there's
    // an actual choice to make.
    useEffect(() => {
        if (searchQuery.isSuccess && searchResults.length === 1 && !selectedRoute) {
            setSelectedRoute(searchResults[0]);
            setStep("details");
        }
    }, [searchQuery.isSuccess, searchResults, selectedRoute]);

    const availabilityQuery = useQuery({
        queryKey: ["booking-availability", selectedRoute?.routeId, travelDate],
        queryFn: () => getBookingAvailabilityRequest(selectedRoute!.routeId, travelDate),
        enabled: !!selectedRoute,
        // Availability can change fast when a shuttle is close to full —
        // keep it fresh rather than relying on cache.
        staleTime: 15 * 1000,
        refetchInterval: step === "details" ? 15 * 1000 : false,
    });

    const bookingMutation = useMutation({
        mutationFn: createBookingRequest,
        onSuccess: (booking) => {
            setConfirmedBooking(booking);
            setStep("confirmed");
            queryClient.invalidateQueries({
                queryKey: ["booking-availability", selectedRoute?.routeId, travelDate],
            });
        },
    });

    const availability = availabilityQuery.data;
    const shuttleFull = availability?.hasOpenTrip && availability.seatsAvailable === 0;

    function chooseRoute(route: RouteSearchResult) {
        setSelectedRoute(route);
        setStep("details");
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedRoute || !passengerName.trim() || !passengerPhone.trim()) return;

        bookingMutation.mutate({
            routeId: selectedRoute.routeId,
            travelDate,
            passengerName: passengerName.trim(),
            passengerPhone: passengerPhone.trim(),
            paymentMethod,
        });
    }

    function startOver() {
        setStep("search");
        setConfirmedBooking(null);
        setSelectedRoute(null);
        setOrigin("");
        setDestination("");
        setPassengerName("");
        setPassengerPhone("");
        bookingMutation.reset();
    }

    function backToSearch() {
        setStep("search");
        setSelectedRoute(null);
    }

    // ─── Confirmed screen ───────────────────────────────────────────────
    if (step === "confirmed" && confirmedBooking && selectedRoute) {
        return (
            <Card className="mx-auto w-full max-w-md">
                <CardHeader>
                    <Badge className="mb-2 w-fit bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        Booking received
                    </Badge>
                    <CardTitle>
                        {selectedRoute.origin} → {selectedRoute.destination}
                    </CardTitle>
                    <CardDescription>
                        {selectedRoute.saccoName} · {travelDate}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-lg border bg-muted/40 p-4">
                        <p className="mb-3 text-sm leading-relaxed">
                            {passengerMessage(confirmedBooking)}
                        </p>
                        <dl className="space-y-1.5 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Passenger</dt>
                                <dd className="font-medium">{confirmedBooking.passengerName}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Phone</dt>
                                <dd className="font-medium">{confirmedBooking.passengerPhone}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Fare</dt>
                                <dd className="font-medium">KES {confirmedBooking.fare}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Booking ref</dt>
                                <dd className="font-mono font-medium tracking-wide">
                                    {confirmedBooking.id.slice(0, 8).toUpperCase()}
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <Button variant="outline" className="w-full" onClick={startOver}>
                        Book another seat
                    </Button>
                </CardContent>
            </Card>
        );
    }

    // ─── Passenger details step ──────────────────────────────────────────
    if (step === "details" && selectedRoute) {
        return (
            <Card className="mx-auto w-full max-w-md">
                <CardHeader>
                    <button
                        onClick={backToSearch}
                        className="mb-1 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Change route or date
                    </button>
                    <CardTitle>
                        {selectedRoute.origin} → {selectedRoute.destination}
                    </CardTitle>
                    <CardDescription>
                        {selectedRoute.saccoName} · {travelDate} · KES {selectedRoute.fare}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <AvailabilityNote
                        loading={availabilityQuery.isLoading}
                        availability={availability}
                    />

                    <form onSubmit={handleSubmit} className="space-y-4 mt-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="passengerName">Full name</Label>
                            <Input
                                id="passengerName"
                                value={passengerName}
                                onChange={(e) => setPassengerName(e.target.value)}
                                placeholder="e.g. Jane Wanjiru"
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="passengerPhone">Phone number</Label>
                            <Input
                                id="passengerPhone"
                                type="tel"
                                value={passengerPhone}
                                onChange={(e) => setPassengerPhone(e.target.value)}
                                placeholder="07XX XXX XXX"
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Pay with</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <PayOption
                                    label="M-Pesa"
                                    icon={<Smartphone className="h-4 w-4" />}
                                    active={paymentMethod === PaymentMethod.MPESA}
                                    onClick={() => setPaymentMethod(PaymentMethod.MPESA)}
                                />
                                <PayOption
                                    label="Cash"
                                    icon={<Banknote className="h-4 w-4" />}
                                    active={paymentMethod === PaymentMethod.CASH}
                                    onClick={() => setPaymentMethod(PaymentMethod.CASH)}
                                />
                            </div>
                        </div>

                        {bookingMutation.isError && (
                            <p className="text-sm text-destructive">
                                {(bookingMutation.error as any)?.response?.data?.message ??
                                    "Booking failed. Please try again."}
                            </p>
                        )}

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={bookingMutation.isPending || shuttleFull}
                        >
                            {bookingMutation.isPending
                                ? "Booking..."
                                : paymentMethod === PaymentMethod.MPESA
                                    ? "Book & pay with M-Pesa"
                                    : "Book seat — pay in cash"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        );
    }

    // ─── Search step: origin/destination, then sacco choice if needed ──────
    const origins = locationsQuery.data?.origins ?? [];
    const destinations = locationsQuery.data?.destinations ?? [];
    const hasSearched = !!origin && !!destination;

    return (
        <Card className="mx-auto w-full max-w-md">
            <CardHeader>
                <CardTitle>Book your seat</CardTitle>
                <CardDescription>No account needed — just your name and phone.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {locationsQuery.isLoading && (
                    <div className="space-y-2">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                    </div>
                )}

                {locationsQuery.isError && (
                    <p className="text-sm text-destructive">
                        Couldn't load routes. Check your connection and try again.
                    </p>
                )}

                {locationsQuery.isSuccess && (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1.5">
                                <Label>From</Label>
                                <Select
                                    value={origin}
                                    onValueChange={(value) => {
                                        setOrigin(value ?? "");
                                        setSelectedRoute(null);
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Origin" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {origins.map((o) => (
                                            <SelectItem key={o} value={o}>
                                                {o}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1.5">
                                <Label>To</Label>
                                <Select
                                    value={destination}
                                    onValueChange={(value) => {
                                        setDestination(value ?? "");
                                        setSelectedRoute(null);
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Destination" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {destinations
                                            .filter((d) => d !== origin)
                                            .map((d) => (
                                                <SelectItem key={d} value={d}>
                                                    {d}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="travelDate">Travel date</Label>
                            <Input
                                id="travelDate"
                                type="date"
                                value={travelDate}
                                min={todayString()}
                                onChange={(e) => setTravelDate(e.target.value)}
                            />
                        </div>

                        {hasSearched && searchQuery.isLoading && (
                            <div className="space-y-2">
                                <Skeleton className="h-14 w-full" />
                                <Skeleton className="h-14 w-full" />
                            </div>
                        )}

                        {hasSearched && searchQuery.isError && (
                            <p className="text-sm text-destructive">
                                Couldn't search routes. Check your connection and try again.
                            </p>
                        )}

                        {hasSearched && searchQuery.isSuccess && searchResults.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                                No SACCOs currently run {origin} → {destination}.
                            </p>
                        )}

                        {/* Only rendered when there's a genuine choice — a single
                            result auto-advances to details via the effect above. */}
                        {hasSearched && searchResults.length > 1 && (
                            <div className="space-y-2">
                                <Label>Choose a SACCO</Label>
                                {searchResults.map((route) => (
                                    <button
                                        key={route.routeId}
                                        onClick={() => chooseRoute(route)}
                                        className="flex w-full items-center justify-between rounded-md border border-input px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            <Bus className="h-4 w-4 text-muted-foreground" />
                                            {route.saccoName}
                                        </span>
                                        <span className="text-muted-foreground">KES {route.fare}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Small sub-components ────────────────────────────────────────────────

function AvailabilityNote({
    availability,
    loading,
}: {
    availability: BookingAvailability | undefined;
    loading: boolean;
}) {
    if (loading) return <Skeleton className="h-6 w-2/3" />;
    if (!availability) return null;

    if (!availability.hasOpenTrip) {
        return (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                No shuttle boarding yet — you'll be booked for the next one to fill up
                {availability.awaitingTripCount > 0
                    ? ` (${availability.awaitingTripCount} passenger${availability.awaitingTripCount === 1 ? "" : "s"} already waiting).`
                    : "."}
            </p>
        );
    }

    if (availability.seatsAvailable === 0) {
        return (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This shuttle is full. You'll be booked on the next one.
            </p>
        );
    }

    return (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {availability.seatsAvailable} of {availability.seatsTotal} seats left on the boarding shuttle.
        </p>
    );
}

function PayOption({
    label,
    icon,
    active,
    onClick,
}: {
    label: string;
    icon: React.ReactNode;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-foreground hover:bg-accent"
                }`}
        >
            {icon}
            {label}
        </button>
    );
}