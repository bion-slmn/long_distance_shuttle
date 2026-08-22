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
    ArrowRight,
    Check,
    CheckCircle2,
    Smartphone,
    Banknote,
    Bus,
    Clock,
    Users,
    ChevronRight,
    MapPin,
    Lock,
    User,
    Phone,
    Mail,
    QrCode,
    Download,
    Search,
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
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    aria-label="Choose a custom date"
                >
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
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
        <div className="flex items-start px-1 py-3">
            {steps.map((step, index) => {
                const isDone = index < currentIndex;
                const isCurrent = index === currentIndex;
                return (
                    <div key={step.key} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-1.5">
                            <div
                                className={`
                                w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all shrink-0
                                ${isDone
                                        ? "bg-primary text-primary-foreground"
                                        : isCurrent
                                            ? "bg-primary text-primary-foreground ring-4 ring-primary/15"
                                            : "bg-muted text-muted-foreground"}
                            `}
                            >
                                {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
                            </div>
                            <span
                                className={`
                                text-[11px] font-medium whitespace-nowrap
                                ${isDone || isCurrent ? "text-foreground" : "text-muted-foreground"}
                            `}
                            >
                                {step.label}
                            </span>
                        </div>
                        {index < steps.length - 1 && (
                            <div
                                className={`
                                flex-1 h-[2px] mx-2 mb-4 transition-all
                                ${isDone ? "bg-primary" : "bg-muted"}
                            `}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Section header used inside the Details step's cards ──────────────
function SectionHeader({
    icon: Icon,
    title,
}: {
    icon: React.ElementType;
    title: string;
}) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold">{title}</h3>
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
    // Set true when the passenger explicitly backs out of a selected route
    // via "Edit". Prevents the single-result auto-select effect below from
    // immediately snapping them right back into the details step before
    // they can change anything — cleared as soon as they touch origin/destination.
    const suppressAutoSelectRef = useRef(false);
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
        if (suppressAutoSelectRef.current) return;
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
        suppressAutoSelectRef.current = false;
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
        suppressAutoSelectRef.current = false;
    }

    function backToSearch() {
        suppressAutoSelectRef.current = true;
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
                    <p className="text-sm text-muted-foreground mt-1 px-4 leading-relaxed">
                        {isPaid ? (
                            <>Your seat on {selectedRoute.saccoName} is secured. A copy of this receipt has been sent to your phone.</>
                        ) : (
                            <>{selectedRoute.saccoName} · {travelDate}</>
                        )}
                    </p>
                </div>

                {/* ── Receipt ── */}
                {isPaid ? (
                    <div className="mt-6 rounded-xl border border-border overflow-hidden">
                        {/* Receipt header strip */}
                        <div className="bg-emerald-50 border-b border-emerald-100 px-4 py-3 flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">
                                    Receipt
                                </p>
                                <p className="text-sm font-semibold text-emerald-900 mt-0.5">
                                    {selectedRoute.saccoName}
                                </p>
                                <p className="text-[11px] text-emerald-700/80 font-mono mt-0.5">
                                    REF: #{confirmedBooking.id.slice(0, 6).toUpperCase()}
                                </p>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-white/70 border border-emerald-200 flex items-center justify-center shrink-0">
                                <QrCode className="h-5 w-5 text-emerald-700" />
                            </div>
                        </div>

                        <div className="px-4 py-4 space-y-3">
                            {/* Route */}
                            <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">
                                    {selectedRoute.origin} → {selectedRoute.destination}
                                </span>
                            </div>

                            <div className="h-px" style={{ borderTop: "1px dashed var(--border)" }} />

                            {/* Line items */}
                            <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
                                <div>
                                    <dt className="text-xs text-muted-foreground">Passenger</dt>
                                    <dd className="font-medium">{confirmedBooking.passengerName}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-muted-foreground">Travel date</dt>
                                    <dd className="font-medium">{travelDate}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-muted-foreground">Phone</dt>
                                    <dd className="font-medium">{confirmedBooking.passengerPhone}</dd>
                                </div>
                                {confirmedBooking.seatNumber && (
                                    <div>
                                        <dt className="text-xs text-muted-foreground">Seat number</dt>
                                        <dd className="font-medium">{confirmedBooking.seatNumber}</dd>
                                    </div>
                                )}
                                <div>
                                    <dt className="text-xs text-muted-foreground">Status</dt>
                                    <dd>
                                        <Badge variant="secondary" className="mt-0.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                            {confirmedBooking.status}
                                        </Badge>
                                    </dd>
                                </div>
                                {confirmedBooking.mpesaReceiptNumber && (
                                    <div>
                                        <dt className="text-xs text-muted-foreground">M-Pesa Ref</dt>
                                        <dd className="font-mono text-xs font-medium mt-0.5">
                                            {confirmedBooking.mpesaReceiptNumber}
                                        </dd>
                                    </div>
                                )}
                            </div>

                            <div className="h-px" style={{ borderTop: "1px dashed var(--border)" }} />

                            {/* Total */}
                            <div className="flex items-center justify-between pt-1">
                                <div>
                                    <p className="text-sm font-semibold">Total Paid</p>
                                    <p className="text-xs text-muted-foreground">{confirmedBooking.paymentMethod}</p>
                                </div>
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
                            className="w-full h-11"
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
                            className="w-full h-11 gap-2"
                            onClick={() => downloadReceiptPdf(confirmedBooking.id).catch(console.error)}
                        >
                            <Download className="h-4 w-4" />
                            Download Receipt
                        </Button>
                    )}

                    <Button variant="outline" className="w-full h-11" onClick={startOver}>
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
            <div className="mx-auto w-full max-w-md px-4 py-6 pb-28">
                <StepProgress currentStep="details" />

                <div className="mt-4 rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Bus className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-sm font-semibold leading-snug break-words">
                                {selectedRoute.origin}
                                <ChevronRight className="inline h-3.5 w-3.5 text-muted-foreground mx-0.5 -translate-y-px" />
                                {selectedRoute.destination}
                            </h2>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {selectedRoute.saccoName}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={backToSearch}
                            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0 py-0.5"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Edit
                        </button>
                    </div>

                    {/* Quick date switch — lets a passenger jump to the other
                        available day right here if today's slots are gone,
                        without having to leave the details step to do it. */}
                    <div className="flex items-center gap-2 mt-3">
                        <button
                            type="button"
                            onClick={() => handleTravelDateChange(todayString())}
                            className={`
                            flex-1 h-8 rounded-md text-xs font-medium border transition-all
                            ${travelDate === todayString()
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-foreground hover:bg-accent"}
                        `}
                        >
                            Today
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTravelDateChange(tomorrowString())}
                            disabled={tomorrowString() > maxTravelDate}
                            className={`
                            flex-1 h-8 rounded-md text-xs font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed
                            ${travelDate === tomorrowString()
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-foreground hover:bg-accent"}
                        `}
                        >
                            Tomorrow
                        </button>
                    </div>
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
                                <div className="flex items-center justify-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-4 py-2.5">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                    <p className="text-sm font-medium text-emerald-900">
                                        {seatsLeft} seat{seatsLeft === 1 ? "" : "s"} available
                                    </p>
                                </div>
                            )}

                            {/* Pre-booking capacity note — only shown once settings have loaded
                                and pre-booking is actually open, so it doesn't duplicate the
                                blocked-state banner above. */}
                            {preBooking && !isPreBookingBlocked && (
                                <p className="text-xs text-muted-foreground text-center">
                                    {preBooking.seatsRemaining} of {preBooking.maxPreBookableSeats} online
                                    pre-booking seat{preBooking.maxPreBookableSeats === 1 ? "" : "s"} left today
                                </p>
                            )}
                        </div>
                    )
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
                    {/* Passenger Details card */}
                    <div className="rounded-xl border border-border p-4">
                        <SectionHeader icon={User} title="Passenger Details" />

                        <div className="space-y-4">
                            {/* Name */}
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="passengerName"
                                    className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                                >
                                    Full name
                                </Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="passengerName"
                                        placeholder="Enter your full name"
                                        className="h-11 pl-9"
                                        {...register("passengerName")}
                                    />
                                </div>
                                {errors.passengerName && (
                                    <p className="text-xs text-destructive">{errors.passengerName.message}</p>
                                )}
                            </div>

                            {/* Phone */}
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="passengerPhone"
                                    className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                                >
                                    Phone number
                                </Label>
                                <Controller
                                    name="passengerPhone"
                                    control={control}
                                    render={({ field }) => (
                                        <div className="relative flex items-center">
                                            <span className="absolute left-3 flex items-center gap-1 text-sm text-muted-foreground pointer-events-none">
                                                <Phone className="h-4 w-4" />
                                                +254
                                            </span>
                                            <Input
                                                id="passengerPhone"
                                                type="tel"
                                                placeholder="7XX XXX XXX"
                                                className="h-11 pl-[4.5rem]"
                                                value={field.value}
                                                onChange={(e) => {
                                                    const raw = e.target.value.replace(/\D/g, "");
                                                    if (raw.length <= 12) field.onChange(raw);
                                                }}
                                            />
                                        </div>
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

                            {/* Email */}
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="passengerEmail"
                                    className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                                >
                                    Email <span className="normal-case font-normal">(optional)</span>
                                </Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="passengerEmail"
                                        type="email"
                                        placeholder="you@example.com"
                                        className="h-11 pl-9"
                                        {...register("passengerEmail")}
                                    />
                                </div>
                                {errors.passengerEmail ? (
                                    <p className="text-xs text-destructive">{errors.passengerEmail.message}</p>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        Add this to look up your tickets later
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Preferred Boarding Window card */}
                    <div className="rounded-xl border border-border p-4">
                        <SectionHeader icon={Clock} title="Preferred Boarding Window" />

                        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                            Shuttles operate on a "fill-and-go" basis. Please select a time window
                            you're available to board
                            {boardingWindowMin && boardingWindowMax
                                ? ` (between ${boardingWindowMin} and ${boardingWindowMax}).`
                                : "."}
                        </p>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="preferredBoardingFrom"
                                    className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
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

                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="preferredBoardingTo"
                                    className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
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
                            <p className="text-xs text-destructive mt-2">
                                {errors.preferredBoardingTo?.message ??
                                    errors.preferredBoardingFrom?.message}
                            </p>
                        )}

                        {isBoardingWindowExpiredToday && (
                            <p className="text-xs text-destructive mt-2">
                                Today's pre-booking window has closed. Try tomorrow, or book in person.
                            </p>
                        )}
                    </div>

                    {/* Payment Method card */}
                    <div className="rounded-xl border border-border p-4">
                        <SectionHeader icon={Smartphone} title="Payment Method" />

                        <Controller
                            name="paymentMethod"
                            control={control}
                            render={({ field }) => (
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => field.onChange(PaymentMethod.MPESA)}
                                        className={`
                                        relative flex flex-col items-center justify-center gap-2 py-4 rounded-xl border-2
                                        transition-all text-sm font-medium
                                        ${field.value === PaymentMethod.MPESA
                                                ? "border-primary bg-primary/5 text-primary"
                                                : "border-border bg-background text-foreground hover:bg-accent"}
                                    `}
                                    >
                                        <span
                                            className={`
                                            absolute top-2 right-2 h-3.5 w-3.5 rounded-full border-2
                                            ${field.value === PaymentMethod.MPESA
                                                    ? "border-primary bg-primary"
                                                    : "border-muted-foreground/40"}
                                        `}
                                        />
                                        <Smartphone className="h-5 w-5" />
                                        M-Pesa
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => field.onChange(PaymentMethod.CASH)}
                                        className={`
                                        relative flex flex-col items-center justify-center gap-2 py-4 rounded-xl border-2
                                        transition-all text-sm font-medium
                                        ${field.value === PaymentMethod.CASH
                                                ? "border-primary bg-primary/5 text-primary"
                                                : "border-border bg-background text-foreground hover:bg-accent"}
                                    `}
                                    >
                                        <span
                                            className={`
                                            absolute top-2 right-2 h-3.5 w-3.5 rounded-full border-2
                                            ${field.value === PaymentMethod.CASH
                                                    ? "border-primary bg-primary"
                                                    : "border-muted-foreground/40"}
                                        `}
                                        />
                                        <Banknote className="h-5 w-5" />
                                        Cash
                                    </button>
                                </div>
                            )}
                        />
                        <p className="text-xs text-muted-foreground mt-3">
                            {paymentMethod === PaymentMethod.MPESA
                                ? "Pay instantly via M-Pesa"
                                : "Pay the conductor when you board"}
                        </p>
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
                        className="w-full h-12 text-base font-semibold gap-2"
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
                                <span className="animate-spin">⟳</span>
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
                            <>
                                {`Book seat${paymentMethod === PaymentMethod.MPESA ? " & pay" : ""}`}
                                <ArrowRight className="h-4 w-4" />
                            </>
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
                <h1 className="text-lg font-semibold">Where are you going?</h1>
                <p className="text-xs text-muted-foreground mt-1">
                    Enter your route to find available shuttles — no account needed.
                </p>
            </div>

            <div className="mt-6 rounded-xl border border-border p-4 space-y-4">
                {locationsQuery.isLoading ? (
                    <div className="space-y-3">
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
                        <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                From
                            </Label>
                            <div className="relative">
                                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
                                <Select
                                    value={origin}
                                    onValueChange={(value) => {
                                        suppressAutoSelectRef.current = false;
                                        setOrigin(value ?? "");
                                        setSelectedRoute(null);
                                    }}
                                >
                                    <SelectTrigger className="h-11 pl-8">
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
                        </div>

                        <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                To
                            </Label>
                            <div className="relative">
                                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
                                <Select
                                    value={destination}
                                    onValueChange={(value) => {
                                        suppressAutoSelectRef.current = false;
                                        setDestination(value ?? "");
                                        setSelectedRoute(null);
                                    }}
                                >
                                    <SelectTrigger className="h-11 pl-8">
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
                    </div>
                )}

                <div className="h-px bg-border" />

                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Travel date
                    </Label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => handleTravelDateChange(todayString())}
                            className={`
                            flex-1 h-11 rounded-lg text-sm font-medium border-2 transition-all
                            ${travelDate === todayString()
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-foreground hover:bg-accent"}
                        `}
                        >
                            Today
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTravelDateChange(tomorrowString())}
                            disabled={tomorrowString() > maxTravelDate}
                            className={`
                            flex-1 h-11 rounded-lg text-sm font-medium border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed
                            ${travelDate === tomorrowString()
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-foreground hover:bg-accent"}
                        `}
                        >
                            Tomorrow
                        </button>
                        <DatePicker
                            value={travelDate}
                            onChange={handleTravelDateChange}
                            min={minTravelDate}
                            max={maxTravelDate}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Online booking covers today and tomorrow only
                    </p>
                </div>

                <Button
                    type="button"
                    disabled={!hasSearched}
                    className="w-full h-12 text-base font-medium gap-2"
                >
                    <Search className="h-4 w-4" />
                    Search Shuttles
                    <ArrowRight className="h-4 w-4" />
                </Button>
            </div>

            {hasSearched && searchQuery.isLoading && (
                <div className="space-y-2 mt-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                </div>
            )}

            {/* Show error state */}
            {hasSearched && searchQuery.isError && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 mt-4">
                    <p className="text-sm text-destructive">
                        Couldn't search routes. Please try again.
                    </p>
                </div>
            )}

            {/* Show no results */}
            {hasSearched && searchQuery.isSuccess && searchResults.length === 0 && (
                <div className="bg-muted/30 rounded-lg px-4 py-6 text-center mt-4">
                    <Bus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                        No SACCOs run {origin} → {destination}
                    </p>
                </div>
            )}

            {/* Show results */}
            {hasSearched && searchResults.length > 1 && (
                <div className="space-y-2 mt-4">
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
                <div className="bg-muted/30 rounded-lg px-4 py-3 text-center mt-4">
                    <p className="text-sm text-muted-foreground">
                        Found {searchResults.length} route. Redirecting...
                    </p>
                </div>
            )}
        </div>
    );
}