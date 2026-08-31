// src/features/queue/RouteQueueCards.tsx
import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
    ClipboardList,
    PartyPopper,
    RefreshCw,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import {
    updateQueueEntryRequest,
    QueueEntryStatus,
    type QueueEntry,
} from "@/api/routeApi"
import {
    PaymentMethod,
    BookingSource,
    createBookingByClerkRequest,
    type Booking,
} from "@/api/bookingApi"
import { QueueClockInDialog } from "./QueueClockInDialog"
import { BookingSheet, type BookingFormValues } from "./BookingSheet"
import { MpesaPaymentDialog } from "./MpesaPaymentDialog"
import { ManifestSheet } from "./ManifestSheet"
import { useElapsedTime } from "@/hooks/useElapsedTime"
import { useSaccoNames } from "@/hooks/useSaccoNames"
import { invalidateQueues } from "@/hooks/useRouteQueues"
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
    // Queue data is owned by the caller so that filtering the routes list
    // (search, sacco filter) never re-issues a request — one batched query
    // covers every route and the filtering happens in memory.
    entriesByRoute: Map<string, QueueEntry[]>
    isLoading: boolean
    isFetching?: boolean
    onRefresh?: () => void
    selectedDate: string
    isToday: boolean
    onSelectRoute?: (routeId: string) => void
    className?: string
}

export function RouteQueueCards({
    routes,
    entriesByRoute,
    isLoading,
    isFetching,
    onRefresh,
    selectedDate,
    isToday,
    onSelectRoute,
    className,
}: RouteQueueCardsProps) {
    // One request for every sacco name on screen. The cards are pure
    // consumers — no card issues a fetch of its own, so the grid costs the
    // same number of round trips whether it shows 3 routes or 30.
    const saccoNames = useSaccoNames()

    const sortedRoutes = [...routes].sort((a, b) => {
        const metaA = getSortMeta(entriesByRoute.get(a.id))
        const metaB = getSortMeta(entriesByRoute.get(b.id))

        // 1. Boarding vehicles bubble to the top
        if (metaA.hasBoarding !== metaB.hasBoarding) {
            return metaA.hasBoarding ? -1 : 1
        }
        // 2. Among boarding vehicles, fewest remaining seats first —
        //    i.e. the ones closest to full/ready to dispatch surface first
        return metaA.remainingSeats - metaB.remainingSeats
    })

    return (
        <div className={cn("space-y-3", className)}>
            {/* Nothing polls any more — this is how the clerk pulls fresh data
                on demand without paying for a background request every 15s. */}
            {isToday && onRefresh && (
                <div className="flex justify-end">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-muted-foreground"
                        disabled={isFetching}
                        onClick={onRefresh}
                    >
                        <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
                        {isFetching ? "Refreshing..." : "Refresh"}
                    </Button>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedRoutes.map((route) => (
                    <RouteQueueCard
                        key={route.id}
                        route={route}
                        entries={entriesByRoute.get(route.id)}
                        isLoading={isLoading}
                        saccoName={saccoNames.get(route.saccoId)}
                        selectedDate={selectedDate}
                        isToday={isToday}
                        onSelectRoute={onSelectRoute}
                    />
                ))}
            </div>
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
    // Queue data comes from the parent's single batched query — the card
    // never fetches for itself.
    entries?: QueueEntry[]
    isLoading: boolean
    saccoName?: string
    selectedDate: string
    isToday: boolean
    onSelectRoute?: (routeId: string) => void
}

function RouteQueueCard({
    route,
    entries,
    isLoading,
    saccoName,
    selectedDate,
    isToday,
    onSelectRoute,
}: RouteQueueCardProps) {
    const [showClockIn, setShowClockIn] = useState(false)
    const [showBooking, setShowBooking] = useState(false)
    const [showManifest, setShowManifest] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    // The STK prompt runs in a dialog over the grid rather than inside the
    // booking sheet, so the clerk can still see the queue while it's pending.
    const [awaitingBooking, setAwaitingBooking] = useState<Booking | null>(null)
    // Set when a failed payment is being retried — reopens the sheet against
    // the existing booking row instead of creating a second seat claim.
    const [retryBooking, setRetryBooking] = useState<Booking | null>(null)
    const queryClient = useQueryClient()

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

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

    // The queue now lives in one batched cache entry shared by every card, so
    // optimistic writes and rollbacks address it by prefix rather than by a
    // key this card owns.
    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: QueueEntryStatus }) =>
            updateQueueEntryRequest(id, { status }),
        onMutate: async ({ id, status }) => {
            await queryClient.cancelQueries({ queryKey: ["queue"] })
            const previous = queryClient.getQueriesData<QueueEntry[]>({ queryKey: ["queue"] })
            queryClient.setQueriesData<QueueEntry[]>({ queryKey: ["queue"] }, (old) =>
                old?.map((e) => (e.id === id ? { ...e, status } : e))
            )
            return { previous }
        },
        onError: (_err, _vars, context) => {
            context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data))
            toast.error("Failed to update queue status")
        },
        onSuccess: () => {
            invalidateQueues(queryClient)
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
        onSuccess: (bookings, payload) => {
            invalidateQueues(queryClient)
            queryClient.invalidateQueries({ queryKey: seatMapQueryKey })

            // Prompt-mode M-Pesa isn't confirmed yet: close the sheet and hand
            // over to the payment dialog, which polls and then shows the
            // receipt. Cash and Paybill/Till (manual match) are final the
            // moment the record exists, so those just close.
            const isPromptFlow =
                payload.paymentMethod === PaymentMethod.MPESA && !payload.mpesaTransactionId

            setShowBooking(false)
            setRetryBooking(null)

            if (isPromptFlow && bookings[0]) {
                setAwaitingBooking(bookings[0])
            } else {
                toast.success("Booking confirmed")
            }
        },
        onError: () => {
            toast.error("Failed to book — try again")
        },
    })

    return (
        <div className="rounded-xl border bg-card p-4 space-y-3 transition-colors hover:border-muted-foreground/20">
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
                // Nothing loading on this route means the clerk is almost
                // certainly clocking in the vehicle that should start taking
                // passengers now — the dialog offers that in the same request.
                bayIsEmpty={!loadingVehicle}
            />

            {awaitingBooking && (
                <MpesaPaymentDialog
                    open={!!awaitingBooking}
                    onOpenChange={(next) => !next && setAwaitingBooking(null)}
                    booking={awaitingBooking}
                    route={route}
                    travelDate={selectedDate}
                    onRetry={(booking) => {
                        setAwaitingBooking(null)
                        setRetryBooking(booking)
                        setShowBooking(true)
                    }}
                />
            )}

            {loadingVehicle && (
                <>
                    <BookingSheet
                        open={showBooking}
                        onOpenChange={(next) => {
                            setShowBooking(next)
                            if (!next) setRetryBooking(null)
                        }}
                        side={isMobile ? "bottom" : "right"}
                        entry={loadingVehicle}
                        fare={route.fare}
                        isSubmitting={bookingMutation.isPending}
                        onSubmit={(payload) => bookingMutation.mutateAsync(payload)}
                        route={route}
                        travelDate={selectedDate}
                        retryBooking={retryBooking}
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
                        Clock In &amp; Start Boarding
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
        <div
            className={cn(
                "rounded-lg border p-3.5 space-y-3 transition-colors relative overflow-hidden",
                "animate-in fade-in slide-in-from-bottom-2 duration-300",
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
                    <div
                        className={cn(
                            "h-full rounded-full transition-[width] duration-500 ease-out",
                            isFull ? "bg-emerald-500" : "bg-amber-500"
                        )}
                        style={{ width: `${pct}%` }}
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
        </div>
    )
}

