// src/features/queue/ClerkDashboard.tsx
import { useState } from "react"
import { useQuery, useQueries } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { Calendar as CalendarIcon, Search, MapPinned, Car, Clock, Truck, SlidersHorizontal, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"

import { getRoutesRequest, getQueueEntriesRequest, QueueEntryStatus } from "@/api/routeApi"
import { SaccoCombobox } from "@/features/sacco/SaccoCombobox"
import { RouteQueueCards } from "@/features/queue/RouteQueueCards"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/features/auth/AuthContext"

interface ClerkDashboardProps {
    onSelectRoute?: (routeId: string) => void
    className?: string
}

function todayIso() {
    const d = new Date()
    return d.toISOString().slice(0, 10)
}

export function ClerkDashboard({ onSelectRoute, className }: ClerkDashboardProps) {
    const [selectedDate, setSelectedDate] = useState<string>(todayIso())
    const [dateOpen, setDateOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [saccoFilter, setSaccoFilter] = useState<string>("")
    const [showFilters, setShowFilters] = useState(false)
    const navigate = useNavigate()
    const { assignedStage } = useAuth()

    const handleSelectRoute = (routeId: string) => {
        onSelectRoute?.(routeId)
        navigate(`/routeQueue?routeId=${routeId}`)
    }

    const isToday = selectedDate === todayIso()

    const { data: allRoutes, isLoading: routesLoading } = useQuery({
        queryKey: ["routes", "all"],
        queryFn: getRoutesRequest,
        staleTime: 5 * 60 * 1000,
    })

    const filteredRoutes = (() => {
        if (!allRoutes) return []
        let routes = allRoutes

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim()
            routes = routes.filter((r) =>
                r.origin.toLowerCase().includes(query) ||
                r.destination.toLowerCase().includes(query) ||
                r.stages?.some(stage => stage.toLowerCase().includes(query))
            )
        }

        if (saccoFilter) {
            routes = routes.filter(r => r.saccoId === saccoFilter)
        }

        return routes
    })()

    const queueQueries = useQueries({
        queries: filteredRoutes.map((route) => ({
            queryKey: ["queue", route.id, selectedDate],
            queryFn: () => getQueueEntriesRequest({ routeId: route.id, date: selectedDate }),
            refetchInterval: isToday ? 15_000 : false,
        })),
    })

    const statsLoading = routesLoading || queueQueries.some((q) => q.isLoading)

    const stats = queueQueries.reduce(
        (acc, q) => {
            const entries = q.data ?? []
            acc.activeVehicles += entries.filter((e) => e.status === QueueEntryStatus.BOARDING).length
            acc.totalWaiting += entries.filter((e) => e.status === QueueEntryStatus.WAITING).length
            acc.totalDispatched += entries.filter((e) => e.status === QueueEntryStatus.DISPATCHED).length
            return acc
        },
        { activeVehicles: 0, totalWaiting: 0, totalDispatched: 0 }
    )

    const activeFilterCount = (searchQuery.trim() ? 1 : 0) + (saccoFilter ? 1 : 0)

    if (routesLoading) {
        return (
            <div className={cn("space-y-3", className)}>
                <div className="h-9 w-full bg-muted rounded animate-pulse" />
                <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
                    ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="rounded-lg border bg-card p-3 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="space-y-2 flex-1">
                                    <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                                    <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
                                </div>
                                <div className="h-7 w-7 bg-muted rounded animate-pulse" />
                            </div>
                            <div className="h-10 w-full bg-muted rounded animate-pulse" />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className={cn("space-y-3", className)}>
            {/* Header: labeled stage + date + filter toggle */}
            <div className="flex items-center gap-2">
                {assignedStage && (
                    <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 shrink-0">
                        <MapPinned className="size-3.5 text-primary" />
                        <span className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide">
                            Stage
                        </span>
                        <span className="text-xs font-bold text-primary">{assignedStage}</span>
                    </div>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                    <Popover open={dateOpen} onOpenChange={setDateOpen}>
                        <PopoverTrigger>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs px-2 font-normal"
                            >
                                <CalendarIcon className="size-3.5 text-muted-foreground/50" />
                                {format(parseISO(selectedDate), "MMM d")}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                                mode="single"
                                selected={parseISO(selectedDate)}
                                onSelect={(date) => {
                                    if (!date) return
                                    setSelectedDate(format(date, "yyyy-MM-dd"))
                                    setDateOpen(false)
                                }}
                                disabled={(date) => date > new Date()}
                                autoFocus
                            />
                        </PopoverContent>
                    </Popover>
                    {!isToday && (
                        <Badge variant="secondary" className="text-[9px] h-5 px-1">
                            Past
                        </Badge>
                    )}
                    <Button
                        variant={showFilters ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 gap-1 text-xs px-2 font-normal"
                        onClick={() => setShowFilters((v) => !v)}
                    >
                        <SlidersHorizontal className="size-3.5" />
                        {activeFilterCount > 0 && (
                            <span className="rounded-full bg-primary text-primary-foreground text-[9px] w-3.5 h-3.5 flex items-center justify-center">
                                {activeFilterCount}
                            </span>
                        )}
                    </Button>
                </div>
            </div>

            {/* KPI cards — real dashboard-style stat blocks, 3-up grid */}
            <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2">
                    <div className="hidden sm:flex rounded-md bg-primary/10 p-1.5 shrink-0">
                        <Car className="size-3.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[9px] font-semibold text-primary/70 uppercase tracking-wide truncate">
                            Active
                        </p>
                        <p className="text-base font-bold leading-none mt-0.5">
                            {statsLoading ? "—" : stats.activeVehicles}
                        </p>
                    </div>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 flex items-center gap-2">
                    <div className="hidden sm:flex rounded-md bg-amber-500/10 p-1.5 shrink-0">
                        <Clock className="size-3.5 text-amber-500" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide truncate">
                            Waiting
                        </p>
                        <p className="text-base font-bold leading-none mt-0.5">
                            {statsLoading ? "—" : stats.totalWaiting}
                        </p>
                    </div>
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
                    <div className="hidden sm:flex rounded-md bg-emerald-500/10 p-1.5 shrink-0">
                        <Truck className="size-3.5 text-emerald-500" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide truncate">
                            Dispatched
                        </p>
                        <p className="text-base font-bold leading-none mt-0.5">
                            {statsLoading ? "—" : stats.totalDispatched}
                        </p>
                    </div>
                </div>
            </div>

            {/* Search & sacco filter — collapsed by default */}
            {showFilters && (
                <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
                        <Input
                            placeholder="Search routes..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 text-sm"
                            autoFocus
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                                onClick={() => setSearchQuery("")}
                            >
                                <X className="size-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="w-full sm:w-[200px]">
                        <SaccoCombobox
                            value={saccoFilter}
                            onChange={setSaccoFilter}
                            placeholder="Filter by sacco..."
                        />
                    </div>
                </div>
            )}

            {/* Route Cards */}
            <div className="flex items-center justify-between px-0.5">
                <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide">
                    Routes
                </h3>
                <span className="text-[11px] text-muted-foreground/50">
                    {filteredRoutes.length} route{filteredRoutes.length === 1 ? "" : "s"}
                    {activeFilterCount > 0 && " (filtered)"}
                </span>
            </div>
            <RouteQueueCards
                routes={filteredRoutes}
                selectedDate={selectedDate}
                isToday={isToday}
                onSelectRoute={handleSelectRoute}
            />
        </div>
    )
}