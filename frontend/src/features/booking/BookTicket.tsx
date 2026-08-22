// src/components/BookTicket.tsx
import { useEffect, useRef, useState } from "react";
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
    BookingSource,
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
    MapPin,
    Lock,
} from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { getPaymentStatusForBookingRequest, reconcilePaymentRequest } from "@/api/paymentApi";
import { downloadReceiptPdf } from "@/api/receiptApi";
import { format, parse } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

function todayString(): string {
    return new Date().toISOString().slice(0, 10);
}

// Current wall-clock time as 'HH:mm' — used to stop passengers picking a
// boarding slot today that's already passed. Mirrors the backend's
// same-day check in BookingService.validatePreferredWindow.
function currentTimeString(): string {
    return new Date().toTimeString().slice(0, 5);
}

// ─── Date Picker (shadcn Popover + Calendar) ───────────────────────────
function DatePicker({
    value,
    onChange,
    min,
    max,
}: {
    value: string; // 'YYYY-MM-DD'
    onChange: (value: string) => void;
    min: string;
    max: string;
}) {
    const selected = parse(value, "yyyy-MM-dd", new Date());
    const minDate = parse(min, "yyyy-MM-dd", new Date());
    const maxDate = parse(max, "yyyy-MM-dd", new Date());

    return (
        <Popover>
            <PopoverTrigger>
                <Button
                    variant="outline"
                    className="h-11 w-full justify-start text-left font-normal"
                >
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {format(selected, "EEE, MMM d")}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="single"
                    selected={selected}
                    defaultMonth={selected}
                    onSelect={(date) => date && onChange(format(date, "yyyy-MM-dd"))}
                    disabled={(date) => date < minDate || date > maxDate}
                    autoFocus
                />
            </PopoverContent>
        </Popover>
    );
}

// ─── Time Picker (shadcn Select, in hour/half-hour slots) ──────────────
function generateTimeSlots(min = "00:00", max = "23:30", stepMinutes = 30): string[] {
    const [startH, startM] = min.split(":").map(Number);
    const [endH, endM] = max.split(":").map(Number);
    const slots: string[] = [];
    for (let cursor = startH * 60 + startM; cursor <= endH * 60 + endM; cursor += stepMinutes) {
        const h = String(Math.floor(cursor / 60)).padStart(2, "0");
        const m = String(cursor % 60).padStart(2, "0");
        slots.push(`${h}:${m}`);
    }
    return slots;
}

function formatTimeLabel(time: string): string {
    const [h, m] = time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function TimeSelect({
    value,
    onChange,
    min,
    max,
    placeholder,
}: {
    value?: string;
    onChange: (value: string) => void;
    min?: string;
    max?: string;
    placeholder: string;
}) {
    const slots = generateTimeSlots(min, max);
    return (
        <Select
            value={value || undefined}
            onValueChange={(val) => onChange(val ?? "")}
        >
            <SelectTrigger className="h-11">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
                {slots.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                        {formatTimeLabel(slot)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// Public portal bookings are only allowed for today or tomorrow — mirrors
// BookingService.validatePreBookingDateRange on the backend.
function tomorrowString(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

// Strips a possible ':ss' suffix from a settings time value ('HH:mm:ss' ->
// 'HH:mm') so it matches the format <input type="time"> expects.
function toHHmm(value: string): string {
    return value.slice(0, 5);
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
// preferredBoardingFrom/To are required — the backend's
// validatePreBookingTimeWindow rejects public-portal bookings without a
// window, so we mirror that here instead of failing after full submission.
export const bookingFormSchema = z
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
        passengerEmail: z.string().email("Enter a valid email.").optional().or(z.literal("")),

        preferredBoardingFrom: z
            .string()
            .min(1, "Please choose a start time.")
            .regex(
                /^([01]\d|2[0-3]):[0-5]\d$/,
                "Enter a valid time (e.g. 08:00)."
            ),
        preferredBoardingTo: z
            .string()
            .min(1, "Please choose an end time.")
            .regex(
                /^([01]\d|2[0-3]):[0-5]\d$/,
                "Enter a valid time (e.g. 17:30)."
            ),
    })
    .refine(
        (data) => data.preferredBoardingFrom < data.preferredBoardingTo,
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
    const receiptDownloadedRef = useRef(false);
    const queryClient = useQueryClient();

    const {
        control,
        register,
        handleSubmit,
        watch,
        reset,
        setError,
        formState: { errors, isValid },
    } = useForm<BookingFormValues>({
        resolver: zodResolver(bookingFormSchema),
        mode: "onChange",
        defaultValues: {
            passengerName: "",
            passengerPhone: "",
            passengerEmail: "",
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

    useEffect(() => {
        const isPaid = confirmedBooking?.paymentStatus === "PAID" || paymentSucceeded;
        if (isPaid && confirmedBooking && !receiptDownloadedRef.current) {
            receiptDownloadedRef.current = true;
            downloadReceiptPdf(confirmedBooking.id).catch((err) => {
                console.error("Receipt download failed:", err);
                receiptDownloadedRef.current = false; // allow retry via the manual button
            });
        }
    }, [confirmedBooking?.paymentStatus, paymentSucceeded, confirmedBooking]);

    const availability = availabilityQuery.data;
    // Pre-booking settings for the selected route's sacco — comes straight
    // off getAvailability now, so no second request is needed.
    const preBooking = availability?.preBooking;
    const isPreBookingClosed = !!preBooking && !preBooking.enabled;
    const isCapReached = !!preBooking?.capReached;
    // Native <input type="time"> min/max, derived from the sacco's
    // configured pre-booking window. Falls back to no constraint until
    // availability has loaded.
    const boardingWindowMin = preBooking ? toHHmm(preBooking.morningStart) : undefined;
    const boardingWindowMax = preBooking ? toHHmm(preBooking.morningEnd) : undefined;
    // Prefer the backend's own date bounds once loaded — falls back to local
    // today/tomorrow before a route is selected (availability isn't fetched yet).
    const minTravelDate = preBooking?.minTravelDate ?? todayString();
    const maxTravelDate = preBooking?.maxTravelDate ?? tomorrowString();

    // If travelling today, don't offer/accept boarding slots that have
    // already passed — raises the effective floor to "now" when that's
    // later than the sacco's own window start. Mirrors the backend's
    // same-day check in BookingService.validatePreferredWindow.
    const effectiveBoardingWindowMin =
        travelDate === todayString()
            ? boardingWindowMin && boardingWindowMin > currentTimeString()
                ? boardingWindowMin
                : currentTimeString()
            : boardingWindowMin;

    // True once "now" has eaten the whole window for today — nothing left
    // to book online, same spirit as isPreBookingBlocked below.
    const isBoardingWindowExpiredToday =
        travelDate === todayString() &&
        !!boardingWindowMax &&
        effectiveBoardingWindowMin! > boardingWindowMax;

    function chooseRoute(route: RouteSearchResult) {
        setSelectedRoute(route);
        setStep("details");
    }

    const onSubmit = (values: BookingFormValues) => {
        if (!selectedRoute) return;

        // Final safety-net check — covers a stale tab left open past the
        // boundary between when the fields were picked and now.
        if (travelDate === todayString() && values.preferredBoardingTo < currentTimeString()) {
            setError("preferredBoardingTo", {
                type: "manual",
                message: "This time has already passed — please pick a later time.",
            });
            return;
        }

        bookingMutation.mutate({
            routeId: selectedRoute.routeId,
            travelDate,
            passengerName: values.passengerName.trim(),
            passengerPhone: values.passengerPhone.trim(),
            passengerEmail: values.passengerEmail?.trim() || undefined,
            paymentMethod: values.paymentMethod,
            source: BookingSource.PUBLIC_PORTAL,
            preferredBoardingFrom: values.preferredBoardingFrom,
            preferredBoardingTo: values.preferredBoardingTo,
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
        receiptDownloadedRef.current = false;
    }

    function backToSearch() {
        setStep("search");
        setSelectedRoute(null);
    }

    // Clamp the travel date to [today, tomorrow] — covers the case where a
    // user leaves the tab open overnight and "today" quietly becomes stale,
    // or manually types a date outside the allowed range.
    function handleTravelDateChange(value: string) {
        if (value < minTravelDate) {
            setTravelDate(minTravelDate);
        } else if (value > maxTravelDate) {
            setTravelDate(maxTravelDate);
        } else {
            setTravelDate(value);
        }
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

                {/* ── Receipt ── */}
                {isPaid ? (
                    <div className="mt-6 rounded-xl border border-border overflow-hidden">
                        {/* Receipt header strip */}
                        <div className="bg-emerald-50 border-b border-emerald-100 px-4 py-3 text-center">
                            <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">
                                Receipt
                            </p>
                            <p className="text-sm font-semibold text-emerald-900 mt-0.5">
                                {selectedRoute.saccoName}
                            </p>
                        </div>

                        <div className="px-4 py-4 space-y-3">
                            {/* Route + ref */}
                            <div className="flex items-center justify-between">
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

                            <div className="h-px bg-border" style={{ borderTop: "1px dashed var(--border)" }} />

                            {/* Line items */}
                            <dl className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Passenger</dt>
                                    <dd className="font-medium">{confirmedBooking.passengerName}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Phone</dt>
                                    <dd className="font-medium">{confirmedBooking.passengerPhone}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Travel date</dt>
                                    <dd className="font-medium">{travelDate}</dd>
                                </div>
                                {confirmedBooking.seatNumber && (
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">Seat</dt>
                                        <dd className="font-medium">{confirmedBooking.seatNumber}</dd>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Payment method</dt>
                                    <dd className="font-medium">{confirmedBooking.paymentMethod}</dd>
                                </div>
                                {confirmedBooking.mpesaReceiptNumber && (
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">M-Pesa Ref</dt>
                                        <dd className="font-mono text-xs font-medium">
                                            {confirmedBooking.mpesaReceiptNumber}
                                        </dd>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">Status</dt>
                                    <dd className="font-medium">{confirmedBooking.status}</dd>
                                </div>
                            </dl>

                            <div className="h-px" style={{ borderTop: "1px dashed var(--border)" }} />

                            {/* Total */}
                            <div className="flex items-center justify-between pt-1">
                                <span className="text-sm font-semibold">Total Paid</span>
                                <span className="text-lg font-bold">KES {confirmedBooking.fare}</span>
                            </div>
                        </div>
                    </div>
                ) : (
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
                            <span className="text-sm text-muted-foreground">Fare</span>
                            <span className="text-lg font-semibold">KES {confirmedBooking.fare}</span>
                        </div>
                    </div>
                )}

                <div className="mt-3 space-y-3">
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
                            className="w-full"
                            onClick={() => {
                                setConfirmedBooking(null);
                                setStep("details");
                                setPollStartedAt(null);
                            }}
                        >
                            Try again
                        </Button>
                    )}

                    {isPaid && (
                        <Button
                            className="w-full"
                            onClick={() => downloadReceiptPdf(confirmedBooking.id).catch(console.error)}
                        >
                            Download Receipt
                        </Button>
                    )}

                    <Button variant="outline" className="w-full" onClick={startOver}>
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
        // Blocks submission when the sacco has pre-booking turned off, or
        // the public pre-booking cap for this route/date has been hit.
        const isPreBookingBlocked = isPreBookingClosed || isCapReached;

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
                        <CalendarIcon className="h-3 w-3 mr-1" />
                        {travelDate}
                    </Badge>
                </div>

                {availabilityQuery.isLoading ? (
                    <Skeleton className="h-16 w-full mt-4" />
                ) : (
                    availability && (
                        <div className="mt-4 space-y-2">
                            {isPreBookingBlocked ? (
                                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                                    <div className="flex items-start gap-3">
                                        <Lock className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">
                                                {isPreBookingClosed
                                                    ? "Online pre-booking is closed"
                                                    : "Pre-booking is full for this date"}
                                            </p>
                                            <p className="text-xs text-slate-600 mt-0.5">
                                                {isPreBookingClosed
                                                    ? "This sacco isn't accepting online bookings right now — please book in person."
                                                    : "All online seats for this route and date are taken. Try another date or book in person."}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : isWaitingList ? (
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

                            {/* Pre-booking capacity note — only shown once settings have loaded
                                and pre-booking is actually open, so it doesn't duplicate the
                                blocked-state banner above. */}
                            {preBooking && !isPreBookingBlocked && (
                                <p className="text-xs text-muted-foreground px-1">
                                    {preBooking.seatsRemaining} of {preBooking.maxPreBookableSeats} online
                                    pre-booking seat{preBooking.maxPreBookableSeats === 1 ? "" : "s"} left today
                                </p>
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

                    <div className="space-y-1.5">
                        <Label htmlFor="passengerEmail" className="text-sm font-medium">
                            Email <span className="text-muted-foreground font-normal">(optional)</span>
                        </Label>
                        <Input
                            id="passengerEmail"
                            type="email"
                            placeholder="you@example.com"
                            className="h-11"
                            {...register("passengerEmail")}
                        />
                        {errors.passengerEmail ? (
                            <p className="text-xs text-destructive">{errors.passengerEmail.message}</p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                Add this to look up your tickets later
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

                    {/* Travel time window — constrained to the sacco's pre-booking hours,
                        and to "now" when travelling today */}
                    <div className="space-y-2">
                        <div>
                            <Label className="text-sm font-medium">
                                When would you like to travel?
                            </Label>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                {boardingWindowMin && boardingWindowMax
                                    ? `Choose a time between ${boardingWindowMin} and ${boardingWindowMax}. We'll assign you to a shuttle boarding within this period.`
                                    : "Choose a time range that works for you. We'll assign you to a shuttle boarding within this period."}
                            </p>
                        </div>

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
                                        <TimeSelect
                                            value={field.value}
                                            onChange={field.onChange}
                                            min={effectiveBoardingWindowMin}
                                            max={boardingWindowMax}
                                            placeholder={effectiveBoardingWindowMin ?? "08:00"}
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
                                        <TimeSelect
                                            value={field.value}
                                            onChange={field.onChange}
                                            min={effectiveBoardingWindowMin}
                                            max={boardingWindowMax}
                                            placeholder={boardingWindowMax ?? "17:30"}
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

                        {isBoardingWindowExpiredToday && (
                            <p className="text-xs text-destructive px-1">
                                Today's pre-booking window has closed. Try tomorrow, or book in person.
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
                        disabled={
                            bookingMutation.isPending ||
                            isFull ||
                            isPreBookingBlocked ||
                            isBoardingWindowExpiredToday ||
                            !isValid
                        }
                    >
                        {bookingMutation.isPending ? (
                            <>
                                <span className="animate-spin mr-2">⟳</span>
                                {paymentMethod === PaymentMethod.MPESA
                                    ? "Processing M-Pesa..."
                                    : "Booking..."}
                            </>
                        ) : isPreBookingBlocked ? (
                            isPreBookingClosed ? "Pre-booking closed" : "Fully booked"
                        ) : isBoardingWindowExpiredToday ? (
                            "No boarding slots left today"
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
                    <DatePicker
                        value={travelDate}
                        onChange={handleTravelDateChange}
                        min={minTravelDate}
                        max={maxTravelDate}
                    />
                    <p className="text-xs text-muted-foreground">
                        Online booking covers today and tomorrow only
                    </p>
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