// src/features/queue/RouteQueueView.tsx
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import {
    Plus,
    Car,
    Clock,
    Calendar as CalendarIcon,
    MoreVertical,
    LogOut,
    ArrowRight,
    Route as RouteIcon,
    Users,
    CheckCircle,
    Clock as ClockIcon,
    Truck,
    ArrowRightCircle,
    ArrowLeftCircle,
    XCircle,
    AlertTriangle,
    Search,
    ChevronRight,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

import {
    getQueueEntriesRequest,
    updateQueueEntryRequest,
    removeVehicleFromQueueRequest,
    getRouteRequest,
    getRoutesRequest,
    QueueEntryStatus,
    type QueueEntry,
} from "@/api/routeApi"
import { RouteCombobox } from "@/features/routes/RouteCombobox"
import { QueueClockInDialog } from "./QueueClockInDialog"
import { useElapsedTime } from "@/hooks/useElapsedTime"

interface RouteQueueViewProps {
    routeId?: string
    onRouteChange?: (routeId: string) => void
    className?: string
}

const LANES: { status: QueueEntryStatus; label: string; icon: any; color: string; bg: string; border: string }[] = [
    {
        status: QueueEntryStatus.WAITING,
        label: "Waiting",
        icon: ClockIcon,
        color: "text-amber-600 dark:text-amber-400",
        bg: "bg-amber-50 dark:bg-amber-950/30",
        border: "border-amber-200 dark:border-amber-800/30",
    },
    {
        status: QueueEntryStatus.BOARDING,
        label: "Boarding",
        icon: Users,
        color: "text-blue-600 dark:text-blue-400",
        bg: "bg-blue-50 dark:bg-blue-950/30",
        border: "border-blue-200 dark:border-blue-800/30",
    },
    {
        status: QueueEntryStatus.DISPATCHED,
        label: "Dispatched",
        icon: Truck,
        color: "text-emerald-600 dark:text-emerald-400",
        bg: "bg-emerald-50 dark:bg-emerald-950/30",
        border: "border-emerald-200 dark:border-emerald-800/30",
    },
]

const NEXT_STATUS: Partial<Record<QueueEntryStatus, QueueEntryStatus>> = {
    [QueueEntryStatus.WAITING]: QueueEntryStatus.BOARDING,
    [QueueEntryStatus.BOARDING]: QueueEntryStatus.DISPATCHED,
}

const PREV_STATUS: Partial<Record<QueueEntryStatus, QueueEntryStatus>> = {
    [QueueEntryStatus.BOARDING]: QueueEntryStatus.WAITING,
    [QueueEntryStatus.DISPATCHED]: QueueEntryStatus.BOARDING,
}

function todayIso() {
    const d = new Date()
    return d.toISOString().slice(0, 10)
}

export function RouteQueueView({ routeId, onRouteChange, className }: RouteQueueViewProps) {
    const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>(routeId)
    const [showClockIn, setShowClockIn] = useState(false)
    const [selectedDate, setSelectedDate] = useState<string>(todayIso())
    const [dateOpen, setDateOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const [entryToRemove, setEntryToRemove] = useState<QueueEntry | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

    const isToday = selectedDate === todayIso()

    const handleRouteChange = (id: string) => {
        setSelectedRouteId(id)
        onRouteChange?.(id)
    }

    const handleBackToDashboard = () => {
        setSelectedRouteId(undefined)
        onRouteChange?.("")
    }

    const queryClient = useQueryClient()

    // Fetch all routes for the dashboard
    const { data: allRoutes, isLoading: routesLoading } = useQuery({
        queryKey: ["routes", "all"],
        queryFn: getRoutesRequest,
        staleTime: 5 * 60 * 1000,
    })

    // Fetch queue entries for the selected route
    const { data: route } = useQuery({
        queryKey: ["routes", "detail", selectedRouteId],
        queryFn: () => getRouteRequest(selectedRouteId!),
        enabled: !!selectedRouteId,
    })

    const queueQueryKey = ["queue", selectedRouteId, selectedDate]

    const { data: entries, isLoading: queueLoading } = useQuery({
        queryKey: queueQueryKey,
        queryFn: () => getQueueEntriesRequest({ routeId: selectedRouteId, date: selectedDate }),
        enabled: !!selectedRouteId,
        refetchInterval: isToday ? 15_000 : false,
    })

    // Fetch queue counts for all routes (dashboard view)
    const { data: allQueueData, isLoading: countsLoading } = useQuery({
        queryKey: ["queue", "all", "counts", selectedDate],
        queryFn: async () => {
            if (!allRoutes) return []

            const counts = await Promise.all(
                allRoutes.map(async (route) => {
                    try {
                        const entries = await getQueueEntriesRequest({
                            routeId: route.id,
                            date: selectedDate
                        })
                        return {
                            routeId: route.id,
                            waiting: entries.filter(e => e.status === QueueEntryStatus.WAITING).length,
                            boarding: entries.filter(e => e.status === QueueEntryStatus.BOARDING).length,
                            dispatched: entries.filter(e => e.status === QueueEntryStatus.DISPATCHED).length,
                            total: entries.length,
                        }
                    } catch {
                        return {
                            routeId: route.id,
                            waiting: 0,
                            boarding: 0,
                            dispatched: 0,
                            total: 0,
                        }
                    }
                })
            )
            return counts
        },
        enabled: !!allRoutes && !selectedRouteId,
        staleTime: 30 * 1000,
        refetchInterval: isToday ? 30_000 : false,
    })

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
        const grouped: Record<QueueEntryStatus, QueueEntry[]> = {
            [QueueEntryStatus.WAITING]: [],
            [QueueEntryStatus.BOARDING]: [],
            [QueueEntryStatus.DISPATCHED]: [],
        }
        entries?.forEach((entry) => {
            grouped[entry.status]?.push(entry)
        })
        return grouped
    }, [entries])

    const filteredRoutes = useMemo(() => {
        if (!allRoutes) return []
        if (!searchQuery.trim()) return allRoutes

        const query = searchQuery.toLowerCase().trim()
        return allRoutes.filter((r) =>
            r.origin.toLowerCase().includes(query) ||
            r.destination.toLowerCase().includes(query) ||
            r.stages?.some(stage => stage.toLowerCase().includes(query))
        )
    }, [allRoutes, searchQuery])

    const handleAdvance = (entry: QueueEntry) => {
        const next = NEXT_STATUS[entry.status]
        if (next) statusMutation.mutate({ id: entry.id, status: next })
    }

    const handleRetreat = (entry: QueueEntry) => {
        const prev = PREV_STATUS[entry.status]
        if (prev) statusMutation.mutate({ id: entry.id, status: prev })
    }

    const handleRequestRemove = (entry: QueueEntry) => {
        setEntryToRemove(entry)
    }

    const confirmRemove = () => {
        if (entryToRemove) {
            removeMutation.mutate(entryToRemove.id)
            setEntryToRemove(null)
        }
    }

    // ─── Dashboard View ──────────────────────────────────────────────────────

    if (!selectedRouteId) {
        return (
            <div className={cn("space-y-4", className)}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h2 className="text-base font-medium">Queue Management</h2>
                        <p className="text-sm text-muted-foreground">
                            Select a route to manage its queue
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Popover open={dateOpen} onOpenChange={setDateOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs w-36 justify-start font-normal"
                                >
                                    <CalendarIcon className="size-3.5 text-muted-foreground/50" />
                                    {format(parseISO(selectedDate), "MMM d, yyyy")}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="single"
                                    selected={parseISO(selectedDate)}
                                    onSelect={(date) => {
                                        if (!date) return
                                        setSelectedDate(format(date, "yyyy-MM-dd"))
                                        setDateOpen(false)
                                    }}
                                    disabled={(date) => date > new Date()}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                        {!isToday && (
                            <Badge variant="secondary" className="text-[10px]">
                                Past day
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                        placeholder="Search routes by origin, destination, or stages..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-9 text-sm"
                    />
                </div>

                {/* Route Dashboard */}
                {routesLoading || countsLoading ? (
                    <RouteDashboardSkeleton isMobile={isMobile} />
                ) : filteredRoutes.length === 0 ? (
                    <EmptyDashboardState
                        searchQuery={searchQuery}
                        onClear={() => setSearchQuery("")}
                    />
                ) : (
                    <RouteDashboard
                        routes={filteredRoutes}
                        counts={allQueueData || []}
                        onSelectRoute={handleRouteChange}
                        isMobile={isMobile}
                        selectedDate={selectedDate}
                    />
                )}
            </div>
        )
    }

    // ─── Queue Detail View ──────────────────────────────────────────────────

    return (
        <div className={cn("space-y-4", className)}>
            {/* Back button */}
            <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
                onClick={handleBackToDashboard}
            >
                <ArrowLeftCircle className="size-4" />
                Back to all routes
            </Button>

            {/* Header */}
            <div className="space-y-3">
                {route && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <h2 className="text-base font-medium">
                                {route.origin} → {route.destination}
                            </h2>
                            {route.stages?.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    via {route.stages.join(", ")}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Popover open={dateOpen} onOpenChange={setDateOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 text-xs w-36 justify-start font-normal"
                                    >
                                        <CalendarIcon className="size-3.5 text-muted-foreground/50" />
                                        {format(parseISO(selectedDate), "MMM d, yyyy")}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={parseISO(selectedDate)}
                                        onSelect={(date) => {
                                            if (!date) return
                                            setSelectedDate(format(date, "yyyy-MM-dd"))
                                            setDateOpen(false)
                                        }}
                                        disabled={(date) => date > new Date()}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                            {!isToday && (
                                <Badge variant="secondary" className="text-[10px]">
                                    Past day
                                </Badge>
                            )}
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

            {/* Queue Stats Bar */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                    <ClockIcon className="size-3 text-amber-500" />
                    {lanes[QueueEntryStatus.WAITING].length} waiting
                </span>
                <span className="flex items-center gap-1">
                    <Users className="size-3 text-blue-500" />
                    {lanes[QueueEntryStatus.BOARDING].length} boarding
                </span>
                <span className="flex items-center gap-1">
                    <CheckCircle className="size-3 text-emerald-500" />
                    {lanes[QueueEntryStatus.DISPATCHED].length} dispatched
                </span>
            </div>

            {/* Board */}
            {queueLoading ? (
                <QueueBoardSkeleton isMobile={isMobile} />
            ) : isMobile ? (
                <Tabs defaultValue={QueueEntryStatus.WAITING} className="w-full">
                    <TabsList className="grid grid-cols-3 w-full h-auto p-1 gap-1 bg-muted/50">
                        {LANES.map((lane) => {
                            const Icon = lane.icon
                            const count = lanes[lane.status].length
                            return (
                                <TabsTrigger
                                    key={lane.status}
                                    value={lane.status}
                                    className="flex flex-col items-center gap-1 py-2 data-[state=active]:shadow-sm"
                                >
                                    <span className="flex items-center gap-1.5">
                                        <Icon className={cn("size-3.5", lane.color)} />
                                        <span className="text-xs font-medium">{lane.label}</span>
                                    </span>
                                    <Badge variant="secondary" className="text-[9px] h-4 px-1.5 font-mono">
                                        {count}
                                    </Badge>
                                </TabsTrigger>
                            )
                        })}
                    </TabsList>

                    {LANES.map((lane) => (
                        <TabsContent key={lane.status} value={lane.status} className="mt-3">
                            <QueueLane
                                lane={lane}
                                entries={lanes[lane.status]}
                                onAdvance={handleAdvance}
                                onRetreat={handleRetreat}
                                onRequestRemove={handleRequestRemove}
                                isUpdating={statusMutation.isPending}
                                readOnly={!isToday}
                                hideHeader
                            />
                        </TabsContent>
                    ))}
                </Tabs>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {LANES.map((lane) => (
                        <QueueLane
                            key={lane.status}
                            lane={lane}
                            entries={lanes[lane.status]}
                            onAdvance={handleAdvance}
                            onRetreat={handleRetreat}
                            onRequestRemove={handleRequestRemove}
                            isUpdating={statusMutation.isPending}
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

            {/* Remove confirmation */}
            <Dialog open={!!entryToRemove} onOpenChange={(open) => !open && setEntryToRemove(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <div className="flex items-center gap-2">
                            <div className="flex size-8 items-center justify-center rounded-full bg-destructive/10">
                                <AlertTriangle className="size-4 text-destructive" />
                            </div>
                            <DialogTitle>Remove from queue?</DialogTitle>
                        </div>
                        <DialogDescription className="pt-1">
                            {entryToRemove?.vehicle.numberPlate} will be removed from the queue.
                            This can't be undone — the vehicle will need to be clocked in again.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => setEntryToRemove(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            className="w-full sm:w-auto"
                            onClick={confirmRemove}
                            disabled={removeMutation.isPending}
                        >
                            {removeMutation.isPending ? "Removing..." : "Remove"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ─── Route Dashboard ──────────────────────────────────────────────────────

interface RouteDashboardProps {
    routes: any[]
    counts: Array<{
        routeId: string
        waiting: number
        boarding: number
        dispatched: number
        total: number
    }>
    onSelectRoute: (id: string) => void
    isMobile: boolean
    selectedDate: string
}

function RouteDashboard({ routes, counts, onSelectRoute, isMobile, selectedDate }: RouteDashboardProps) {
    if (isMobile) {
        return (
            <div className="grid gap-2">
                {routes.map((route) => {
                    const count = counts.find(c => c.routeId === route.id) || { waiting: 0, boarding: 0, dispatched: 0, total: 0 }
                    return (
                        <div
                            key={route.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectRoute(route.id)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault()
                                    onSelectRoute(route.id)
                                }
                            }}
                            className="rounded-lg border bg-card p-3 transition-all hover:bg-accent/30 hover:border-muted-foreground/20 cursor-pointer"
                        >
                            <div className="flex items-center justify-between">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-sm">
                                        {route.origin} → {route.destination}
                                    </p>
                                    {route.stages?.length > 0 && (
                                        <p className="text-xs text-muted-foreground/70 truncate">
                                            via {route.stages.join(", ")}
                                        </p>
                                    )}
                                </div>
                                <ChevronRight className="size-4 text-muted-foreground/30" />
                            </div>
                            <div className="flex items-center gap-3 mt-2 text-xs">
                                <span className="flex items-center gap-1">
                                    <ClockIcon className="size-3 text-amber-500" />
                                    {count.waiting}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Users className="size-3 text-blue-500" />
                                    {count.boarding}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Truck className="size-3 text-emerald-500" />
                                    {count.dispatched}
                                </span>
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-auto">
                                    {count.total} total
                                </Badge>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow className="bg-muted/50">
                        <TableHead className="w-[35%]">Route</TableHead>
                        <TableHead className="w-[15%] text-center">Waiting</TableHead>
                        <TableHead className="w-[15%] text-center">Boarding</TableHead>
                        <TableHead className="w-[15%] text-center">Dispatched</TableHead>
                        <TableHead className="w-[10%] text-center">Total</TableHead>
                        <TableHead className="w-[10%] text-right">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {routes.map((route) => {
                        const count = counts.find(c => c.routeId === route.id) || { waiting: 0, boarding: 0, dispatched: 0, total: 0 }
                        return (
                            <TableRow
                                key={route.id}
                                className="group cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => onSelectRoute(route.id)}
                            >
                                <TableCell>
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">
                                            {route.origin} → {route.destination}
                                        </p>
                                        {route.stages?.length > 0 && (
                                            <p className="text-xs text-muted-foreground/70 truncate">
                                                via {route.stages.join(", ")}
                                            </p>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-center">
                                    <Badge variant="secondary" className="text-xs font-medium bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20">
                                        {count.waiting}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                    <Badge variant="secondary" className="text-xs font-medium bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20">
                                        {count.boarding}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                    <Badge variant="secondary" className="text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20">
                                        {count.dispatched}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-center font-semibold">
                                    {count.total}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs gap-1"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            onSelectRoute(route.id)
                                        }}
                                    >
                                        Manage
                                        <ChevronRight className="size-3.5" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </div>
    )
}

// ─── Queue Lane ─────────────────────────────────────────────────────────────

interface QueueLaneProps {
    lane: typeof LANES[0]
    entries: QueueEntry[]
    onAdvance: (entry: QueueEntry) => void
    onRetreat: (entry: QueueEntry) => void
    onRequestRemove: (entry: QueueEntry) => void
    isUpdating?: boolean
    readOnly?: boolean
    hideHeader?: boolean
}

function QueueLane({ lane, entries, onAdvance, onRetreat, onRequestRemove, isUpdating, readOnly, hideHeader }: QueueLaneProps) {
    const Icon = lane.icon

    return (
        <div className={cn(
            "rounded-lg border p-3 space-y-2 transition-all",
            lane.bg,
            lane.border
        )}>
            {/* Lane Header */}
            {!hideHeader && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Icon className={cn("size-4", lane.color)} />
                        <span className="text-sm font-medium">{lane.label}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-mono">
                        {entries.length}
                    </Badge>
                </div>
            )}

            {/* Lane Content */}
            {entries.length === 0 ? (
                <div className="py-8 text-center">
                    <p className="text-xs text-muted-foreground/50">Empty</p>
                </div>
            ) : (
                <div className="space-y-1.5">
                    {entries.map((entry) => (
                        <QueueCard
                            key={entry.id}
                            entry={entry}
                            // Backend now assigns a real position per queue —
                            // use it directly instead of the array index, so the
                            // number stays correct even if this lane's array is
                            // ever filtered/reordered client-side.
                            position={lane.status === QueueEntryStatus.WAITING ? entry.position : undefined}
                            onAdvance={() => onAdvance(entry)}
                            onRetreat={() => onRetreat(entry)}
                            onRequestRemove={() => onRequestRemove(entry)}
                            isUpdating={isUpdating}
                            readOnly={readOnly}
                            laneColor={lane.color}
                            nextAction={NEXT_STATUS[entry.status]}
                            prevAction={PREV_STATUS[entry.status]}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── Queue Card ─────────────────────────────────────────────────────────────

interface QueueCardProps {
    entry: QueueEntry
    position?: number
    onAdvance: () => void
    onRetreat: () => void
    onRequestRemove: () => void
    isUpdating?: boolean
    readOnly?: boolean
    laneColor: string
    nextAction?: QueueEntryStatus
    prevAction?: QueueEntryStatus
}

function QueueCard({
    entry,
    position,
    onAdvance,
    onRetreat,
    onRequestRemove,
    isUpdating,
    readOnly,
    laneColor,
    nextAction,
    prevAction,
}: QueueCardProps) {
    const elapsed = useElapsedTime(entry.clockedInAt)

    return (
        <div className="group rounded-md border bg-card p-2.5 transition-all hover:shadow-sm hover:border-muted-foreground/20">
            <div className="flex items-center gap-2">
                {/* Position Badge (Waiting lane only) */}
                {position !== undefined && (
                    <Badge variant="secondary" className="h-5 w-5 p-0 text-[9px] font-mono flex items-center justify-center shrink-0">
                        {position}
                    </Badge>
                )}

                {/* Vehicle Info */}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Car className="size-3 text-muted-foreground/50 shrink-0" />
                        <p className="truncate text-sm font-medium">
                            {entry.vehicle.numberPlate}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <Clock className="size-2.5" />
                            {elapsed}
                        </span>
                        <span>•</span>
                        <span>{entry.vehicle.seatingCapacity} seats</span>
                    </div>
                </div>

                {/* Actions - Icon only */}
                <div className="flex items-center gap-0.5 shrink-0">
                    {!readOnly && prevAction && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/40 hover:text-foreground hover:bg-transparent transition-all hover:scale-110"
                            onClick={onRetreat}
                            disabled={isUpdating}
                            aria-label="Move back to previous status"
                            title="Move back to previous status"
                        >
                            <ArrowLeftCircle className="size-4" />
                        </Button>
                    )}

                    {!readOnly && nextAction && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-7 w-7 transition-all hover:scale-110",
                                laneColor,
                                "hover:bg-transparent"
                            )}
                            onClick={onAdvance}
                            disabled={isUpdating}
                            aria-label="Advance to next status"
                            title="Advance to next status"
                        >
                            <ArrowRightCircle className="size-4" />
                        </Button>
                    )}

                    {!readOnly && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-transparent transition-all hover:scale-110"
                            onClick={onRequestRemove}
                            aria-label="Remove from queue"
                            title="Remove from queue"
                        >
                            <XCircle className="size-4" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Dashboard Skeleton ────────────────────────────────────────────────────

function RouteDashboardSkeleton({ isMobile }: { isMobile?: boolean }) {
    if (isMobile) {
        return (
            <div className="grid gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-16 ml-auto" />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="rounded-lg border">
            <div className="p-4 border-b bg-muted/50">
                <div className="grid grid-cols-6 gap-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                </div>
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-4 border-b last:border-0">
                    <div className="grid grid-cols-6 gap-4 items-center">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-6 w-12 mx-auto" />
                        <Skeleton className="h-6 w-12 mx-auto" />
                        <Skeleton className="h-6 w-12 mx-auto" />
                        <Skeleton className="h-5 w-12 mx-auto" />
                        <Skeleton className="h-7 w-20 ml-auto" />
                    </div>
                </div>
            ))}
        </div>
    )
}

// ─── Queue Board Skeleton ──────────────────────────────────────────────────

function QueueBoardSkeleton({ isMobile }: { isMobile?: boolean }) {
    if (isMobile) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-12 w-full rounded-lg" />
                <div className="rounded-lg border bg-card/50 p-3 space-y-2">
                    <Skeleton className="h-12 w-full rounded-md" />
                    <Skeleton className="h-12 w-full rounded-md" />
                </div>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-card/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-5 w-8" />
                    </div>
                    <Skeleton className="h-12 w-full rounded-md" />
                    <Skeleton className="h-12 w-full rounded-md" />
                </div>
            ))}
        </div>
    )
}

// ─── Empty Dashboard State ─────────────────────────────────────────────────

interface EmptyDashboardStateProps {
    searchQuery: string
    onClear: () => void
}

function EmptyDashboardState({ searchQuery, onClear }: EmptyDashboardStateProps) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 px-4 text-center">
            <div className="rounded-full bg-muted/30 p-2.5">
                <Search className="size-5 text-muted-foreground/40" />
            </div>
            <div className="space-y-0.5">
                <p className="text-sm font-medium">No routes found</p>
                <p className="text-xs text-muted-foreground">
                    {searchQuery ? `No routes match "${searchQuery}"` : "No routes available"}
                </p>
            </div>
            {searchQuery && (
                <Button size="sm" variant="outline" onClick={onClear} className="gap-1.5 text-xs">
                    Clear search
                </Button>
            )}
        </div>
    )
}