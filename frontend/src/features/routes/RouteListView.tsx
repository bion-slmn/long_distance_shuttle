// src/features/routes/RouteListView.tsx
import { useState, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    MoreVertical,
    Plus,
    Search,
    MapPin,
    Route as RouteIcon,
    Pencil,
    Power,
    PowerOff,
    ChevronRight,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { getRoutesRequest, updateRouteRequest, type Route } from "@/api/routeApi"
import { RouteForm } from "./RouteForm"

interface RouteListViewProps {
    saccoId?: string
    className?: string
}

export function RouteListView({ saccoId, className }: RouteListViewProps) {
    const [showForm, setShowForm] = useState(false)
    const [formMode, setFormMode] = useState<"create" | "edit">("create")
    const [editingRoute, setEditingRoute] = useState<Route | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)
    const [routeToToggle, setRouteToToggle] = useState<Route | null>(null)

    const queryClient = useQueryClient()
    const queryKey = ["routes", saccoId]

    const { data: routes, isLoading, error } = useQuery({
        queryKey,
        queryFn: getRoutesRequest,
        staleTime: 5 * 60 * 1000,
    })

    // Toggle route active status
    const toggleMutation = useMutation({
        mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
            updateRouteRequest(id, { isActive }),
        onMutate: async ({ id, isActive }) => {
            await queryClient.cancelQueries({ queryKey })
            const previous = queryClient.getQueryData<Route[]>(queryKey)

            queryClient.setQueryData<Route[]>(queryKey, (old) =>
                old?.map((r) =>
                    r.id === id ? { ...r, isActive } : r
                )
            )

            return { previous }
        },
        onError: (_err, _vars, context) => {
            queryClient.setQueryData(queryKey, context?.previous)
            toast.error("Failed to update route status")
        },
        onSuccess: (_data, vars) => {
            toast.success(`Route ${vars.isActive ? "activated" : "deactivated"} successfully`)
            queryClient.invalidateQueries({ queryKey })
            setRouteToToggle(null)
        },
    })

    const filteredRoutes = useMemo(() => {
        if (!routes) return []
        let filtered = routes

        if (saccoId) {
            filtered = filtered.filter(r => r.saccoId === saccoId)
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim()
            filtered = filtered.filter((r) =>
                r.origin.toLowerCase().includes(query) ||
                r.destination.toLowerCase().includes(query) ||
                r.stages?.some(stage => stage.toLowerCase().includes(query))
            )
        }

        return filtered
    }, [routes, saccoId, searchQuery])

    const handleAddRoute = () => {
        setFormMode("create")
        setEditingRoute(null)
        setShowForm(true)
    }

    const handleEditRoute = (route: Route) => {
        setFormMode("edit")
        setEditingRoute(route)
        setShowForm(true)
    }

    const handleToggleRoute = (route: Route) => {
        setRouteToToggle(route)
    }

    const confirmToggle = () => {
        if (routeToToggle) {
            toggleMutation.mutate({
                id: routeToToggle.id,
                isActive: !routeToToggle.isActive,
            })
        }
    }

    const handleFormSuccess = () => {
        setShowForm(false)
        queryClient.invalidateQueries({ queryKey })
    }

    if (isLoading) {
        return <RouteListSkeleton />
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 py-12 px-4 text-center">
                <p className="text-sm text-destructive">Failed to load routes</p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Retry
                </Button>
            </div>
        )
    }

    if (!routes || routes.length === 0) {
        return (
            <>
                <EmptyState
                    title="No routes found"
                    description="Get started by creating your first route."
                    actionLabel="Add Route"
                    onAction={handleAddRoute}
                />
                <RouteForm
                    open={showForm}
                    onOpenChange={setShowForm}
                    mode={formMode}
                    route={editingRoute}
                    onSuccess={handleFormSuccess}
                />
            </>
        )
    }

    if (filteredRoutes.length === 0) {
        return (
            <>
                <div className="space-y-3">
                    <RouteToolbar
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        onAddRoute={handleAddRoute}
                        totalCount={routes.length}
                    />
                    <EmptyState
                        title="No matching routes"
                        description={`No routes found matching "${searchQuery}"`}
                        actionLabel="Clear search"
                        onAction={() => setSearchQuery("")}
                    />
                </div>
                <RouteForm
                    open={showForm}
                    onOpenChange={setShowForm}
                    mode={formMode}
                    route={editingRoute}
                    onSuccess={handleFormSuccess}
                />
            </>
        )
    }

    return (
        <>
            <div className={cn("space-y-4", className)}>
                <RouteToolbar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onAddRoute={handleAddRoute}
                    totalCount={routes.length}
                />

                <div className="grid gap-2">
                    {filteredRoutes.map((route) => (
                        <RouteCard
                            key={route.id}
                            route={route}
                            onSelect={() => setSelectedRoute(route)}
                            onEdit={() => handleEditRoute(route)}
                            onToggle={() => handleToggleRoute(route)}
                            isToggling={
                                toggleMutation.isPending &&
                                toggleMutation.variables?.id === route.id
                            }
                        />
                    ))}
                </div>
            </div>

            <RouteDetailsDialog
                route={selectedRoute}
                open={!!selectedRoute}
                onOpenChange={() => setSelectedRoute(null)}
                onEdit={() => {
                    if (selectedRoute) {
                        handleEditRoute(selectedRoute)
                        setSelectedRoute(null)
                    }
                }}
            />

            <RouteForm
                open={showForm}
                onOpenChange={setShowForm}
                mode={formMode}
                route={editingRoute}
                onSuccess={handleFormSuccess}
            />

            <Dialog open={!!routeToToggle} onOpenChange={() => setRouteToToggle(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {routeToToggle?.isActive ? "Deactivate" : "Activate"} Route
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to {routeToToggle?.isActive ? "deactivate" : "activate"}
                            the route from {routeToToggle?.origin} to {routeToToggle?.destination}?
                            {routeToToggle?.isActive
                                ? " Deactivated routes won't appear in the queue."
                                : " Activated routes will be available in the queue."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => setRouteToToggle(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant={routeToToggle?.isActive ? "destructive" : "default"}
                            className="w-full sm:w-auto"
                            onClick={confirmToggle}
                            disabled={toggleMutation.isPending}
                        >
                            {toggleMutation.isPending
                                ? "Updating..."
                                : routeToToggle?.isActive ? "Deactivate" : "Activate"
                            }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

interface RouteToolbarProps {
    searchQuery: string
    onSearchChange: (value: string) => void
    onAddRoute: () => void
    totalCount: number
}

function RouteToolbar({
    searchQuery,
    onSearchChange,
    onAddRoute,
    totalCount,
}: RouteToolbarProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
                <h2 className="text-base font-medium">Routes</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {totalCount}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:flex-none">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                        type="search"
                        placeholder="Search routes..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="h-8 pl-7 pr-7 text-xs bg-muted/30 border-muted-foreground/10 focus-visible:ring-0 w-full sm:w-44"
                        aria-label="Search routes"
                    />
                    {searchQuery && (
                        <button
                            className="absolute right-0 top-0 h-full px-2 text-muted-foreground/50 hover:text-foreground"
                            onClick={() => onSearchChange("")}
                            aria-label="Clear search"
                        >
                            ✕
                        </button>
                    )}
                </div>
                <Button size="sm" onClick={onAddRoute} className="gap-1.5">
                    <Plus className="size-3.5" />
                    <span className="hidden sm:inline text-xs">Add</span>
                </Button>
            </div>
        </div>
    )
}

interface RouteCardProps {
    route: Route
    onSelect: () => void
    onEdit: () => void
    onToggle: () => void
    isToggling?: boolean
}

function RouteCard({
    route,
    onSelect,
    onEdit,
    onToggle,
    isToggling,
}: RouteCardProps) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect()
                }
            }}
            className={cn(
                "group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-all hover:bg-accent/30 hover:border-muted-foreground/20 cursor-pointer",
                !route.isActive && "opacity-60"
            )}
        >
            <RouteIcon className="size-4 text-muted-foreground/50 shrink-0" />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="truncate text-sm font-medium">
                        {route.origin} → {route.destination}
                    </p>
                    <Badge
                        variant={route.isActive ? "default" : "secondary"}
                        className="text-[10px] h-5 px-1.5 font-medium"
                    >
                        {route.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {route.stages && route.stages.length > 0 && (
                        <span className="text-xs text-muted-foreground/60">
                            {route.stages.length} stage{route.stages.length > 1 ? "s" : ""}
                        </span>
                    )}
                </div>
                {route.stages && route.stages.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                        Via: {route.stages.join(" → ")}
                    </p>
                )}
            </div>

            <div
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <Switch
                    checked={route.isActive}
                    disabled={isToggling}
                    onCheckedChange={onToggle}
                    className="scale-75 data-[state=checked]:bg-emerald-500"
                    aria-label={route.isActive ? "Deactivate route" : "Activate route"}
                />

                <DropdownMenu>
                    <DropdownMenuTrigger >
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/50 hover:text-foreground hover:bg-transparent"
                            aria-label={`Actions for route ${route.origin} → ${route.destination}`}
                        >
                            <MoreVertical className="size-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={onSelect}>
                            <MapPin className="size-3.5 mr-2" />
                            View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onEdit}>
                            <Pencil className="size-3.5 mr-2" />
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={onToggle}
                            className={route.isActive ? "text-destructive" : "text-emerald-600"}
                        >
                            {route.isActive ? (
                                <>
                                    <PowerOff className="size-3.5 mr-2" />
                                    Deactivate
                                </>
                            ) : (
                                <>
                                    <Power className="size-3.5 mr-2" />
                                    Activate
                                </>
                            )}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <ChevronRight className="size-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            </div>
        </div>
    )
}

interface RouteDetailsDialogProps {
    route: Route | null
    open: boolean
    onOpenChange: () => void
    onEdit: () => void
}

function RouteDetailsDialog({
    route,
    open,
    onOpenChange,
    onEdit,
}: RouteDetailsDialogProps) {
    if (!route) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-5">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-foreground">
                        <RouteIcon className="size-4 text-muted-foreground" />
                        {route.origin} → {route.destination}
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2">
                        <Badge
                            variant={route.isActive ? "default" : "secondary"}
                            className="text-[10px] h-5 px-1.5 font-medium"
                        >
                            {route.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            {route.stages?.length || 0} stages
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2">
                    {route.description && (
                        <p className="text-sm text-muted-foreground">{route.description}</p>
                    )}

                    <RoadRoute origin={route.origin} destination={route.destination} stages={route.stages} />

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <p className="font-medium text-muted-foreground">Created</p>
                            <p className="text-foreground">
                                {new Date(route.createdAt).toLocaleDateString()}
                            </p>
                        </div>
                        <div>
                            <p className="font-medium text-muted-foreground">Last Updated</p>
                            <p className="text-foreground">
                                {new Date(route.updatedAt).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
                        <Pencil className="size-3.5 mr-1.5" />
                        Edit
                    </Button>
                    <Button size="sm" className="flex-1" onClick={onOpenChange}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

interface RoadRouteProps {
    origin: string
    destination: string
    stages?: string[]
}

function RoadRoute({ origin, destination, stages = [] }: RoadRouteProps) {
    const points = [origin, ...stages, destination]
    const n = points.length

    const rowHeight = 64
    const svgHeight = rowHeight * (n - 1) + 40
    const svgWidth = 60
    const centerX = svgWidth / 2
    const swing = 16

    const xAt = (i: number) => {
        if (i === 0 || i === n - 1) return centerX
        return centerX + (i % 2 === 0 ? swing : -swing)
    }
    const yAt = (i: number) => 20 + i * rowHeight

    const pathD = points
        .map((_, i) => {
            const x = xAt(i)
            const y = yAt(i)
            if (i === 0) return `M ${x} ${y}`
            const prevX = xAt(i - 1)
            const prevY = yAt(i - 1)
            const midY = (prevY + y) / 2
            return `C ${prevX} ${midY}, ${x} ${midY}, ${x} ${y}`
        })
        .join(" ")

    return (
        <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex gap-3">
                <svg
                    width={svgWidth}
                    height={svgHeight}
                    className="shrink-0"
                    style={{ overflow: "visible" }}
                >
                    <path
                        d={pathD}
                        fill="none"
                        stroke="var(--border)"
                        strokeWidth={6}
                        strokeLinecap="round"
                    />
                    <path
                        d={pathD}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                        strokeDasharray="4 5"
                        strokeLinecap="round"
                        opacity={0.5}
                    />
                    {points.map((_, i) => {
                        const isEndpoint = i === 0 || i === n - 1
                        return (
                            <circle
                                key={i}
                                cx={xAt(i)}
                                cy={yAt(i)}
                                r={isEndpoint ? 7 : 5}
                                fill={isEndpoint ? "var(--primary)" : "var(--background)"}
                                stroke={isEndpoint ? "var(--primary)" : "var(--muted-foreground)"}
                                strokeWidth={isEndpoint ? 0 : 2}
                            />
                        )
                    })}
                </svg>

                <div className="flex-1 min-w-0">
                    {points.map((label, i) => {
                        const isOrigin = i === 0
                        const isDestination = i === n - 1
                        return (
                            <div
                                key={i}
                                className="flex flex-col justify-center"
                                style={{ height: rowHeight, marginTop: i === 0 ? 8 : 0 }}
                            >
                                <p className={cn(
                                    "truncate",
                                    isOrigin || isDestination
                                        ? "text-sm font-semibold text-foreground"
                                        : "text-xs font-medium text-foreground"
                                )}>
                                    {label}
                                </p>
                                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">
                                    {isOrigin ? "From" : isDestination ? "To" : "Stage"}
                                </p>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

function RouteListSkeleton() {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-7 w-24" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
        </div>
    )
}

interface EmptyStateProps {
    title: string
    description: string
    actionLabel?: string
    onAction?: () => void
}

function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-10 px-4 text-center">
            <div className="rounded-full bg-muted/30 p-2.5">
                <RouteIcon className="size-5 text-muted-foreground/40" />
            </div>
            <div className="space-y-0.5">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {actionLabel && onAction && (
                <Button size="sm" variant="outline" onClick={onAction} className="gap-1.5 text-xs">
                    <Plus className="size-3.5" />
                    {actionLabel}
                </Button>
            )}
        </div>
    )
}