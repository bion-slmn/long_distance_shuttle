// src/features/queue/ClerkDashboard.tsx
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { Calendar as CalendarIcon, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"

import { getRoutesRequest } from "@/api/routeApi"
import { SaccoCombobox } from "@/features/sacco/SaccoCombobox"
import { RouteQueueCards } from "@/features/queue/RouteQueueCards"
import { useNavigate } from "react-router-dom"

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
    const navigate = useNavigate()

    const handleSelectRoute = (routeId: string) => {
        onSelectRoute?.(routeId)          // still call it if a parent passed one
        navigate(`/routeQueue?routeId=${routeId}`)
    }

    const isToday = selectedDate === todayIso()

    // Fetch all routes
    const { data: allRoutes, isLoading: routesLoading } = useQuery({
        queryKey: ["routes", "all"],
        queryFn: getRoutesRequest,
        staleTime: 5 * 60 * 1000,
    })

    // Filter routes
    const filteredRoutes = (() => {
        if (!allRoutes) return []

        let routes = allRoutes

        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim()
            routes = routes.filter((r) =>
                r.origin.toLowerCase().includes(query) ||
                r.destination.toLowerCase().includes(query) ||
                r.stages?.some(stage => stage.toLowerCase().includes(query))
            )
        }

        // Apply sacco filter
        if (saccoFilter) {
            routes = routes.filter(r => r.saccoId === saccoFilter)
        }

        return routes
    })()

    if (routesLoading) {
        return (
            <div className={cn("space-y-4", className)}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <div className="h-6 w-48 bg-muted rounded animate-pulse" />
                        <div className="h-4 w-32 bg-muted rounded animate-pulse mt-1" />
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="h-9 w-40 bg-muted rounded animate-pulse" />
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 h-10 bg-muted rounded animate-pulse" />
                    <div className="w-full sm:w-[220px] h-10 bg-muted rounded animate-pulse" />
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
                            <div className="space-y-2">
                                <div className="h-10 w-full bg-muted rounded animate-pulse" />
                                <div className="flex items-center gap-3">
                                    <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                                    <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                                    <div className="h-4 w-12 bg-muted rounded animate-pulse ml-auto" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className={cn("space-y-4", className)}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Queue Management</h2>
                    <p className="text-sm text-muted-foreground">
                        {filteredRoutes.length} route{filteredRoutes.length === 1 ? "" : "s"} available
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Popover open={dateOpen} onOpenChange={setDateOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1.5 text-sm w-40 justify-start font-normal"
                            >
                                <CalendarIcon className="size-4 text-muted-foreground/50" />
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
                        <Badge variant="secondary" className="text-[10px] h-6">
                            Past day
                        </Badge>
                    )}
                </div>
            </div>

            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                        placeholder="Search routes by origin, destination, or stages..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-10 text-sm"
                    />
                </div>
                <div className="w-full sm:w-[220px]">
                    <SaccoCombobox
                        value={saccoFilter}
                        onChange={setSaccoFilter}
                        placeholder="Filter by sacco..."
                    />
                </div>
            </div>

            {/* Route Cards - Using the existing component as-is */}
            <RouteQueueCards
                routes={filteredRoutes}
                selectedDate={selectedDate}
                isToday={isToday}
                onSelectRoute={handleSelectRoute}
            />
        </div>
    )
}