// src/features/queue/ManifestSheet.tsx
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
    Clock as ClockIcon,
    Truck,
    Banknote,
    ClipboardList,
    Phone,
    CheckCircle2,
    XCircle,
    PartyPopper,
    MapPin,
    Undo2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
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
import { cn } from "@/lib/utils"
import { invalidateQueues } from "@/hooks/useRouteQueues"

import {
    updateQueueEntryRequest,
    QueueEntryStatus,
    type QueueEntry,
} from "@/api/routeApi"
import {
    BookingStatus,
    type Booking,
    updateBookingRequest,
} from "@/api/bookingApi"

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
            invalidateQueues(queryClient)
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
                                <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1 shrink-0 animate-in zoom-in-50 duration-500">
                                    <PartyPopper className="size-3" />
                                    Full House
                                </Badge>
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
                            <div className="py-16 text-center animate-in fade-in duration-300">
                                <ClipboardList className="size-8 text-muted-foreground/20 mx-auto mb-2" />
                                <p className="text-sm text-muted-foreground/60">No passengers booked yet</p>
                                <p className="text-xs text-muted-foreground/40 mt-1">Bookings will appear here</p>
                            </div>
                        ) : (
                            <>
                                {bookings.map((b, index) => {
                                    const isPending = statusMutation.isPending && statusMutation.variables?.id === b.id
                                    const isDecided =
                                        b.status === BookingStatus.BOARDED ||
                                        b.status === BookingStatus.NO_SHOW ||
                                        b.status === BookingStatus.CANCELLED

                                    return (
                                        <div
                                            key={b.id}
                                            // Staggered entrance, CSS-only. The delay is the one
                                            // thing framer gave us here that a utility class can't.
                                            style={{ animationDelay: `${Math.min(index, 10) * 50}ms` }}
                                            className="flex items-center gap-3 min-h-[56px] py-3 border-b last:border-0 hover:bg-muted/30 transition-colors group animate-in fade-in slide-in-from-left-4 fill-mode-backwards duration-300"
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
                                        </div>
                                    )
                                })}
                            </>
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
