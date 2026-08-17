// src/components/BookTicket.tsx
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
    getAvailableLocationsRequest,
    searchRoutesRequest,
    type RouteSearchResult,
} from "../../api/routeApi";
import {
    createBookingRequest,
    getBookingAvailabilityRequest,
    getBookingRequest,
    getBookingStatusRequest,
    PaymentMethod,
    type Booking,
} from "../../api/bookingApi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
    ArrowLeft,
    CheckCircle2,
    Smartphone,
    Banknote,
    Bus,
    Clock,
    Users,
    ChevronRight,
    Calendar,
    MapPin,
} from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { getPaymentStatusForBookingRequest, reconcilePaymentRequest } from "@/api/paymentApi";

function todayString(): string {
    return new Date().toISOString().slice(0, 10);
}

function passengerMessage(booking: Booking): string {
    if (booking.status === "CANCELLED") return "This booking was cancelled.";
    if (booking.paymentStatus !== "PAID") {
        return booking.paymentMethod === "MPESA"
            ? "Complete the M-Pesa prompt on your phone to confirm your seat."
            : "Pay the conductor in cash to confirm your seat.";
    }
    if (booking.status === "CONFIRMED" && booking.seatNumber) {
        return `Seat ${booking.seatNumber} confirmed. We'll text you when boarding starts.`;
    }
    return "Payment received. You're on the list — we'll seat you when the shuttle boards.";
}

type Step = "search" | "details" | "confirmed";

// ─── Zod schema — mirrors CreateBookingDto ─────────────────────────────
const bookingFormSchema = z
    .object({
        passengerName: z
            .string()
            .trim()
            .min(1, "Passenger name is required."),
        passengerPhone: z
            .string()
            .regex(
                /^(?:\+254|0)(7|1)\d{8}$/,
                "Enter a valid Kenyan phone number (e.g. 0712345678)."
            ),
        paymentMethod: z.nativeEnum(PaymentMethod),
        preferredBoardingFrom: z
            .string()
            .regex(
                /^([01]\d|2[0-3]):[0-5]\d$/,
                "Enter a valid time (e.g. 08:00)."
            )
            .optional()
            .or(z.literal("")),
        preferredBoardingTo: z
            .string()
            .regex(
                /^([01]\d|2[0-3]):[0-5]\d$/,
                "Enter a valid time (e.g. 17:30)."
            )
            .optional()
            .or(z.literal("")),
    })
    .refine(
        (data) =>
            !data.preferredBoardingFrom ||
            !data.preferredBoardingTo ||
            data.preferredBoardingFrom < data.preferredBoardingTo,
        {
            message: '"From" must be earlier than "To".',
            path: ["preferredBoardingTo"],
        }
    );

type BookingFormValues = z.infer<typeof bookingFormSchema>;

// ─── Progress Indicator ────────────────────────────────────────────────
function StepProgress({ currentStep }: { currentStep: Step }) {
    const steps = [
        { key: "search", label: "Route" },
        { key: "details", label: "Details" },
        { key: "confirmed", label: "Done" },
    ];

    const currentIndex = steps.findIndex((s) => s.key === currentStep);

    return (
        <div className="flex items-center gap-2 px-1 py-3">
            {steps.map((step, index) => (
                <div key={step.key} className="flex items-center gap-2 flex-1">
                    <div className="flex items-center gap-2">
                        <div
                            className={`
                            w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all
                            ${index <= currentIndex
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground"}
                        `}
                        >
                            {index + 1}
                        </div>
                        <span
                            className={`
                            text-xs font-medium hidden sm:block
                            ${index <= currentIndex ? "text-foreground" : "text-muted-foreground"}
                        `}
                        >
                            {step.label}
                        </span>
                    </div>
                    {index < steps.length - 1 && (
                        <div
                            className={`
                            flex-1 h-[2px] transition-all
                            ${index < currentIndex ? "bg-primary" : "bg-muted"}
                        `}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function BookTicket() {
    const [origin, setOrigin] = useState("");
    const [destination, setDestination] = useState("");
    const [travelDate, setTravelDate] = useState(todayString());
    const [selectedRoute, setSelectedRoute] = useState<RouteSearchResult | null>(null);
    const [step, setStep] = useState<Step>("search");
    const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);
    const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);

    const queryClient = useQueryClient();

    const {
        control,
        register,
        handleSubmit,
        watch,
        reset,
        formState: { errors, isValid },
    } = useForm<BookingFormValues>({
        resolver: zodResolver(bookingFormSchema),
        mode: "onChange",
        defaultValues: {
            passengerName: "",
            passengerPhone: "",
            paymentMethod: PaymentMethod.MPESA,
            preferredBoardingFrom: "",
            preferredBoardingTo: "",
        },
    });

    const paymentMethod = watch("paymentMethod");

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

    // ── Track when polling actually started ────────────────────────────
    const isAwaitingMpesa =
        confirmedBooking?.paymentMethod === PaymentMethod.MPESA &&
        confirmedBooking?.paymentStatus === "PENDING";

    // ── Poll payment status first ──────────────────────────────────────
    const paymentStatusQuery = useQuery({
        queryKey: ["payment-status", confirmedBooking?.id],
        queryFn: () => getPaymentStatusForBookingRequest(confirmedBooking!.id),
        enabled: isAwaitingMpesa,
        refetchIntervalInBackground: true,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            if (status && status !== "PENDING" && status !== "PROCESSING") return false;
            if (pollStartedAt === null) return 3000;
            const elapsed = Date.now() - pollStartedAt;
            if (elapsed > 180_000) return false;
            return 3000;
        },
    });

    const paymentResult = paymentStatusQuery.data;
    const paymentSucceeded = paymentResult?.status === "SUCCESS";
    const paymentFailed =
        paymentResult?.status === "FAILED" || paymentResult?.status === "EXPIRED";

    const paymentTimedOut =
        isAwaitingMpesa &&
        pollStartedAt !== null &&
        !paymentSucceeded &&
        !paymentFailed &&
        Date.now() - pollStartedAt > 180_000 &&
        !paymentStatusQuery.isFetching;

    // ── Reconcile mutation ──────────────────────────────────────────────
    const reconcileMutation = useMutation({
        mutationFn: () => reconcilePaymentRequest(confirmedBooking!.id),
        onSuccess: (result) => {
            queryClient.setQueryData(["payment-status", confirmedBooking?.id], result);
        },
    });

    useEffect(() => {
        if (
            isAwaitingMpesa &&
            pollStartedAt !== null &&
            Date.now() - pollStartedAt > 175_000 &&
            !paymentSucceeded &&
            !paymentFailed &&
            !reconcileMutation.isPending &&
            !reconcileMutation.isSuccess
        ) {
            reconcileMutation.mutate();
        }
    }, [isAwaitingMpesa, pollStartedAt, paymentSucceeded, paymentFailed]);

    // ── Once payment succeeds, do a single follow-up fetch ──────────────
    const bookingRefetchQuery = useQuery({
        queryKey: ["booking-final", confirmedBooking?.id],
        queryFn: () => getBookingStatusRequest(confirmedBooking!.id),
        enabled: paymentSucceeded && confirmedBooking?.paymentStatus !== "PAID",
    });

    useEffect(() => {
        if (bookingRefetchQuery.data) {
            setConfirmedBooking((prev) =>
                prev ? { ...prev, ...bookingRefetchQuery.data } : prev,
            );
        }
    }, [bookingRefetchQuery.data]);

    const searchResults = searchQuery.data ?? [];

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
        staleTime: 15 * 1000,
        refetchInterval: step === "details" ? 15 * 1000 : false,
    });

    const bookingMutation = useMutation({
        mutationFn: createBookingRequest,
        onSuccess: (booking) => {
            setConfirmedBooking(booking);
            setStep("confirmed");
            setPollStartedAt(Date.now());
            queryClient.invalidateQueries({
                queryKey: ["booking-availability", selectedRoute?.routeId, travelDate],
            });
        },
    });

    const availability = availabilityQuery.data;

    function chooseRoute(route: RouteSearchResult) {
        setSelectedRoute(route);
        setStep("details");
    }

    const onSubmit = (values: BookingFormValues) => {
        if (!selectedRoute) return;

        bookingMutation.mutate({
            routeId: selectedRoute.routeId,
            travelDate,
            passengerName: values.passengerName.trim(),
            passengerPhone: values.passengerPhone.trim(),
            paymentMethod: values.paymentMethod,
            preferredBoardingFrom: values.preferredBoardingFrom || undefined,
            preferredBoardingTo: values.preferredBoardingTo || undefined,
        });
    };

    function startOver() {
        setStep("search");
        setConfirmedBooking(null);
        setSelectedRoute(null);
        setOrigin("");
        setDestination("");
        reset();
        bookingMutation.reset();
        setPollStartedAt(null);
    }

    function backToSearch() {
        setStep("search");
        setSelectedRoute(null);
    }

    // ─── Confirmed Screen ──────────────────────────────────────────────
    if (step === "confirmed" && confirmedBooking && selectedRoute) {
        const isPaid = confirmedBooking.paymentStatus === "PAID" || paymentSucceeded;
        const isFailed = confirmedBooking.paymentStatus === "FAILED" || paymentFailed;

        return (
            <div className="mx-auto w-full max-w-md px-4 py-6">
                <StepProgress currentStep="confirmed" />

                <div className="mt-6 text-center">
                    {isPaid ? (
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 mb-4">
                            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                        </div>
                    ) : isFailed || paymentTimedOut ? (
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 mb-4">
                            <Smartphone className="h-8 w-8 text-red-500" />
                        </div>
                    ) : (
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/5 mb-4">
                            <span className="animate-spin text-2xl">⟳</span>
                        </div>
                    )}

                    <h2 className="text-xl font-semibold">
                        {isPaid
                            ? "Booking Confirmed!"
                            : isFailed || paymentTimedOut
                                ? "Payment didn't go through"
                                : "Waiting for M-Pesa..."}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        {selectedRoute.saccoName} · {travelDate}
                    </p>
                </div>

                <div className="mt-6 space-y-3">
                    <div className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">
                                {selectedRoute.origin} → {selectedRoute.destination}
                            </span>
                        </div>
                        <Badge variant="secondary" className="font-mono">
                            #{confirmedBooking.id.slice(0, 6).toUpperCase()}
                        </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-muted/30 rounded-lg px-4 py-3">
                            <p className="text-xs text-muted-foreground">Passenger</p>
                            <p className="text-sm font-medium truncate">{confirmedBooking.passengerName}</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg px-4 py-3">
                            <p className="text-xs text-muted-foreground">Phone</p>
                            <p className="text-sm font-medium">{confirmedBooking.passengerPhone}</p>
                        </div>
                    </div>

                    <div className="bg-muted/30 rounded-lg px-4 py-3 flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                            {isPaid ? "Fare paid" : "Fare"}
                        </span>
                        <span className="text-lg font-semibold">KES {confirmedBooking.fare}</span>
                    </div>

                    <div className="bg-primary/5 rounded-lg px-4 py-3 border border-primary/10">
                        <p className="text-sm text-center leading-relaxed">
                            {isFailed
                                ? paymentResult?.errorMessage ??
                                "The M-Pesa payment failed. You can try again."
                                : paymentTimedOut
                                    ? "The M-Pesa prompt wasn't completed in time. You can try again."
                                    : passengerMessage(confirmedBooking)}
                        </p>
                    </div>

                    {(isFailed || paymentTimedOut) && (
                        <Button
                            className="w-full mt-2"
                            onClick={() => {
                                setConfirmedBooking(null);
                                setStep("details");
                                setPollStartedAt(null);
                            }}
                        >
                            Try again
                        </Button>
                    )}

                    <Button variant="outline" className="w-full mt-2" onClick={startOver}>
                        Book another seat
                    </Button>
                </div>
            </div>
        );
    }

    // ─── Passenger Details Step ────────────────────────────────────────
    if (step === "details" && selectedRoute) {
        const hasAvailability = availability && availability.hasOpenTrip;
        const seatsLeft = availability?.seatsAvailable ?? 0;
        const isFull = hasAvailability && seatsLeft === 0;
        const isWaitingList = !hasAvailability && availability?.awaitingTripCount !== undefined;

        return (
            <div className="mx-auto w-full max-w-md px-4 py-6">
                <StepProgress currentStep="details" />

                <div className="mt-4 flex items-start justify-between gap-4">
                    <div>
                        <button
                            onClick={backToSearch}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Change
                        </button>
                        <div className="mt-2">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                {selectedRoute.origin}
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                {selectedRoute.destination}
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                {selectedRoute.saccoName} · KES {selectedRoute.fare}
                            </p>
                        </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                        <Calendar className="h-3 w-3 mr-1" />
                        {travelDate}
                    </Badge>
                </div>

                {availabilityQuery.isLoading ? (
                    <Skeleton className="h-16 w-full mt-4" />
                ) : (
                    availability && (
                        <div className="mt-4">
                            {isWaitingList ? (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                                    <div className="flex items-start gap-3">
                                        <Clock className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-medium text-blue-900">
                                                Next shuttle #{availability.awaitingTripCount + 1} in line
                                            </p>
                                            <p className="text-xs text-blue-700 mt-0.5">
                                                {availability.awaitingTripCount === 0
                                                    ? "You're first! We'll text you when boarding starts."
                                                    : `${availability.awaitingTripCount} passenger${availability.awaitingTripCount === 1 ? "" : "s"
                                                    } ahead of you`}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : isFull ? (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                                    <div className="flex items-start gap-3">
                                        <Users className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-medium text-amber-900">Just filled up</p>
                                            <p className="text-xs text-amber-700 mt-0.5">
                                                You'll be first for the next shuttle
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm font-medium text-emerald-900">
                                                    {seatsLeft} seat{seatsLeft === 1 ? "" : "s"} available
                                                </p>
                                                <span className="text-xs text-emerald-700">Boarding now</span>
                                            </div>
                                            <div className="mt-1.5 h-1.5 bg-emerald-200 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                                                    style={{
                                                        width: `${Math.min((seatsLeft / 14) * 100, 100)}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
                    {/* Name */}
                    <div className="space-y-1.5">
                        <Label htmlFor="passengerName" className="text-sm font-medium">
                            Full name
                        </Label>
                        <Input
                            id="passengerName"
                            placeholder="e.g. Jane Wanjiru"
                            className="h-11"
                            {...register("passengerName")}
                        />
                        {errors.passengerName && (
                            <p className="text-xs text-destructive">{errors.passengerName.message}</p>
                        )}
                    </div>

                    {/* Phone */}
                    <div className="space-y-1.5">
                        <Label htmlFor="passengerPhone" className="text-sm font-medium">
                            Phone number
                        </Label>
                        <Controller
                            name="passengerPhone"
                            control={control}
                            render={({ field }) => (
                                <Input
                                    id="passengerPhone"
                                    type="tel"
                                    placeholder="0712345678"
                                    className="h-11"
                                    value={field.value}
                                    onChange={(e) => {
                                        const raw = e.target.value.replace(/\D/g, "");
                                        if (raw.length <= 12) field.onChange(raw);
                                    }}
                                />
                            )}
                        />
                        {errors.passengerPhone ? (
                            <p className="text-xs text-destructive">{errors.passengerPhone.message}</p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                We'll send you a confirmation SMS here
                            </p>
                        )}
                    </div>

                    {/* Payment Method */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Payment method</Label>
                        <Controller
                            name="paymentMethod"
                            control={control}
                            render={({ field }) => (
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => field.onChange(PaymentMethod.MPESA)}
                                        className={`
                                    relative flex items-center justify-center gap-2 h-11 rounded-lg border-2 
                                    transition-all text-sm font-medium
                                    ${field.value === PaymentMethod.MPESA
                                                ? "border-primary bg-primary/5 text-primary"
                                                : "border-border bg-background text-foreground hover:bg-accent"}
                                `}
                                    >
                                        <Smartphone className="h-4 w-4" />
                                        M-Pesa
                                        {field.value === PaymentMethod.MPESA && (
                                            <CheckCircle2 className="h-4 w-4 text-primary absolute right-2" />
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => field.onChange(PaymentMethod.CASH)}
                                        className={`
                                    relative flex items-center justify-center gap-2 h-11 rounded-lg border-2 
                                    transition-all text-sm font-medium
                                    ${field.value === PaymentMethod.CASH
                                                ? "border-primary bg-primary/5 text-primary"
                                                : "border-border bg-background text-foreground hover:bg-accent"}
                                `}
                                    >
                                        <Banknote className="h-4 w-4" />
                                        Cash
                                        {field.value === PaymentMethod.CASH && (
                                            <CheckCircle2 className="h-4 w-4 text-primary absolute right-2" />
                                        )}
                                    </button>
                                </div>
                            )}
                        />
                        <p className="text-xs text-muted-foreground">
                            {paymentMethod === PaymentMethod.MPESA
                                ? "Pay instantly via M-Pesa"
                                : "Pay the conductor when you board"}
                        </p>
                    </div>

                    {/* Travel time window - FIXED: Time fields closer together */}
                    <div className="space-y-2">
                        <div>
                            <Label className="text-sm font-medium">
                                When would you like to travel?
                            </Label>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                Choose a time range that works for you. We'll assign you
                                to a shuttle boarding within this period.
                            </p>
                        </div>

                        {/* Time fields in a single row with closer spacing */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1 space-y-1">
                                <Label
                                    htmlFor="preferredBoardingFrom"
                                    className="text-xs text-muted-foreground"
                                >
                                    From
                                </Label>
                                <Controller
                                    name="preferredBoardingFrom"
                                    control={control}
                                    render={({ field }) => (
                                        <Input
                                            id="preferredBoardingFrom"
                                            type="text"
                                            placeholder="08:00"
                                            className="h-11"
                                            value={field.value}
                                            onChange={(e) => {
                                                // Allow manual text input with basic formatting
                                                let value = e.target.value.replace(/[^0-9:]/g, '');
                                                // Auto-insert colon after 2 digits
                                                if (value.length === 2 && !value.includes(':')) {
                                                    value = value + ':';
                                                }
                                                // Limit to 5 characters (HH:MM)
                                                if (value.length <= 5) {
                                                    field.onChange(value);
                                                }
                                            }}
                                            onBlur={() => {
                                                // Validate format on blur
                                                const val = field.value;
                                                if (val && !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) {
                                                    // Try to format it
                                                    const cleaned = val.replace(/[^0-9]/g, '');
                                                    if (cleaned.length >= 2) {
                                                        const hours = cleaned.slice(0, 2);
                                                        const minutes = cleaned.slice(2, 4).padEnd(2, '0');
                                                        const formatted = `${hours}:${minutes}`;
                                                        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(formatted)) {
                                                            field.onChange(formatted);
                                                        }
                                                    }
                                                }
                                            }}
                                        />
                                    )}
                                />
                            </div>

                            <span className="text-xs text-muted-foreground mt-3">to</span>

                            <div className="flex-1 space-y-1">
                                <Label
                                    htmlFor="preferredBoardingTo"
                                    className="text-xs text-muted-foreground"
                                >
                                    Until
                                </Label>
                                <Controller
                                    name="preferredBoardingTo"
                                    control={control}
                                    render={({ field }) => (
                                        <Input
                                            id="preferredBoardingTo"
                                            type="text"
                                            placeholder="17:30"
                                            className="h-11"
                                            value={field.value}
                                            onChange={(e) => {
                                                let value = e.target.value.replace(/[^0-9:]/g, '');
                                                if (value.length === 2 && !value.includes(':')) {
                                                    value = value + ':';
                                                }
                                                if (value.length <= 5) {
                                                    field.onChange(value);
                                                }
                                            }}
                                            onBlur={() => {
                                                const val = field.value;
                                                if (val && !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) {
                                                    const cleaned = val.replace(/[^0-9]/g, '');
                                                    if (cleaned.length >= 2) {
                                                        const hours = cleaned.slice(0, 2);
                                                        const minutes = cleaned.slice(2, 4).padEnd(2, '0');
                                                        const formatted = `${hours}:${minutes}`;
                                                        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(formatted)) {
                                                            field.onChange(formatted);
                                                        }
                                                    }
                                                }
                                            }}
                                        />
                                    )}
                                />
                            </div>
                        </div>

                        {(errors.preferredBoardingFrom || errors.preferredBoardingTo) && (
                            <p className="text-xs text-destructive">
                                {errors.preferredBoardingTo?.message ??
                                    errors.preferredBoardingFrom?.message}
                            </p>
                        )}

                        <div className="rounded-md bg-muted/40 px-3 py-2">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Shuttles are fill-and-go. Your exact shuttle will be
                                assigned when one is ready within your selected time range.
                            </p>
                        </div>
                    </div>

                    {bookingMutation.isError && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2.5">
                            <p className="text-sm text-destructive">
                                {(bookingMutation.error as any)?.response?.data?.message ??
                                    "Booking failed. Please try again."}
                            </p>
                        </div>
                    )}

                    <Button
                        type="submit"
                        className="w-full h-11 text-base font-medium"
                        disabled={bookingMutation.isPending || isFull || !isValid}
                    >
                        {bookingMutation.isPending ? (
                            <>
                                <span className="animate-spin mr-2">⟳</span>
                                {paymentMethod === PaymentMethod.MPESA
                                    ? "Processing M-Pesa..."
                                    : "Booking..."}
                            </>
                        ) : isFull ? (
                            "Join waiting list"
                        ) : (
                            `Book seat${paymentMethod === PaymentMethod.MPESA ? " & pay" : ""}`
                        )}
                    </Button>
                </form>
            </div>
        );
    }

    // ─── Search Step ──────────────────────────────────────────────────
    const origins = locationsQuery.data?.origins ?? [];
    const destinations = locationsQuery.data?.destinations ?? [];
    const hasSearched = !!origin && !!destination;

    return (
        <div className="mx-auto w-full max-w-md px-4 py-6">
            <StepProgress currentStep="search" />

            <div className="mt-4">
                <h1 className="text-2xl font-bold">Book your seat</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    No account needed — just your name and phone
                </p>
            </div>

            <div className="mt-6 space-y-4">
                {locationsQuery.isLoading ? (
                    <div className="grid grid-cols-2 gap-2">
                        <Skeleton className="h-11 w-full" />
                        <Skeleton className="h-11 w-full" />
                    </div>
                ) : locationsQuery.isError ? (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                        <p className="text-sm text-destructive">
                            Couldn't load routes. Please check your connection.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">From</Label>
                            <Select
                                value={origin}
                                onValueChange={(value) => {
                                    setOrigin(value ?? "");
                                    setSelectedRoute(null);
                                }}
                            >
                                <SelectTrigger className="h-11">
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
                            <Label className="text-sm font-medium">To</Label>
                            <Select
                                value={destination}
                                onValueChange={(value) => {
                                    setDestination(value ?? "");
                                    setSelectedRoute(null);
                                }}
                            >
                                <SelectTrigger className="h-11">
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
                )}

                <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Travel date</Label>
                    <Input
                        type="date"
                        value={travelDate}
                        min={todayString()}
                        onChange={(e) => setTravelDate(e.target.value)}
                        className="h-11"
                    />
                </div>

                {/* ── When would you like to travel? ── */}
                <div className="space-y-2">
                    <div>
                        <Label className="text-sm font-medium">
                            Preferred boarding time (optional)
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            Choose a time range that works for you. We'll assign you
                            to a shuttle boarding within this period.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label
                                htmlFor="preferredBoardingFrom"
                                className="text-xs text-muted-foreground"
                            >
                                From
                            </Label>
                            <Input
                                id="preferredBoardingFrom"
                                type="time"
                                className="h-11"
                                {...register("preferredBoardingFrom")}
                            />
                        </div>

                        <div className="space-y-1">
                            <Label
                                htmlFor="preferredBoardingTo"
                                className="text-xs text-muted-foreground"
                            >
                                Until
                            </Label>
                            <Input
                                id="preferredBoardingTo"
                                type="time"
                                className="h-11"
                                {...register("preferredBoardingTo")}
                            />
                        </div>
                    </div>

                    {(errors.preferredBoardingFrom || errors.preferredBoardingTo) && (
                        <p className="text-xs text-destructive">
                            {errors.preferredBoardingTo?.message ??
                                errors.preferredBoardingFrom?.message}
                        </p>
                    )}
                </div>

                {hasSearched && searchQuery.isLoading && (
                    <div className="space-y-2">
                        <Skeleton className="h-14 w-full" />
                        <Skeleton className="h-14 w-full" />
                    </div>
                )}



                {/* Show error state */}
                {hasSearched && searchQuery.isError && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                        <p className="text-sm text-destructive">
                            Couldn't search routes. Please try again.
                        </p>
                    </div>
                )}

                {/* Show no results */}
                {hasSearched && searchQuery.isSuccess && searchResults.length === 0 && (
                    <div className="bg-muted/30 rounded-lg px-4 py-6 text-center">
                        <Bus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                            No SACCOs run {origin} → {destination}
                        </p>
                    </div>
                )}

                {/* Show results */}
                {hasSearched && searchResults.length > 1 && (
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Choose a SACCO</Label>
                        {searchResults.map((route) => (
                            <button
                                key={route.routeId}
                                onClick={() => chooseRoute(route)}
                                className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-all hover:border-primary hover:bg-primary/5 active:scale-[0.98]"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                                        <Bus className="h-4 w-4 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">{route.saccoName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {route.origin} → {route.destination}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-semibold">KES {route.fare}</p>
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* Single result - auto-selects via useEffect above */}
                {hasSearched && searchQuery.isSuccess && searchResults.length === 1 && (
                    <div className="bg-muted/30 rounded-lg px-4 py-3 text-center">
                        <p className="text-sm text-muted-foreground">
                            Found {searchResults.length} route. Redirecting...
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}