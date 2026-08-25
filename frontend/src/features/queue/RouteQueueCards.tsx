// src/features/queue/RouteQueueCards.tsx
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    Plus,
    Car,
    Clock as ClockIcon,
    Users,
    Truck,
    Building2,
    Banknote,
    ArrowRightCircle,
    UserPlus,
    Smartphone,
    Wallet,
    ClipboardList,
    Phone,
    CheckCircle2,
    XCircle,
    Sparkles,
    PartyPopper,
    PhoneCall,
    Mail,
    MapPin,
    Undo2,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import {
    getQueueEntriesRequest,
    updateQueueEntryRequest,
    QueueEntryStatus,
    type QueueEntry,
} from "@/api/routeApi"
import {
    PaymentMethod,
    BookingStatus,
    type PaymentMethod as PaymentMethodType,
    type Booking,
    updateBookingRequest,
    BookingSource,
    createBookingByClerkRequest,
    getBookingSeatMapRequest,
} from "@/api/bookingApi"
import { QueueClockInDialog } from "./QueueClockInDialog"
import { useElapsedTime } from "@/hooks/useElapsedTime"
import { useSaccoName } from "@/hooks/useSaccoName"
import { useVehicleManifest } from "@/hooks/useVehicleMainfest"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ─── Manifest Hook (shared) ─────────────────────────────────────────────────
//
// Fetches bookings for a route/date and filters to a single vehicle's
// manifest. Shared between RouteQueueCards (the loading-vehicle block) and
// anywhere else — e.g. RouteQueueView's WAITING/BOARDING/DISPATCHED lanes —
// that wants to show a manifest for a specific QueueEntry. getBookingsRequest
// has no vehicleId param, only routeId/travelDate/status/tripId, so we fetch
// broad and filter client-side against booking.trip?.vehicleId. Bookings only
// carry a vehicle once assigned to a trip, so AWAITING_TRIP bookings
// (trip: null) never show up on any vehicle's manifest yet.


interface RouteQueueCardsProps {
    routes: any[]
    selectedDate: string
    isToday: boolean
    onSelectRoute?: (routeId: string) => void
    className?: string
}

import { useQueries } from "@tanstack/react-query" // add to existing react-query import
import { SeatPicker } from "../booking/SeatPicker"
import { getMpesaTransactionsByPhoneRequest, MpesaTransactionMatchStatus, type MpesaTransaction } from "@/api/paymentApi"

export function RouteQueueCards({
    routes,
    selectedDate,
    isToday,
    onSelectRoute,
    className,
}: RouteQueueCardsProps) {
    // Fetch queue entries for every route so we can sort the grid — same
    // queryKey as RouteQueueCard's own useQuery, so this is a cache-share,
    // not a duplicate fetch. Individual cards read the same cached data.
    const queueQueries = useQueries({
        queries: routes.map((route) => ({
            queryKey: ["queue", route.id, selectedDate],
            queryFn: () => getQueueEntriesRequest({ routeId: route.id, date: selectedDate }),
            refetchInterval: isToday ? 15_000 : false,
        })),
    })

    const sortedRoutes = [...routes].sort((a, b) => {
        const metaA = getSortMeta(queueQueries[routes.indexOf(a)]?.data)
        const metaB = getSortMeta(queueQueries[routes.indexOf(b)]?.data)

        // 1. Boarding vehicles bubble to the top
        if (metaA.hasBoarding !== metaB.hasBoarding) {
            return metaA.hasBoarding ? -1 : 1
        }
        // 2. Among boarding vehicles, fewest remaining seats first —
        //    i.e. the ones closest to full/ready to dispatch surface first
        return metaA.remainingSeats - metaB.remainingSeats
    })

    return (
        <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3", className)}>
            {sortedRoutes.map((route) => (
                <RouteQueueCard
                    key={route.id}
                    route={route}
                    selectedDate={selectedDate}
                    isToday={isToday}
                    onSelectRoute={onSelectRoute}
                />
            ))}
        </div>
    )
}

// Returns sort priority for a route based on its queue entries.
// No data yet (still loading) is treated like "no boarding vehicle" so
// routes don't jump around while loading, then settle once data arrives.
function getSortMeta(entries?: QueueEntry[]) {
    const boarding = entries?.filter((e) => e.status === QueueEntryStatus.BOARDING) ?? []
    if (boarding.length === 0) {
        return { hasBoarding: false, remainingSeats: Infinity }
    }
    // Lead boarding vehicle — same one the card surfaces in LoadingVehicleBlock
    const lead = boarding[0]
    const capacity = lead.vehicle.seatingCapacity
    const seated = lead.seatedCount ?? 0
    return { hasBoarding: true, remainingSeats: Math.max(0, capacity - seated) }
}

// ─── Individual Card ────────────────────────────────────────────────────────

interface RouteQueueCardProps {
    route: any
    selectedDate: string
    isToday: boolean
    onSelectRoute?: (routeId: string) => void
}

function RouteQueueCard({ route, selectedDate, isToday, onSelectRoute }: RouteQueueCardProps) {
    const [showClockIn, setShowClockIn] = useState(false)
    const [showBooking, setShowBooking] = useState(false)
    const [showManifest, setShowManifest] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const saccoName = useSaccoName(route.saccoId)
    const queryClient = useQueryClient()

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

    const queueQueryKey = ["queue", route.id, selectedDate]

    const { data: entries, isLoading } = useQuery({
        queryKey: queueQueryKey,
        queryFn: () => getQueueEntriesRequest({ routeId: route.id, date: selectedDate }),
        refetchInterval: isToday ? 15_000 : false,
    })

    const waiting = entries?.filter((e) => e.status === QueueEntryStatus.WAITING) ?? []
    const boarding = entries?.filter((e) => e.status === QueueEntryStatus.BOARDING) ?? []
    const dispatched = entries?.filter((e) => e.status === QueueEntryStatus.DISPATCHED) ?? []

    const loadingVehicle = boarding[0] as QueueEntry | undefined
    const nextWaiting = [...waiting].sort((a, b) => a.position - b.position)[0] as QueueEntry | undefined

    const { bookings: manifest, isLoading: manifestLoading } = useVehicleManifest(
        route.id,
        selectedDate,
        loadingVehicle?.vehicleId,
        showManifest
    )

    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: QueueEntryStatus }) =>
            updateQueueEntryRequest(id, { status }),
        onMutate: async ({ id, status }) => {
            await queryClient.cancelQueries({ queryKey: queueQueryKey })
            const previous = queryClient.getQueryData<QueueEntry[]>(queueQueryKey)
            queryClient.setQueryData<QueueEntry[]>(queueQueryKey, (old) =>
                old?.map((e) => (e.id === id ? { ...e, status } : e))
            )
            return { previous }
        },
        onError: (_err, _vars, context) => {
            queryClient.setQueryData(queueQueryKey, context?.previous)
            toast.error("Failed to update queue status")
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queueQueryKey })
        },
    })

    const seatMapQueryKey = ["seat-map", route.id, selectedDate]

    const bookingMutation = useMutation({
        mutationFn: (payload: BookingFormValues) => {
            const requests = Array.from({ length: payload.seats }, (_, i) =>
                createBookingByClerkRequest({
                    routeId: route.id,
                    travelDate: selectedDate,
                    passengerName: payload.passengerName || "Walk-in",
                    passengerPhone: payload.passengerPhone,
                    paymentMethod: payload.paymentMethod,
                    source: BookingSource.CLERK,
                    seatNumber: payload.seatNumbers?.[i],
                    mpesaTransactionId: i === 0 ? payload.mpesaTransactionId : undefined,
                })
            )
            return Promise.all(requests)
        },
        onSuccess: () => {
            toast.success("Booking confirmed")
            queryClient.invalidateQueries({ queryKey: queueQueryKey })
            queryClient.invalidateQueries({ queryKey: seatMapQueryKey })
            setShowBooking(false)
        },
        onError: () => {
            toast.error("Failed to book — try again")
        },
    })

    return (
        <div className="rounded-xl border bg-card p-4 space-y-3 transition-all hover:border-muted-foreground/20 hover:shadow-sm">
            {/* Header */}
            <div
                className={cn("flex items-start justify-between gap-2", onSelectRoute && "cursor-pointer")}
                onClick={() => onSelectRoute?.(route.id)}
            >
                <div className="min-w-0">
                    <p className="truncate font-semibold text-base">
                        {route.origin} → {route.destination}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
                            <Building2 className="size-3" />
                            {saccoName || "N/A"}
                        </span>
                        {route.fare != null && (
                            <span className="flex items-center gap-1 text-xs font-medium text-foreground/80">
                                <Banknote className="size-3 text-muted-foreground/50" />
                                KSh {Number(route.fare).toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs shrink-0 rounded-full"
                    disabled={!isToday}
                    title="Clock in a vehicle"
                    aria-label="Clock in a vehicle"
                    onClick={(e) => {
                        e.stopPropagation()
                        setShowClockIn(true)
                    }}
                >
                    <Plus className="size-3.5" />
                    Clock In
                </Button>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-24 w-full rounded-lg" />
                </div>
            ) : (
                <>
                    <LoadingVehicleBlock
                        entry={loadingVehicle}
                        readOnly={!isToday}
                        isUpdating={statusMutation.isPending}
                        onDispatch={() =>
                            loadingVehicle &&
                            statusMutation.mutate({ id: loadingVehicle.id, status: QueueEntryStatus.DISPATCHED })
                        }
                        onClick={() => {
                            if (!isToday || !loadingVehicle) return
                            const isFull = (loadingVehicle.seatedCount ?? 0) >= loadingVehicle.vehicle.seatingCapacity
                            if (!isFull) setShowBooking(true)
                        }}
                        onViewManifest={() => setShowManifest(true)}
                        onStartBoarding={() => nextWaiting && statusMutation.mutate({ id: nextWaiting.id, status: QueueEntryStatus.BOARDING })}
                        onClockIn={() => setShowClockIn(true)}
                        hasWaiting={waiting.length > 0}
                    />

                    {/* Waiting / Dispatched counts */}
                    <div className="flex items-center gap-3 text-xs pt-0.5">
                        <span className="flex items-center gap-1 text-amber-500">
                            <ClockIcon className="size-3" />
                            {waiting.length} waiting
                            {isToday && nextWaiting && (
                                <button
                                    type="button"
                                    className="text-amber-500/70 hover:text-amber-500 disabled:opacity-40 transition-colors"
                                    disabled={statusMutation.isPending}
                                    title="Move next vehicle to boarding"
                                    aria-label="Move next vehicle to boarding"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        statusMutation.mutate({ id: nextWaiting.id, status: QueueEntryStatus.BOARDING })
                                    }}
                                >
                                    <ArrowRightCircle className="size-3" />
                                </button>
                            )}
                        </span>
                        <span className="flex items-center gap-1 text-emerald-500">
                            <Truck className="size-3" />
                            {dispatched.length} dispatched
                        </span>
                        <span className="text-[10px] text-muted-foreground/50 ml-auto uppercase tracking-wide">
                            {(entries?.length ?? 0)} total fleet
                        </span>
                    </div>
                </>
            )}

            <QueueClockInDialog
                routeId={route.id}
                open={showClockIn}
                onOpenChange={setShowClockIn}
            />

            {loadingVehicle && (
                <>
                    <BookingSheet
                        open={showBooking}
                        onOpenChange={setShowBooking}
                        side={isMobile ? "bottom" : "right"}
                        entry={loadingVehicle}
                        fare={route.fare}
                        isSubmitting={bookingMutation.isPending}
                        onSubmit={(payload) => bookingMutation.mutate(payload)}
                        route={route}
                        travelDate={selectedDate}
                    />
                    <ManifestSheet
                        open={showManifest}
                        onOpenChange={setShowManifest}
                        side={isMobile ? "bottom" : "right"}
                        entry={loadingVehicle}
                        bookings={manifest}
                        isLoading={manifestLoading}
                        travelDate={selectedDate}
                        route={route}
                    />
                </>
            )}
        </div>
    )
}

// ─── Loading Vehicle Block ──────────────────────────────────────────────────

interface LoadingVehicleBlockProps {
    entry?: QueueEntry
    readOnly?: boolean
    isUpdating?: boolean
    onDispatch?: () => void
    onClick?: () => void
    onViewManifest?: () => void
    onStartBoarding?: () => void
    onClockIn?: () => void
    hasWaiting?: boolean
}

function LoadingVehicleBlock({
    entry,
    readOnly,
    isUpdating,
    onDispatch,
    onClick,
    onViewManifest,
    onStartBoarding,
    onClockIn,
    hasWaiting,
}: LoadingVehicleBlockProps) {
    const elapsed = useElapsedTime(entry?.clockedInAt ?? null)

    // ── Empty state ─────────────────────────────────────────────────────
    if (!entry) {
        return (
            <div className="rounded-lg border border-dashed py-6 px-4 text-center space-y-3">
                <Car className="size-5 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground/60">No shuttle currently boarding</p>
                {!readOnly && hasWaiting && onStartBoarding ? (
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 rounded-full"
                        disabled={isUpdating}
                        onClick={(e) => {
                            e.stopPropagation()
                            onStartBoarding()
                        }}
                    >
                        <ArrowRightCircle className="size-3.5" />
                        Move Next to Boarding
                    </Button>
                ) : !readOnly && onClockIn ? (
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 rounded-full"
                        onClick={(e) => {
                            e.stopPropagation()
                            onClockIn()
                        }}
                    >
                        <Plus className="size-3.5" />
                        Clock In &amp; Start Boarding Bay
                    </Button>
                ) : null}
            </div>
        )
    }

    const capacity = entry.vehicle.seatingCapacity
    const seated = entry.seatedCount ?? 0
    const isFull = seated >= capacity
    const pct = Math.min(100, capacity > 0 ? (seated / capacity) * 100 : 0)

    return (
        <AnimatePresence mode="wait">
            <motion.div
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className={cn(
                    "rounded-lg border p-3.5 space-y-3 transition-all relative overflow-hidden",
                    isFull
                        ? "bg-emerald-500/10 border-emerald-500/30"
                        : "bg-amber-500/10 border-amber-500/20"
                )}
            >
                {/* Top row: plate, bay badge, elapsed */}
                <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                        <span className={cn(
                            "size-2 rounded-full shrink-0",
                            isFull ? "bg-emerald-500" : "bg-amber-500"
                        )} />
                        <span className="truncate text-sm font-bold font-mono">{entry.vehicle.numberPlate}</span>

                    </span>
                    <span className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                        <span className="flex items-center gap-1">
                            <ClockIcon className="size-2.5" />
                            {elapsed}
                        </span>
                        {onViewManifest && !isFull && (
                            <button
                                type="button"
                                className="text-muted-foreground/60 hover:text-foreground transition-colors"
                                title="View manifest"
                                aria-label="View manifest"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onViewManifest()
                                }}
                            >
                                <ClipboardList className="size-3" />
                            </button>
                        )}
                    </span>
                </div>

                {/* Seated count + seats left */}
                <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                        <Users className="size-3.5" />
                        {seated} / {capacity} Seated
                    </span>
                    {isFull ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
                            <PartyPopper className="size-3" />
                            Full House!
                        </span>
                    ) : (
                        <span className="text-[11px] font-semibold text-amber-500">
                            {capacity - seated} seat{capacity - seated === 1 ? "" : "s"} left
                        </span>
                    )}
                </div>

                {/* Progress bar */}
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <motion.div
                        className={cn("h-full rounded-full transition-all", isFull ? "bg-emerald-500" : "bg-amber-500")}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                </div>


                {/* Primary action row */}
                <div className="flex items-center gap-2">
                    {isFull ? (
                        <>
                            {!readOnly && onDispatch && (
                                <Button
                                    size="sm"
                                    className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full"
                                    disabled={isUpdating}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onDispatch()
                                    }}
                                >
                                    <Truck className="size-3.5" />
                                    Dispatch
                                </Button>
                            )}
                            {onViewManifest && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5 rounded-full"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onViewManifest()
                                    }}
                                >
                                    <ClipboardList className="size-3.5" />
                                    Manifest ({entry.seatedCount ?? 0})
                                </Button>
                            )}
                        </>
                    ) : (
                        <>
                            {onClick && (
                                <Button
                                    size="sm"
                                    className="flex-1 gap-1.5 bg-amber-500 hover:bg-amber-600 text-amber-950 rounded-full"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onClick()
                                    }}
                                >
                                    <UserPlus className="size-3.5" />
                                    Book Seat
                                </Button>
                            )}
                            {onViewManifest && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5 rounded-full"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onViewManifest()
                                    }}
                                >
                                    <ClipboardList className="size-3.5" />
                                    Manifest ({entry.seatedCount ?? 0})
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

// ─── Booking Sheet ──────────────────────────────────────────────────────────

// ── BookingFormValues: one new optional field ────────────────────────────
export interface BookingFormValues {
    passengerName: string
    passengerPhone: string
    seats: number
    paymentMethod: PaymentMethodType
    seatNumbers: number[]
    // Set when the clerk matched an already-paid C2B transaction instead of
    // triggering a fresh STK prompt. Only ever set when seats === 1.
    mpesaTransactionId?: string
}


interface BookingSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    side: "bottom" | "right"
    entry: QueueEntry
    fare?: number
    isSubmitting?: boolean
    onSubmit: (payload: BookingFormValues) => void
    route?: { origin: string; destination: string; id: string }
    travelDate: string
}

// ── BookingSheet: new local state ─────────────────────────────────────
function BookingSheet({ open, onOpenChange, side, entry, fare, isSubmitting, onSubmit, route, travelDate }: BookingSheetProps) {
    const capacity = entry.vehicle.seatingCapacity
    const seated = entry.seatedCount ?? 0
    const remaining = Math.max(0, capacity - seated)
    const unitFare = fare ?? 0
    const isFull = remaining === 0

    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>(PaymentMethod.MPESA)
    const [selectedSeats, setSelectedSeats] = useState<number[]>([])

    // "prompt" = normal STK push flow. "manual" = customer already paid via
    // paybill directly (C2B) — clerk searches for and matches the receipt.
    const [mpesaMode, setMpesaMode] = useState<"prompt" | "manual">("prompt")
    const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)

    const seatMapQuery = useQuery({
        queryKey: ["seat-map", route?.id, travelDate],
        queryFn: () => getBookingSeatMapRequest(route!.id, travelDate),
        enabled: open && !!route?.id,
    })

    // Only fetch once the phone number looks real, and only in manual mode —
    // no point hitting the endpoint on every keystroke.
    const normalizedPhone = phone.replace(/\D/g, "")
    const transactionsQuery = useQuery({
        queryKey: ["mpesa-transactions", normalizedPhone],
        queryFn: () => getMpesaTransactionsByPhoneRequest({ phone: normalizedPhone }),
        enabled: open && paymentMethod === PaymentMethod.MPESA && mpesaMode === "manual" && normalizedPhone.length >= 9,
    })

    const unmatchedTransactions = (transactionsQuery.data ?? []).filter(
        (t) => t.matchStatus === MpesaTransactionMatchStatus.UNMATCHED
    )

    useEffect(() => {
        if (open) {
            setName("")
            setPhone("")
            setPaymentMethod(PaymentMethod.MPESA)
            setSelectedSeats([])
            setMpesaMode("prompt")
            setSelectedTransactionId(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Reset the picked transaction whenever the search set changes, so a
    // stale selection can't survive a phone-number edit.
    useEffect(() => {
        setSelectedTransactionId(null)
    }, [normalizedPhone, mpesaMode])

    function toggleSeat(seat: number) {
        setSelectedSeats((prev) =>
            prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat]
        )
    }

    const seats = selectedSeats.length
    const total = unitFare * seats

    // Manual match ties one paid receipt to exactly one booking — cap it to
    // a single seat and require a selection before it's submittable.
    const isManualMatch = paymentMethod === PaymentMethod.MPESA && mpesaMode === "manual"
    const manualMatchValid = !isManualMatch || (seats === 1 && !!selectedTransactionId)

    const canSubmit =
        seats > 0 && phone.trim().length > 0 && !isSubmitting && !isFull && manualMatchValid

    const handleSubmit = () => {
        if (!canSubmit) return
        onSubmit({
            passengerName: name.trim(),
            passengerPhone: phone.trim(),
            seats,
            paymentMethod,
            seatNumbers: selectedSeats,
            mpesaTransactionId: isManualMatch ? selectedTransactionId! : undefined,
        })
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side={side}
                className={cn(
                    side === "bottom" && "rounded-t-xl max-h-[85vh]",
                    "flex flex-col p-0 gap-0"
                )}
            >
                {/* ── Header ───────────────────────────────────────────── */}
                <SheetHeader className="px-6 py-4 border-b space-y-0 shrink-0">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="text-base font-bold">Book Passenger</SheetTitle>
                    </div>
                </SheetHeader>

                {/* ── Form ─────────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {/* Route context card */}
                    <div className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-0.5">
                                Route
                            </p>
                            <p className="text-sm font-semibold">
                                {route ? `${route.origin} to ${route.destination}` : "—"}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-0.5">
                                Vehicle
                            </p>
                            <p className="text-sm font-mono font-bold text-primary">
                                {entry.vehicle.numberPlate}
                            </p>
                        </div>
                    </div>

                    {/* Phone / Name */}
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="passenger-phone" className="text-sm font-semibold">
                                Phone number <span className="text-destructive">*</span>
                            </Label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                                <Input
                                    id="passenger-phone"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="07XX XXX XXX"
                                    inputMode="tel"
                                    required
                                    disabled={isFull}
                                    className="pl-9"
                                />
                            </div>
                            {phone && phone.length < 10 && (
                                <p className="text-xs text-destructive/70">Please enter a valid phone number</p>
                            )}
                        </div>

                        <div className="space-y-1">
                            <Label htmlFor="passenger-name" className="text-sm font-semibold">
                                Passenger name
                            </Label>
                            <div className="relative">
                                <Users className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                                <Input
                                    id="passenger-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Optional"
                                    disabled={isFull}
                                    className="pl-9"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Seat map — required. Seat count and fare both derive
                        from how many cells are tapped below. */}
                    {!isFull && (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-semibold">
                                    Select Seats <span className="text-destructive">*</span>
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-[10px] font-medium text-primary border-primary/30 bg-primary/5">
                                        {capacity}-Seater
                                    </Badge>
                                    {selectedSeats.length > 0 && (
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:text-foreground"
                                            onClick={() => setSelectedSeats([])}
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>
                            {seatMapQuery.isLoading ? (
                                <Skeleton className="h-32 w-full rounded-xl" />
                            ) : (
                                <SeatPicker
                                    seatsTotal={seatMapQuery.data?.seatsTotal ?? capacity}
                                    takenSeatNumbers={seatMapQuery.data?.takenSeatNumbers ?? []}
                                    selectedSeats={selectedSeats}
                                    onToggle={toggleSeat}
                                />
                            )}
                        </div>
                    )}

                    {/* Fare summary — driven entirely by selection count */}
                    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                        <span className="text-xs text-muted-foreground/70">
                            {seats} seat{seats === 1 ? "" : "s"} selected (KSh {unitFare.toLocaleString()} each)
                        </span>
                        <span className="text-lg font-bold text-primary">
                            KSh {total.toLocaleString()}
                        </span>
                    </div>

                    {/* Payment method — segmented toggle */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-semibold">Payment method</Label>
                        <div className="flex gap-1 rounded-lg bg-muted p-1">
                            <button
                                type="button"
                                onClick={() => setPaymentMethod(PaymentMethod.MPESA)}
                                disabled={isFull}
                                className={cn(
                                    "flex-1 rounded-md py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50",
                                    paymentMethod === PaymentMethod.MPESA
                                        ? "bg-background text-primary shadow-sm"
                                        : "text-muted-foreground hover:bg-background/50"
                                )}
                            >
                                <Smartphone className="size-3.5" />
                                M-Pesa
                            </button>
                            <button
                                type="button"
                                onClick={() => setPaymentMethod(PaymentMethod.CASH)}
                                disabled={isFull}
                                className={cn(
                                    "flex-1 rounded-md py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50",
                                    paymentMethod === PaymentMethod.CASH
                                        ? "bg-background text-primary shadow-sm"
                                        : "text-muted-foreground hover:bg-background/50"
                                )}
                            >
                                <Wallet className="size-3.5" />
                                Cash
                            </button>
                        </div>

                        {paymentMethod === PaymentMethod.MPESA && (
                            <div className="space-y-2 pt-1">
                                <div className="flex gap-1 rounded-lg bg-muted/60 p-1">
                                    <button
                                        type="button"
                                        onClick={() => setMpesaMode("prompt")}
                                        disabled={isFull}
                                        className={cn(
                                            "flex-1 rounded-md py-1.5 text-xs font-semibold transition-all disabled:opacity-50",
                                            mpesaMode === "prompt"
                                                ? "bg-background text-primary shadow-sm"
                                                : "text-muted-foreground hover:bg-background/50"
                                        )}
                                    >
                                        Send STK Prompt
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setMpesaMode("manual")}
                                        disabled={isFull}
                                        className={cn(
                                            "flex-1 rounded-md py-1.5 text-xs font-semibold transition-all disabled:opacity-50",
                                            mpesaMode === "manual"
                                                ? "bg-background text-primary shadow-sm"
                                                : "text-muted-foreground hover:bg-background/50"
                                        )}
                                    >
                                        Already Paid (paybill)
                                    </button>
                                </div>

                                {mpesaMode === "manual" && (
                                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                                        {seats > 1 && (
                                            <p className="text-xs text-destructive/80">
                                                Matching an existing payment only works for a single seat — deselect down to one seat.
                                            </p>
                                        )}
                                        {normalizedPhone.length < 9 ? (
                                            <p className="text-xs text-muted-foreground/60">
                                                Enter the passenger's phone number above to search for their payment.
                                            </p>
                                        ) : transactionsQuery.isLoading ? (
                                            <Skeleton className="h-16 w-full rounded-md" />
                                        ) : unmatchedTransactions.length === 0 ? (
                                            <p className="text-xs text-muted-foreground/60">
                                                No unmatched M-Pesa payments found for this number.
                                            </p>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {unmatchedTransactions.map((t) => (
                                                    <MpesaTransactionOption
                                                        key={t.id}
                                                        transaction={t}
                                                        selected={selectedTransactionId === t.id}
                                                        onSelect={() => setSelectedTransactionId(t.id)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {isFull && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 rounded-lg border-2 border-red-500/20 bg-red-500/5 px-4 py-3 text-red-600 dark:text-red-400"
                        >
                            <XCircle className="size-5 shrink-0" />
                            <span className="text-sm">This vehicle is at full capacity. No more seats available.</span>
                        </motion.div>
                    )}
                </div>

                {/* ── Sticky Footer ────────────────────────────────────── */}
                <SheetFooter className="px-6 py-4 border-t shrink-0">
                    <Button
                        className="w-full h-11 gap-2"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                    >
                        {isSubmitting ? (
                            <>
                                <motion.span
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                >
                                    <span className="inline-block">⏳</span>
                                </motion.span>
                                Booking...
                            </>
                        ) : isFull ? (
                            <>
                                <XCircle className="size-4" />
                                Vehicle Full
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="size-4" />
                                Confirm Booking
                            </>
                        )}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}

// ─── Manifest Sheet ─────────────────────────────────────────────────────────

export interface ManifestSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    side: "bottom" | "right"
    entry: QueueEntry
    bookings: Booking[]
    isLoading?: boolean
    travelDate?: string
    route?: { origin: string; destination: string, id: string }
}

const MANIFEST_STATUS_STYLE: Record<BookingStatus, string> = {
    [BookingStatus.AWAITING_TRIP]: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    [BookingStatus.CONFIRMED]: "bg-primary/10 text-primary border-primary/20",
    [BookingStatus.BOARDED]: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    [BookingStatus.CANCELLED]: "bg-muted text-muted-foreground border-transparent",
    [BookingStatus.NO_SHOW]: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
}

// small helper — fare sometimes arrives as a decimal string from the API
const toNumber = (v: unknown) => Number(v) || 0

export function ManifestSheet({ open, onOpenChange, side, entry, bookings, isLoading, travelDate, route }: ManifestSheetProps) {
    const capacity = entry.vehicle.seatingCapacity
    const totalFare = bookings.reduce((sum, b) => sum + toNumber(b.fare), 0)
    const isFull = bookings.length >= capacity
    const queryClient = useQueryClient()
    const [dispatchConfirmOpen, setDispatchConfirmOpen] = useState(false)

    const manifestQueryKey = ["bookings", route?.id, travelDate,]

    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: BookingStatus }) =>
            updateBookingRequest(id, { status }),
        onMutate: async ({ id, status }) => {
            await queryClient.cancelQueries({ queryKey: manifestQueryKey })
            const previous = queryClient.getQueryData<Booking[]>(manifestQueryKey)
            queryClient.setQueryData<Booking[]>(manifestQueryKey, (old) =>
                old?.map((b) => (b.id === id ? { ...b, status } : b))
            )
            return { previous }
        },
        onError: (_err, _vars, context) => {
            queryClient.setQueryData(manifestQueryKey, context?.previous)
            toast.error("Failed to update passenger status")
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: manifestQueryKey })
        },
    })

    // No dedicated dispatch endpoint exists yet — this mirrors what the queue's
    // own advance action does (updateQueueEntryRequest → DISPATCHED), just run
    // from inside the manifest. It also bulk-boards any still-undecided
    // (CONFIRMED) bookings first, since dispatching implies "everyone who's
    // going, is in." NO_SHOW/CANCELLED bookings are left untouched.
    // NOTE: these are two separate network calls, not one atomic backend
    // transaction — if the queue-entry update fails after bookings were already
    // marked boarded, the passengers stay boarded but the vehicle stays in
    // BOARDING. Worth a real POST /queue-entries/:id/dispatch endpoint later
    // that does both server-side in one transaction.
    const dispatchMutation = useMutation({
        mutationFn: async () => {
            const undecided = bookings.filter((b) => b.status === BookingStatus.CONFIRMED)
            if (undecided.length > 0) {
                await Promise.all(
                    undecided.map((b) => updateBookingRequest(b.id, { status: BookingStatus.BOARDED }))
                )
            }
            return updateQueueEntryRequest(entry.id, { status: QueueEntryStatus.DISPATCHED })
        },
        onSuccess: () => {
            toast.success("Vehicle dispatched")
            queryClient.invalidateQueries({ queryKey: manifestQueryKey })
            queryClient.invalidateQueries({ queryKey: ["queue", route?.id, travelDate] })
            setDispatchConfirmOpen(false)
            onOpenChange(false)
        },
        onError: () => {
            toast.error("Failed to dispatch vehicle")
        },
    })

    const formattedDate = travelDate
        ? new Date(travelDate).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
        })
        : null

    const undecidedCount = bookings.filter((b) => b.status === BookingStatus.CONFIRMED).length
    const boardedCount = bookings.filter((b) => b.status === BookingStatus.BOARDED).length
    const noShowCount = bookings.filter((b) => b.status === BookingStatus.NO_SHOW).length

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent
                    side={side}
                    className={cn(
                        side === "bottom" && "rounded-t-xl max-h-[85vh]",
                        "flex flex-col px-4 sm:px-6"
                    )}
                >
                    <SheetHeader className="space-y-3 pb-3 border-b">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <SheetTitle className="flex items-center gap-2 text-base">
                                    <ClipboardList className="size-4 text-muted-foreground/70 shrink-0" />
                                    Manifest
                                </SheetTitle>
                                <p className="text-sm font-mono font-medium text-foreground/80 mt-0.5">
                                    {entry.vehicle.numberPlate}
                                </p>
                            </div>
                            {isFull ? (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ duration: 0.5, type: "spring" }}
                                >
                                    <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1 shrink-0">
                                        <PartyPopper className="size-3" />
                                        Full House
                                    </Badge>
                                </motion.div>
                            ) : (
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                    {Math.max(0, capacity - bookings.length)} seat{capacity - bookings.length === 1 ? "" : "s"} left
                                </Badge>
                            )}
                        </div>

                        {route && (
                            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                                <MapPin className="size-3.5 text-muted-foreground/50" />
                                {route.origin}
                                <span className="text-muted-foreground/40">→</span>
                                {route.destination}
                            </p>
                        )}

                        {formattedDate && (
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                                <ClockIcon className="size-3" />
                                {formattedDate}
                            </p>
                        )}

                        <div className="grid grid-cols-2 gap-2 pt-1">
                            <div className="rounded-md bg-muted/40 px-2.5 py-2">
                                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Passengers</p>
                                <p className="text-sm font-semibold mt-0.5">{bookings.length}<span className="text-muted-foreground/50 font-normal">/{capacity}</span></p>
                            </div>
                            <div className="rounded-md bg-muted/40 px-2.5 py-2">
                                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Collected</p>
                                <p className="text-sm font-semibold mt-0.5">KSh {totalFare.toLocaleString()}</p>
                            </div>
                        </div>
                    </SheetHeader>

                    {/* ── Passenger list ───────────────────────────────────── */}
                    <div className="flex-1 overflow-y-auto flex flex-col">
                        {/* Sticky column header */}
                        {!isLoading && bookings.length > 0 && (
                            <div className="flex items-center gap-3 py-2 border-b sticky top-0 bg-background z-10">
                                <div className="w-8 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide text-center shrink-0">#</div>
                                <div className="flex-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide">Passenger Info</div>
                                <div className="w-24 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide text-center shrink-0">Status</div>
                                <div className="w-16 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide text-right shrink-0">Actions</div>
                            </div>
                        )}

                        {isLoading ? (
                            <div className="space-y-2 py-2">
                                {[1, 2, 3, 4].map((i) => (
                                    <Skeleton key={i} className="h-14 w-full rounded-md" />
                                ))}
                            </div>
                        ) : bookings.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="py-16 text-center"
                            >
                                <ClipboardList className="size-8 text-muted-foreground/20 mx-auto mb-2" />
                                <p className="text-sm text-muted-foreground/60">No passengers booked yet</p>
                                <p className="text-xs text-muted-foreground/40 mt-1">Bookings will appear here</p>
                            </motion.div>
                        ) : (
                            <AnimatePresence mode="popLayout">
                                {bookings.map((b, index) => {
                                    const isPending = statusMutation.isPending && statusMutation.variables?.id === b.id
                                    const isDecided =
                                        b.status === BookingStatus.BOARDED ||
                                        b.status === BookingStatus.NO_SHOW ||
                                        b.status === BookingStatus.CANCELLED

                                    return (
                                        <motion.div
                                            key={b.id}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: index * 0.05 }}
                                            exit={{ opacity: 0, x: 20 }}
                                            className="flex items-center gap-3 min-h-[56px] py-3 border-b last:border-0 hover:bg-muted/30 transition-colors group"
                                        >
                                            {/* # */}
                                            <div className="w-8 shrink-0 text-sm font-mono text-muted-foreground/70 text-center">
                                                {String(index + 1).padStart(2, "0")}
                                            </div>

                                            {/* Passenger Info */}
                                            {/* Passenger Info */}
                                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                <span
                                                    className={cn(
                                                        "text-sm font-semibold truncate",
                                                        !b.passengerName && "italic text-foreground/70"
                                                    )}
                                                >
                                                    {b.passengerName || "Walk-in"}
                                                </span>

                                                {b.passengerPhone ? (
                                                    <a
                                                        href={`tel:${b.passengerPhone}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-[11px] font-mono text-muted-foreground/70 underline underline-offset-2 decoration-muted-foreground/30 hover:text-primary hover:decoration-primary/50 transition-colors truncate w-fit"
                                                        title="Call passenger"
                                                    >
                                                        {b.passengerPhone}
                                                    </a>
                                                ) : (
                                                    <span className="text-[11px] font-mono text-muted-foreground/50 truncate">
                                                        No Phone
                                                    </span>
                                                )}

                                                {b.seatNumber != null && (
                                                    <span className="text-[11px] text-muted-foreground/60">
                                                        Seat {b.seatNumber}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Status */}
                                            <div className="w-24 shrink-0 flex justify-center">
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        "text-[10px] h-6 px-2 whitespace-nowrap",
                                                        MANIFEST_STATUS_STYLE[b.status]
                                                    )}
                                                >
                                                    {b.status === BookingStatus.BOARDED ? (
                                                        <CheckCircle2 className="size-3 mr-1" />
                                                    ) : b.status === BookingStatus.NO_SHOW ? (
                                                        <XCircle className="size-3 mr-1" />
                                                    ) : (
                                                        <ClockIcon className="size-3 mr-1" />
                                                    )}
                                                    {b.status.replace("_", " ")}
                                                </Badge>
                                            </div>

                                            {/* Actions */}
                                            <div className="w-16 shrink-0 flex items-center justify-end">
                                                {!isDecided && (
                                                    <>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                                                            disabled={isPending}
                                                            title="Check in"
                                                            aria-label="Mark boarded"
                                                            onClick={() =>
                                                                statusMutation.mutate({ id: b.id, status: BookingStatus.BOARDED })
                                                            }
                                                        >
                                                            <CheckCircle2 className="size-4" />
                                                        </Button>
                                                        <span className="text-muted-foreground/30 text-xs select-none">|</span>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 rounded-full text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                                            disabled={isPending}
                                                            title="Mark no-show"
                                                            aria-label="Mark no-show"
                                                            onClick={() =>
                                                                statusMutation.mutate({ id: b.id, status: BookingStatus.NO_SHOW })
                                                            }
                                                        >
                                                            <XCircle className="size-4" />
                                                        </Button>
                                                    </>
                                                )}

                                                {(b.status === BookingStatus.BOARDED || b.status === BookingStatus.NO_SHOW) && (
                                                    <Button
                                                        type="button"
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 rounded-full text-muted-foreground/50 hover:text-foreground"
                                                        disabled={isPending}
                                                        title="Undo — mark confirmed again"
                                                        aria-label="Undo"
                                                        onClick={() =>
                                                            statusMutation.mutate({ id: b.id, status: BookingStatus.CONFIRMED })
                                                        }
                                                    >
                                                        <Undo2 className="size-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </motion.div>
                                    )
                                })}
                            </AnimatePresence>
                        )}
                    </div>

                    {/* ── Footer summary + dispatch ────────────────────────── */}
                    {bookings.length > 0 && (
                        <div className="border-t pt-3 -mx-6 px-6 bg-muted/20 space-y-3">
                            <div className="flex items-center justify-between py-1">
                                <div>
                                    <p className="text-xs text-muted-foreground/60">Total Passengers</p>
                                    <p className="text-base font-semibold">{bookings.length}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-muted-foreground/60">Total Revenue</p>
                                    <p className="text-base font-bold text-primary flex items-center gap-1 justify-end">
                                        <Banknote className="size-4" />
                                        KSh {totalFare.toLocaleString()}
                                    </p>
                                </div>
                            </div>

                            {entry.status === QueueEntryStatus.DISPATCHED ? (
                                <div className="flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2.5 text-xs text-muted-foreground/60">
                                    <Truck className="size-3.5" />
                                    Vehicle already dispatched
                                </div>
                            ) : (
                                <Button
                                    type="button"
                                    className="w-full h-11 gap-2 mb-3"
                                    onClick={() => setDispatchConfirmOpen(true)}
                                    disabled={dispatchMutation.isPending}
                                >
                                    <Truck className="size-4" />
                                    Dispatch Vehicle
                                </Button>
                            )}
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* ── Dispatch confirmation ───────────────────────────────── */}
            <AlertDialog open={dispatchConfirmOpen} onOpenChange={setDispatchConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Dispatch {entry.vehicle.numberPlate}?</AlertDialogTitle>
                        <AlertDialogDescription >
                            <div className="space-y-2">
                                <p>
                                    {boardedCount} boarded, {undecidedCount} awaiting, {noShowCount} no-show.
                                </p>
                                {undecidedCount > 0 && (
                                    <p>
                                        The {undecidedCount} awaiting passenger{undecidedCount === 1 ? "" : "s"} will be marked boarded automatically.
                                    </p>
                                )}
                                <p>This will remove the vehicle from the queue and cannot be undone.</p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={dispatchMutation.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault()
                                dispatchMutation.mutate()
                            }}
                            disabled={dispatchMutation.isPending}
                        >
                            {dispatchMutation.isPending ? "Dispatching…" : "Dispatch"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}


// ── small presentational helper for one transaction row ──────────────────
function MpesaTransactionOption({
    transaction,
    selected,
    onSelect,
}: {
    transaction: MpesaTransaction
    selected: boolean
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                "w-full flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors",
                selected
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-background hover:border-muted-foreground/20"
            )}
        >
            <div className="min-w-0">
                <p className="text-sm font-semibold">KSh {Number(transaction.amount).toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground/60 truncate">
                    {transaction.mpesaReceiptNumber} · {new Date(transaction.transactionTime).toLocaleString()}
                </p>
            </div>
            {selected && <CheckCircle2 className="size-4 text-primary shrink-0" />}
        </button>
    )
}