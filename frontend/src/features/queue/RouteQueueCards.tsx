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
    createBookingRequest,
    getBookingsRequest,
    PaymentMethod,
    BookingStatus,
    type PaymentMethod as PaymentMethodType,
    type Booking,
} from "@/api/bookingApi"
import { QueueClockInDialog } from "./QueueClockInDialog"
import { useElapsedTime } from "@/hooks/useElapsedTime"
import { useSaccoName } from "@/hooks/useSaccoName"
import { useVehicleManifest } from "@/hooks/useVehicleMainfest"

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

    // Card shows the vehicle currently loading — first one in the
    // BOARDING lane. If several vehicles are boarding at once, only the
    // lead one is surfaced here; the rest still count toward `boarding.length`.
    const loadingVehicle = boarding[0] as QueueEntry | undefined

    // Front-of-line waiting vehicle — the one the "advance" arrow on the
    // waiting count moves into BOARDING. Sorted by position, same ordering
    // the queue detail view uses.
    const nextWaiting = [...waiting].sort((a, b) => a.position - b.position)[0] as QueueEntry | undefined

    // Bookings for this card's loading vehicle — fetched lazily, only once
    // the manifest sheet is opened.
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

    const bookingMutation = useMutation({
        mutationFn: (payload: BookingFormValues) => {
            // One booking = one passenger/seat on this API, so a multi-seat
            // request fires one createBookingRequest per seat. The backend
            // assigns each to the currently-open trip and computes its own fare.
            const requests = Array.from({ length: payload.seats }, () =>
                createBookingRequest({
                    routeId: route.id,
                    travelDate: selectedDate,
                    passengerName: payload.passengerName || "Walk-in",
                    passengerPhone: payload.passengerPhone,
                    paymentMethod: payload.paymentMethod,
                })
            )
            return Promise.all(requests)
        },
        onSuccess: () => {
            toast.success("Booking confirmed")
            queryClient.invalidateQueries({ queryKey: queueQueryKey })
            setShowBooking(false)
        },
        onError: () => {
            toast.error("Failed to book — try again")
        },
    })

    return (
        <div className="rounded-lg border bg-card p-3 space-y-3 transition-all hover:border-muted-foreground/20 hover:shadow-sm">
            {/* Header */}
            <div
                className={cn("flex items-start justify-between gap-2", onSelectRoute && "cursor-pointer")}
                onClick={() => onSelectRoute?.(route.id)}
            >
                <div className="min-w-0">
                    <p className="truncate font-medium text-sm">
                        {route.origin} → {route.destination}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
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
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    disabled={!isToday}
                    title="Clock in a vehicle"
                    aria-label="Clock in a vehicle"
                    onClick={(e) => {
                        e.stopPropagation()
                        setShowClockIn(true)
                    }}
                >
                    <Plus className="size-4" />
                </Button>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-10 w-full rounded-md" />
                    <Skeleton className="h-4 w-2/3" />
                </div>
            ) : (
                <>
                    {/* Currently loading vehicle — click to book a passenger */}
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
                    />

                    {/* Waiting / Dispatched counts */}
                    <div className="flex items-center gap-3 text-xs pt-0.5">
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <ClockIcon className="size-3" />
                            {waiting.length} waiting
                            {isToday && nextWaiting && (
                                <button
                                    type="button"
                                    className="text-amber-600/70 dark:text-amber-400/70 hover:text-amber-600 dark:hover:text-amber-400 disabled:opacity-40 transition-colors"
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
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <Truck className="size-3" />
                            {dispatched.length} dispatched
                        </span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-auto font-mono">
                            {(entries?.length ?? 0)} total
                        </Badge>
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

// ─── Loading Vehicle Block (progress bar) ──────────────────────────────────

interface LoadingVehicleBlockProps {
    entry?: QueueEntry
    readOnly?: boolean
    isUpdating?: boolean
    onDispatch?: () => void
    onClick?: () => void
    onViewManifest?: () => void
}

function LoadingVehicleBlock({ entry, readOnly, isUpdating, onDispatch, onClick, onViewManifest }: LoadingVehicleBlockProps) {
    const elapsed = useElapsedTime(entry?.clockedInAt ?? null)

    if (!entry) {
        return (
            <div className="rounded-md border border-dashed bg-muted/20 py-3 text-center">
                <p className="text-xs text-muted-foreground/50">No vehicle boarding</p>
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
                role={onClick ? "button" : undefined}
                tabIndex={onClick ? 0 : undefined}
                onClick={onClick}
                onKeyDown={(e) => {
                    if (onClick && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault()
                        onClick()
                    }
                }}
                className={cn(
                    "rounded-md border p-2.5 space-y-1.5 transition-all relative overflow-hidden",
                    isFull
                        ? "bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-300 dark:border-emerald-700"
                        : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/30",
                    onClick && !isFull && "cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors",
                    onClick && isFull && "cursor-not-allowed"
                )}
            >
                {isFull && (
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.5, type: "spring", bounce: 0.5 }}
                        className="absolute top-1 right-1"
                    >
                        <PartyPopper className="size-4 text-emerald-500 dark:text-emerald-400 animate-bounce" />
                    </motion.div>
                )}

                <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                        <Car className="size-3 text-muted-foreground/50 shrink-0" />
                        <span className="truncate text-sm font-medium">{entry.vehicle.numberPlate}</span>
                        <span className="relative flex size-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                        </span>
                        {isFull && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1.5 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 ml-1">
                                Full
                            </Badge>
                        )}
                    </span>
                    <span className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                        <span className="flex items-center gap-1">
                            <ClockIcon className="size-2.5" />
                            {elapsed}
                        </span>
                        {onViewManifest && (
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

                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden relative">
                    <motion.div
                        className={cn("h-full rounded-full transition-all", isFull ? "bg-emerald-500" : "bg-blue-500")}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                    {isFull && (
                        <motion.div
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-300/30 to-transparent"
                            animate={{ x: ["0%", "100%"] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        />
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <span
                        className={cn(
                            "flex items-center gap-1 text-[11px] font-medium",
                            isFull ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/70"
                        )}
                    >
                        <Users className="size-3" />
                        {seated}/{capacity} seated
                        {isFull && (
                            <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ duration: 0.3, delay: 0.2 }}
                                className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-1"
                            >
                                🎉 Full!
                            </motion.span>
                        )}
                    </span>
                    <div className="flex items-center gap-1.5">
                        {!readOnly && onDispatch && (
                            <button
                                type="button"
                                className="text-blue-600/70 dark:text-blue-400/70 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-40 transition-colors"
                                disabled={isUpdating}
                                title="Dispatch this vehicle"
                                aria-label="Dispatch this vehicle"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onDispatch()
                                }}
                            >
                                <ArrowRightCircle className="size-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

// ─── Booking Sheet ──────────────────────────────────────────────────────────

export interface BookingFormValues {
    passengerName: string
    passengerPhone: string
    seats: number
    paymentMethod: PaymentMethodType
}

// ─── Booking Sheet ──────────────────────────────────────────────────────────

export interface BookingFormValues {
    passengerName: string
    passengerPhone: string
    seats: number
    paymentMethod: PaymentMethodType
}

interface BookingSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    side: "bottom" | "right"
    entry: QueueEntry
    fare?: number
    isSubmitting?: boolean
    onSubmit: (payload: BookingFormValues) => void
}

function BookingSheet({ open, onOpenChange, side, entry, fare, isSubmitting, onSubmit }: BookingSheetProps) {
    const capacity = entry.vehicle.seatingCapacity
    const seated = entry.seatedCount ?? 0
    const remaining = Math.max(0, capacity - seated)
    const unitFare = fare ?? 0
    const isFull = remaining === 0

    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [seats, setSeats] = useState(1)
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>(PaymentMethod.CASH)

    // Reset the form each time the sheet is opened for a fresh booking
    useEffect(() => {
        if (open) {
            setName("")
            setPhone("")
            setSeats(remaining > 0 ? 1 : 0)
            setPaymentMethod(PaymentMethod.CASH)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const total = unitFare * seats
    // passengerPhone is required by the booking API — name can fall back to
    // "Walk-in" (handled in the mutation), phone can't.
    const canSubmit = seats > 0 && seats <= remaining && phone.trim().length > 0 && !isSubmitting && !isFull

    const handleSubmit = () => {
        if (!canSubmit) return
        onSubmit({
            passengerName: name.trim(),
            passengerPhone: phone.trim(),
            seats,
            paymentMethod,
        })
    }

    const handleCall = () => {
        if (entry.vehicle?.driverPhone) {
            window.location.href = `tel:${entry.vehicle.driverPhone}`
        }
    }

    // Quick seat presets
    const seatPresets = [1, 2, 3, 4].filter(n => n <= remaining)

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side={side}
                className={cn(
                    side === "bottom" && "rounded-t-xl max-h-[85vh]",
                    "flex flex-col px-6" // ← add horizontal padding here
                )}
            >
                <SheetHeader className="space-y-2">
                    <SheetTitle className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                            <UserPlus className="size-4 text-muted-foreground/70" />
                            Book a seat
                        </span>
                        {isFull && (
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ duration: 0.5, type: "spring" }}
                            >
                                <Badge className="bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30 gap-1">
                                    <XCircle className="size-3" />
                                    Full
                                </Badge>
                            </motion.div>
                        )}
                    </SheetTitle>
                    <SheetDescription className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <span>{remaining} seat{remaining === 1 ? "" : "s"} left · {seated}/{capacity} seated</span>
                            {!isFull && (
                                <Badge variant="outline" className="text-[10px] h-5 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                                    {remaining} available
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground/60 flex-wrap">

                        </div>
                    </SheetDescription>
                </SheetHeader>

                <div className="flex-1 space-y-4 py-4 overflow-y-auto">
                    <div className="space-y-1.5">
                        <Label htmlFor="passenger-name" className="flex items-center gap-2">
                            Passenger name
                            <span className="text-xs text-muted-foreground/50">(optional)</span>
                        </Label>
                        <div className="relative">
                            <Users className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                            <Input
                                id="passenger-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Walk-in passenger"
                                className="pl-9 transition-all focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="passenger-phone" className="flex items-center gap-2">
                            Phone number
                            <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                            <Input
                                id="passenger-phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="07xx xxx xxx"
                                inputMode="tel"
                                required
                                className="pl-9 transition-all focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                        {phone && phone.length < 10 && phone.length > 0 && (
                            <p className="text-xs text-destructive/70">Please enter a valid phone number</p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="seat-count">Number of seats</Label>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 shrink-0 transition-all hover:scale-105 disabled:opacity-50"
                                onClick={() => setSeats((s) => Math.max(1, s - 1))}
                                disabled={seats <= 1 || isFull}
                            >
                                −
                            </Button>
                            <Input
                                id="seat-count"
                                type="number"
                                min={1}
                                max={remaining}
                                value={seats}
                                onChange={(e) => {
                                    const val = Number(e.target.value)
                                    if (!Number.isNaN(val)) setSeats(Math.min(remaining, Math.max(1, val)))
                                }}
                                className="text-center transition-all focus:ring-2 focus:ring-primary/20"
                                disabled={isFull}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 shrink-0 transition-all hover:scale-105 disabled:opacity-50"
                                onClick={() => setSeats((s) => Math.min(remaining, s + 1))}
                                disabled={seats >= remaining || isFull}
                            >
                                +
                            </Button>
                        </div>
                        {seatPresets.length > 0 && (
                            <div className="flex gap-1 mt-1.5">
                                {seatPresets.map((num) => (
                                    <Button
                                        key={num}
                                        type="button"
                                        variant={seats === num ? "default" : "outline"}
                                        size="sm"
                                        className="h-7 px-2 text-xs flex-1 transition-all hover:scale-105"
                                        onClick={() => setSeats(num)}
                                        disabled={isFull}
                                    >
                                        {num}
                                    </Button>
                                ))}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground/50">
                            {isFull ? (
                                <span className="text-red-500/70">This vehicle is fully booked</span>
                            ) : (
                                `Available: ${remaining} seat${remaining === 1 ? "" : "s"}`
                            )}
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Payment method</Label>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant={paymentMethod === PaymentMethod.CASH ? "default" : "outline"}
                                className={cn(
                                    "gap-1.5 transition-all hover:scale-[1.02]",
                                    paymentMethod === PaymentMethod.CASH && "ring-2 ring-primary/20"
                                )}
                                onClick={() => setPaymentMethod(PaymentMethod.CASH)}
                                disabled={isFull}
                            >
                                <Wallet className="size-3.5" />
                                Cash
                            </Button>
                            <Button
                                type="button"
                                variant={paymentMethod === PaymentMethod.MPESA ? "default" : "outline"}
                                className={cn(
                                    "gap-1.5 transition-all hover:scale-[1.02]",
                                    paymentMethod === PaymentMethod.MPESA && "ring-2 ring-primary/20"
                                )}
                                onClick={() => setPaymentMethod(PaymentMethod.MPESA)}
                                disabled={isFull}
                            >
                                <Smartphone className="size-3.5" />
                                M-PESA
                            </Button>
                        </div>
                    </div>

                    {!isFull && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center justify-between rounded-lg border-2 border-primary/10 bg-gradient-to-r from-primary/5 to-primary/10 px-4 py-3"
                        >
                            <span className="text-sm text-muted-foreground">Estimated total</span>
                            <span className="flex items-center gap-1 text-lg font-bold text-primary">
                                <Banknote className="size-4" />
                                KSh {total.toLocaleString()}
                            </span>
                        </motion.div>
                    )}

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

                <SheetFooter className="flex flex-col gap-2">
                    {!isFull && entry.vehicle.driverPhone && (
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full gap-2 transition-all hover:scale-[1.02]"
                            onClick={handleCall}
                        >
                            <PhoneCall className="size-4" />
                            Call Driver
                        </Button>
                    )}
                    <Button
                        className={cn(
                            "w-full gap-2 transition-all",
                            !isFull && "hover:scale-[1.02]"
                        )}
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
                                <Sparkles className="size-4" />
                                Book {seats} seat{seats === 1 ? "" : "s"}
                            </>
                        )}
                    </Button>
                    {!isFull && phone.trim().length > 0 && seats > 0 && seats <= remaining && (
                        <p className="text-center text-[10px] text-muted-foreground/50">
                            {seats} passenger{seats === 1 ? "" : "s"} will be booked for {entry.vehicle.numberPlate}
                        </p>
                    )}
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
    route?: { origin: string; destination: string } // ← new
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
    console.log(route, 33333333333333333)

    const formattedDate = travelDate
        ? new Date(travelDate).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
        })
        : null

    const handleCall = (phone: string) => {
        if (phone) {
            window.location.href = `tel:${phone}`
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side={side}
                className={cn(
                    side === "bottom" && "rounded-t-xl max-h-[85vh]",
                    "flex flex-col"
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

                    {/* Route */}
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

                    {/* Stat row */}
                    <div className="grid grid-cols-3 gap-2 pt-1">
                        <div className="rounded-md bg-muted/40 px-2.5 py-2">
                            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Passengers</p>
                            <p className="text-sm font-semibold mt-0.5">{bookings.length}<span className="text-muted-foreground/50 font-normal">/{capacity}</span></p>
                        </div>
                        <div className="rounded-md bg-muted/40 px-2.5 py-2">
                            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Collected</p>
                            <p className="text-sm font-semibold mt-0.5">KSh {totalFare.toLocaleString()}</p>
                        </div>
                        <div className="rounded-md bg-muted/40 px-2.5 py-2">
                            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Driver</p>
                            <p className="text-sm font-semibold mt-0.5 truncate">{entry.vehicle.driverName || "—"}</p>
                        </div>
                    </div>
                </SheetHeader>

                {/* ── Passenger list ───────────────────────────────────── */}
                <div className="flex-1 py-4 space-y-2 overflow-y-auto">
                    {isLoading ? (
                        <>
                            {[1, 2, 3, 4].map((i) => (
                                <Skeleton key={i} className="h-16 w-full rounded-md" />
                            ))}
                        </>
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
                                const fare = toNumber(b.fare)
                                return (
                                    <motion.div
                                        key={b.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        className="rounded-lg border p-3 space-y-1.5 hover:bg-muted/30 transition-colors group"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="flex items-center justify-center size-5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground/70 shrink-0">
                                                        {index + 1}
                                                    </span>
                                                    <span className="truncate text-sm font-medium">
                                                        {b.passengerName || "Walk-in"}
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className={cn(
                                                            "text-[9px] h-4 px-1.5 shrink-0",
                                                            MANIFEST_STATUS_STYLE[b.status]
                                                        )}
                                                    >
                                                        {b.status === BookingStatus.BOARDED ? (
                                                            <CheckCircle2 className="size-2.5 mr-0.5" />
                                                        ) : b.status === BookingStatus.NO_SHOW ? (
                                                            <XCircle className="size-2.5 mr-0.5" />
                                                        ) : null}
                                                        {b.status.replace("_", " ")}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 pl-7">
                                                    <span className="flex items-center gap-1">
                                                        <Phone className="size-2.5 shrink-0" />
                                                        <span className="truncate">{b.passengerPhone || "—"}</span>
                                                    </span>
                                                    {b.seatNumber != null && (
                                                        <span className="flex items-center gap-1">
                                                            <span className="size-1 rounded-full bg-muted-foreground/30" />
                                                            Seat {b.seatNumber}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="flex items-center gap-1 text-xs font-medium">
                                                    {b.paymentMethod === PaymentMethod.MPESA ? (
                                                        <Smartphone className="size-3 text-green-600 dark:text-green-400" />
                                                    ) : (
                                                        <Wallet className="size-3 text-amber-600 dark:text-amber-400" />
                                                    )}
                                                    KSh {fare.toLocaleString()}
                                                </span>
                                                {b.passengerPhone && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => handleCall(b.passengerPhone!)}
                                                        title="Call passenger"
                                                    >
                                                        <PhoneCall className="size-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </AnimatePresence>
                    )}
                </div>

                {/* ── Footer summary ───────────────────────────────────── */}
                {bookings.length > 0 && (
                    <div className="border-t pt-3 -mx-6 px-6 bg-muted/20">
                        <div className="flex items-center justify-between py-3">
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
                    </div>
                )}
            </SheetContent>
        </Sheet>
    )
}