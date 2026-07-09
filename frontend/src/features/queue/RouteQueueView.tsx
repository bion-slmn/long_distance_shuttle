// src/features/queue/RouteQueueView.tsx
import { useState, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    Plus,
    Car,
    Clock,
    Calendar,
    MoreVertical,
    LogOut,
    ArrowRight,
    Route as RouteIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import {
    getQueueEntriesRequest,
    updateQueueEntryRequest,
    removeVehicleFromQueueRequest,
    getRouteRequest,
    QueueStatus,
    type RouteQueueEntry,
} from "@/api/routeApi"
import { RouteCombobox } from "@/features/routes/RouteCombobox"
import { QueueClockInDialog } from "./QueueClockInDialog"
import { useElapsedTime } from "@/hooks/useElapsedTime"

interface RouteQueueViewProps {
    routeId?: string
    onRouteChange?: (routeId: string) => void
    className?: string
}

const LANES: { status: QueueStatus; label: string }[] = [
    { status: QueueStatus.WAITING, label: "Waiting" },
    { status: QueueStatus.BOARDING, label: "Boarding" },
    { status: QueueStatus.DISPATCHED, label: "Dispatched" },
]

// What tapping the primary action does, per current status
const NEXT_STATUS: Partial<Record<QueueStatus, QueueStatus>> = {
    [QueueStatus.WAITING]: QueueStatus.BOARDING,
    [QueueStatus.BOARDING]: QueueStatus.DISPATCHED,
}

const NEXT_ACTION_LABEL: Partial<Record<QueueStatus, string>> = {
    [QueueStatus.WAITING]: "Start Boarding",
    [QueueStatus.BOARDING]: "Dispatch",
}

// Soft background colors per status — applied to both the lane container and its cards
const LANE_STYLES: Record<QueueStatus, { laneBg: string; cardBg: string }> = {
    [QueueStatus.WAITING]: {
        laneBg: "bg-amber-500/5 border-amber-500/20",
        cardBg: "bg-amber-500/10 border-amber-500/20",
    },
    [QueueStatus.BOARDING]: {
        laneBg: "bg-blue-500/5 border-blue-500/20",
        cardBg: "bg-blue-500/10 border-blue-500/20",
    },
    [QueueStatus.DISPATCHED]: {
        laneBg: "bg-emerald-500/5 border-emerald-500/20",
        cardBg: "bg-emerald-500/10 border-emerald-500/20",
    },
}

// Today's date as YYYY-MM-DD, used as the date input's default value and max bound
function todayIso() {
    const d = new Date()
    return d.toISOString().slice(0, 10)
}

export function RouteQueueView({ routeId, onRouteChange, className }: RouteQueueViewProps) {
    const [internalRouteId, setInternalRouteId] = useState<string | undefined>(routeId)
    const [showClockIn, setShowClockIn] = useState(false)
    const [selectedDate, setSelectedDate] = useState<string>(todayIso())

    const selectedRouteId = routeId ?? internalRouteId
    const isToday = selectedDate === todayIso()

    const handleRouteChange = (id: string) => {
        setInternalRouteId(id)
        onRouteChange?.(id)
    }

    const queryClient = useQueryClient()

    const { data: route } = useQuery({
        queryKey: ["routes", "detail", selectedRouteId],
        queryFn: () => getRouteRequest(selectedRouteId!),
        enabled: !!selectedRouteId,
    })

    const queueQueryKey = ["queue", selectedRouteId, selectedDate]

    const { data: entries, isLoading } = useQuery({
        queryKey: queueQueryKey,
        queryFn: () => getQueueEntriesRequest({ routeId: selectedRouteId, date: selectedDate }),
        enabled: !!selectedRouteId,
        // Only poll for live updates when viewing today — a past date's queue is historical
        refetchInterval: isToday ? 15_000 : false,
    })

    const advanceMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: QueueStatus }) =>
            updateQueueEntryRequest(id, { status }),
        onMutate: async ({ id, status }) => {
            await queryClient.cancelQueries({ queryKey: queueQueryKey })
            const previous = queryClient.getQueryData<RouteQueueEntry[]>(queueQueryKey)

            queryClient.setQueryData<RouteQueueEntry[]>(queueQueryKey, (old) =>
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

    const removeMutation = useMutation({
        mutationFn: (id: string) => removeVehicleFromQueueRequest(id),
        onSuccess: () => {
            toast.success("Vehicle removed from queue")
            queryClient.invalidateQueries({ queryKey: queueQueryKey })
        },
        onError: () => {
            toast.error("Failed to remove vehicle from queue")
        },
    })

    const lanes = useMemo(() => {
        const grouped: Record<QueueStatus, RouteQueueEntry[]> = {
            [QueueStatus.WAITING]: [],
            [QueueStatus.BOARDING]: [],
            [QueueStatus.DISPATCHED]: [],
        }
        entries?.forEach((entry) => {
            grouped[entry.status]?.push(entry)
        })
        return grouped
    }, [entries])

    if (!selectedRouteId) {
        return (
            <div className={cn("space-y-3", className)}>
                <RouteCombobox value={selectedRouteId} onChange={handleRouteChange} />
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
                    <RouteIcon className="size-5 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Select a route to view its queue</p>
                </div>
            </div>
        )
    }

    return (
        <div className={cn("space-y-4", className)}>
            {/* Route selector + header */}
            <div className="space-y-3">
                <RouteCombobox value={selectedRouteId} onChange={handleRouteChange} />

                {route && (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <p className="text-sm font-medium">
                                {route.origin} → {route.destination}
                            </p>
                            {route.stages?.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    via {route.stages.join(", ")}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50 pointer-events-none" />
                                <Input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    max={todayIso()}
                                    className="h-8 pl-7 text-xs w-36"
                                    aria-label="Filter queue by date"
                                />
                            </div>
                            {!isToday && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                                    Viewing past day
                                </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                                {lanes[QueueStatus.WAITING].length} waiting · {lanes[QueueStatus.BOARDING].length} boarding
                            </span>
                            <Button
                                size="sm"
                                onClick={() => setShowClockIn(true)}
                                className="gap-1.5"
                                disabled={!isToday}
                            >
                                <Plus className="size-3.5" />
                                Clock In
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Three-lane board */}
            {isLoading ? (
                <QueueBoardSkeleton />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {LANES.map((lane) => (
                        <QueueLane
                            key={lane.status}
                            label={lane.label}
                            status={lane.status}
                            entries={lanes[lane.status]}
                            onAdvance={(entry) => {
                                const next = NEXT_STATUS[entry.status]
                                if (next) advanceMutation.mutate({ id: entry.id, status: next })
                            }}
                            onRemove={(entry) => removeMutation.mutate(entry.id)}
                            isUpdating={advanceMutation.isPending}
                            readOnly={!isToday}
                        />
                    ))}
                </div>
            )}

            <QueueClockInDialog
                routeId={selectedRouteId}
                open={showClockIn}
                onOpenChange={setShowClockIn}
            />
        </div>
    )
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

interface QueueLaneProps {
    label: string
    status: QueueStatus
    entries: RouteQueueEntry[]
    onAdvance: (entry: RouteQueueEntry) => void
    onRemove: (entry: RouteQueueEntry) => void
    isUpdating?: boolean
    readOnly?: boolean
}

function QueueLane({ label, status, entries, onAdvance, onRemove, isUpdating, readOnly }: QueueLaneProps) {
    const styles = LANE_STYLES[status]

    return (
        <div className={cn("rounded-lg border p-3 space-y-2", styles.laneBg)}>
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                </p>
                <span className="text-xs text-muted-foreground bg-background px-1.5 py-0.5 rounded-full border">
                    {entries.length}
                </span>
            </div>

            {entries.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 text-center py-6">No vehicles</p>
            ) : (
                <div className="space-y-2">
                    {entries.map((entry, index) => (
                        <QueueCard
                            key={entry.id}
                            entry={entry}
                            position={status === QueueStatus.WAITING ? index + 1 : undefined}
                            onAdvance={() => onAdvance(entry)}
                            onRemove={() => onRemove(entry)}
                            isUpdating={isUpdating}
                            readOnly={readOnly}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

interface QueueCardProps {
    entry: RouteQueueEntry
    position?: number
    onAdvance: () => void
    onRemove: () => void
    isUpdating?: boolean
    readOnly?: boolean
}

function QueueCard({ entry, position, onAdvance, onRemove, isUpdating, readOnly }: QueueCardProps) {
    const elapsed = useElapsedTime(entry.clockedInAt)
    const nextLabel = NEXT_ACTION_LABEL[entry.status]
    const styles = LANE_STYLES[entry.status]
    const isInactive = entry.vehicle.status !== "ACTIVE"

    return (
        <div className={cn("rounded-md border px-2 py-1.5 flex items-center gap-2", styles.cardBg)}>
            {position !== undefined && (
                <span className="shrink-0 text-[10px] font-semibold text-muted-foreground bg-muted rounded-full size-4 flex items-center justify-center">
                    {position}
                </span>
            )}

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{entry.vehicle.numberPlate}</p>
                    {isInactive && (
                        <span className="shrink-0 size-1.5 rounded-full bg-amber-500" title={entry.vehicle.status} />
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground">Added {elapsed} · {entry.vehicle.seatingCapacity} seats</p>
            </div>

            {!readOnly && nextLabel && (
                <Button
                    size="icon"
                    variant="secondary"
                    className="h-6 w-6 shrink-0"
                    onClick={onAdvance}
                    disabled={isUpdating}
                    aria-label={nextLabel}
                >
                    <ArrowRight className="size-3.5" />
                </Button>
            )}

            {!readOnly && (
                <DropdownMenu>
                    <DropdownMenuTrigger>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground/50">
                            <MoreVertical className="size-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={onRemove} className="text-destructive">
                            <LogOut className="size-3.5 mr-2" />
                            Remove from queue
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    )
}

function QueueBoardSkeleton() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-16 w-full rounded-md" />
                    <Skeleton className="h-16 w-full rounded-md" />
                </div>
            ))}
        </div>
    )
}