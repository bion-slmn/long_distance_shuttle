// src/features/fleet/FleetListView.tsx
import { useState, useMemo, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    MoreVertical,
    Plus,
    Search,
    Car,
    AlertCircle,
    CheckCircle,
    XCircle,
    Pencil,
    Trash2,
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn, formatDate, formatUpdatedAt } from "@/lib/utils"

import {
    getFleetRequest,
    setFleetVehicleStatusRequest,
    VehicleStatus,
    type Vehicle,
    type PaginatedFleet,
} from "@/api/fleetApi"
import { FleetForm } from "./FleetForm"
import { useSaccoName } from "@/hooks/useSaccoName"

interface FleetListViewProps {
    saccoId?: string
    className?: string
    onVehicleSelect?: (vehicle: Vehicle) => void
}

const STATUS_COLORS = {
    [VehicleStatus.ACTIVE]: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20",
    [VehicleStatus.MAINTENANCE]: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20",
    [VehicleStatus.RETIRED]: "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400 border-red-500/20",
}

const STATUS_ICONS = {
    [VehicleStatus.ACTIVE]: CheckCircle,
    [VehicleStatus.MAINTENANCE]: AlertCircle,
    [VehicleStatus.RETIRED]: XCircle,
}

export function FleetListView({
    saccoId,
    className,
    onVehicleSelect,
}: FleetListViewProps) {
    const [showForm, setShowForm] = useState(false)
    const [formMode, setFormMode] = useState<"create" | "edit">("create")
    const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [statusFilter, setStatusFilter] = useState<VehicleStatus | "all">("all")
    const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null)
    const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
    const [debouncedSearch, setDebouncedSearch] = useState("")

    useEffect(() => {
        const timeout = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350)
        return () => clearTimeout(timeout)
    }, [searchQuery])

    const queryClient = useQueryClient()

    // Shared "fleet" prefix so a single invalidateQueries({ queryKey: ["fleet"] })
    // call catches both the base list and the backend-search cache.
    const queryKey = ["fleet", "list", { saccoId, status: statusFilter }]

    const { data: response, isLoading, error } = useQuery({
        queryKey,
        queryFn: () => getFleetRequest(
            statusFilter !== "all" ? { status: statusFilter } : {}
        ),
        staleTime: 5 * 60 * 1000,
    })

    const vehicles = response?.data ?? []
    const total = response?.total ?? 0

    // Local (in-memory) filter — instant, no network round trip
    const locallyFiltered = useMemo(() => {
        if (!vehicles.length) return []
        if (!searchQuery.trim()) return vehicles

        const query = searchQuery.toLowerCase().trim()
        return vehicles.filter((v) =>
            v.numberPlate.toLowerCase().includes(query) ||
            v.notes?.toLowerCase().includes(query)
        )
    }, [vehicles, searchQuery])

    // Only hit the backend if local filtering came up empty and there's an actual query
    const shouldSearchBackend = debouncedSearch.length > 0 && locallyFiltered.length === 0

    const {
        data: backendSearchResponse,
        isFetching: isSearchingBackend,
    } = useQuery({
        queryKey: ["fleet", "search", { saccoId, status: statusFilter, search: debouncedSearch }],
        queryFn: () => getFleetRequest({
            status: statusFilter !== "all" ? statusFilter : undefined,
            search: debouncedSearch,
        }),
        enabled: shouldSearchBackend,
        staleTime: 60 * 1000,
    })

    // Prefer local matches; fall back to backend results once they arrive
    const filteredVehicles = useMemo(() => {
        if (locallyFiltered.length > 0) return locallyFiltered
        if (shouldSearchBackend && backendSearchResponse?.data) return backendSearchResponse.data
        return locallyFiltered // empty
    }, [locallyFiltered, shouldSearchBackend, backendSearchResponse])

    // True while we're waiting on the backend and have nothing to show yet
    const isAwaitingBackendResult = shouldSearchBackend && isSearchingBackend && filteredVehicles.length === 0

    // Status change mutation
    const statusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: VehicleStatus }) =>
            setFleetVehicleStatusRequest(id, status),
        onMutate: async ({ id, status }) => {
            await queryClient.cancelQueries({ queryKey })
            const previous = queryClient.getQueryData<PaginatedFleet>(queryKey)

            queryClient.setQueryData<PaginatedFleet>(queryKey, (old) =>
                old
                    ? {
                        ...old,
                        data: old.data.map((v) =>
                            v.id === id ? { ...v, status } : v
                        ),
                    }
                    : old
            )

            return { previous }
        },
        onError: (_err, _vars, context) => {
            queryClient.setQueryData(queryKey, context?.previous)
            toast.error("Failed to update vehicle status")
        },
        onSuccess: (_data, vars) => {
            const statusLabel = vars.status === VehicleStatus.ACTIVE ? "activated" :
                vars.status === VehicleStatus.MAINTENANCE ? "put in maintenance" :
                    "retired"
            toast.success(`Vehicle ${statusLabel} successfully`)
            queryClient.invalidateQueries({ queryKey: ["fleet"] })
        },
    })

    // Delete vehicle (soft delete via status change)
    const deleteMutation = useMutation({
        mutationFn: (vehicle: Vehicle) =>
            setFleetVehicleStatusRequest(vehicle.id, VehicleStatus.RETIRED),
        onSuccess: () => {
            toast.success("Vehicle retired successfully")
            queryClient.invalidateQueries({ queryKey: ["fleet"] })
            setVehicleToDelete(null)
        },
        onError: () => {
            toast.error("Failed to retire vehicle")
        },
    })

    const handleAddVehicle = () => {
        setFormMode("create")
        setEditingVehicle(null)
        setShowForm(true)
    }

    const handleEditVehicle = (vehicle: Vehicle) => {
        setFormMode("edit")
        setEditingVehicle(vehicle)
        setShowForm(true)
    }

    const handleStatusChange = (vehicle: Vehicle, status: VehicleStatus) => {
        statusMutation.mutate({ id: vehicle.id, status })
    }

    const handleDelete = (vehicle: Vehicle) => {
        setVehicleToDelete(vehicle)
    }

    const confirmDelete = () => {
        if (vehicleToDelete) {
            deleteMutation.mutate(vehicleToDelete)
        }
    }

    const handleFormSuccess = () => {
        setShowForm(false)
        queryClient.invalidateQueries({ queryKey: ["fleet"] })
    }

    if (isLoading) {
        return <FleetListSkeleton />
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 py-12 px-4 text-center">
                <p className="text-sm text-destructive">Failed to load vehicles</p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Retry
                </Button>
            </div>
        )
    }

    if (vehicles.length === 0) {
        return (
            <>
                <EmptyState
                    title="No vehicles found"
                    description="Get started by adding your first vehicle to the fleet."
                    actionLabel="Add Vehicle"
                    onAction={handleAddVehicle}
                />
                <FleetForm
                    open={showForm}
                    onOpenChange={setShowForm}
                    mode={formMode}
                    vehicle={editingVehicle}
                    saccoId={saccoId}
                    onSuccess={handleFormSuccess}
                />
            </>
        )
    }

    if (filteredVehicles.length === 0) {
        return (
            <>
                <div className="space-y-3">
                    <FleetToolbar
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        statusFilter={statusFilter}
                        onStatusFilterChange={setStatusFilter}
                        onAddVehicle={handleAddVehicle}
                        totalCount={total}
                    />
                    {isAwaitingBackendResult ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                            Searching...
                        </div>
                    ) : (
                        <EmptyState
                            title="No matching vehicles"
                            description={`No vehicles found matching "${searchQuery}"`}
                            actionLabel="Clear search"
                            onAction={() => setSearchQuery("")}
                        />
                    )}
                </div>
                <FleetForm
                    open={showForm}
                    onOpenChange={setShowForm}
                    mode={formMode}
                    vehicle={editingVehicle}
                    saccoId={saccoId}
                    onSuccess={handleFormSuccess}
                />
            </>
        )
    }

    return (
        <>
            <div className={cn("space-y-4", className)}>
                <FleetToolbar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    onAddVehicle={handleAddVehicle}
                    totalCount={total}
                />

                <div className="grid gap-2">
                    {filteredVehicles.map((vehicle) => (
                        <VehicleCard
                            key={vehicle.id}
                            vehicle={vehicle}
                            onSelect={() => {
                                setSelectedVehicle(vehicle)
                                onVehicleSelect?.(vehicle)
                            }}
                            onEdit={() => handleEditVehicle(vehicle)}
                            onStatusChange={(status) => handleStatusChange(vehicle, status)}
                            onDelete={() => handleDelete(vehicle)}
                            isUpdating={statusMutation.isPending}
                        />
                    ))}
                </div>
            </div>

            <VehicleDetailsDialog
                vehicle={selectedVehicle}
                open={!!selectedVehicle}
                onOpenChange={() => setSelectedVehicle(null)}
                onEdit={() => {
                    if (selectedVehicle) {
                        handleEditVehicle(selectedVehicle)
                        setSelectedVehicle(null)
                    }
                }}
            />

            <FleetForm
                open={showForm}
                onOpenChange={setShowForm}
                mode={formMode}
                vehicle={editingVehicle}
                saccoId={saccoId}
                onSuccess={handleFormSuccess}
            />

            <Dialog open={!!vehicleToDelete} onOpenChange={() => setVehicleToDelete(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Retire Vehicle</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to retire {vehicleToDelete?.numberPlate}? This action can be reversed.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => setVehicleToDelete(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            className="w-full sm:w-auto"
                            onClick={confirmDelete}
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? "Retiring..." : "Retire Vehicle"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

// ─── Subcomponents (unchanged) ─────────────────────────────────────────────
// FleetToolbar, VehicleCard, VehicleDetailsDialog, FleetListSkeleton, EmptyState
// stay exactly as you had them — paste those back in below unchanged.
// ─── Subcomponents ──────────────────────────────────────────────────────────

interface FleetToolbarProps {
    searchQuery: string
    onSearchChange: (value: string) => void
    statusFilter: VehicleStatus | "all"
    onStatusFilterChange: (value: VehicleStatus | "all") => void
    onAddVehicle: () => void
    totalCount: number
}

function FleetToolbar({
    searchQuery,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    onAddVehicle,
    totalCount,
}: FleetToolbarProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
                <h2 className="text-base font-medium">Fleet</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {totalCount}
                </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 sm:flex-none">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                        type="search"
                        placeholder="Search vehicles..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="h-8 pl-7 pr-7 text-xs bg-muted/30 border-muted-foreground/10 focus-visible:ring-0 w-full sm:w-44"
                        aria-label="Search vehicles"
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

                <Select
                    value={statusFilter}
                    onValueChange={(value) => onStatusFilterChange(value as VehicleStatus | "all")}
                >
                    <SelectTrigger className="h-8 w-[140px] text-xs bg-muted/30 border-muted-foreground/10">
                        <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        {Object.values(VehicleStatus).map((status) => (
                            <SelectItem key={status} value={status}>
                                {status.charAt(0) + status.slice(1).toLowerCase()}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Button size="sm" onClick={onAddVehicle} className="gap-1.5">
                    <Plus className="size-3.5" />
                    <span className="hidden sm:inline text-xs">Add</span>
                </Button>
            </div>
        </div>
    )
}

interface VehicleCardProps {
    vehicle: Vehicle
    onSelect: () => void
    onEdit: () => void
    onStatusChange: (status: VehicleStatus) => void
    onDelete: () => void
    isUpdating?: boolean
}

function VehicleCard({
    vehicle,
    onSelect,
    onEdit,
    onStatusChange,
    onDelete,
    isUpdating,
}: VehicleCardProps) {
    const StatusIcon = STATUS_ICONS[vehicle.status]
    const saccoName = useSaccoName(vehicle.saccoId)


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
            className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-all hover:bg-accent/30 hover:border-muted-foreground/20 cursor-pointer"
        >
            <Car className="size-4 text-muted-foreground/50 shrink-0" />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="truncate text-sm font-medium">
                        {vehicle.numberPlate}
                    </p>
                    <Badge
                        variant="outline"
                        className={cn(
                            "text-[10px] h-5 px-1.5 font-medium border",
                            STATUS_COLORS[vehicle.status]
                        )}
                    >
                        <StatusIcon className="size-2.5 mr-1" />
                        {vehicle.status.charAt(0) + vehicle.status.slice(1).toLowerCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground/60">
                        {vehicle.seatingCapacity} seats
                    </span>
                    {saccoName && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                            {saccoName}
                        </p>
                    )}
                </div>
                {vehicle.notes && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                        {vehicle.notes}
                    </p>
                )}
            </div>

            <div
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <DropdownMenu>
                    <DropdownMenuTrigger >
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/50 hover:text-foreground hover:bg-transparent"
                            aria-label={`Actions for ${vehicle.numberPlate}`}
                            disabled={isUpdating}
                        >
                            <MoreVertical className="size-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={onSelect}>
                            <Car className="size-3.5 mr-2" />
                            View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onEdit}>
                            <Pencil className="size-3.5 mr-2" />
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                            onClick={() => onStatusChange(VehicleStatus.ACTIVE)}
                            disabled={vehicle.status === VehicleStatus.ACTIVE}
                            className="text-emerald-600 dark:text-emerald-400"
                        >
                            <CheckCircle className="size-3.5 mr-2" />
                            Set Active
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => onStatusChange(VehicleStatus.MAINTENANCE)}
                            disabled={vehicle.status === VehicleStatus.MAINTENANCE}
                            className="text-amber-600 dark:text-amber-400"
                        >
                            <AlertCircle className="size-3.5 mr-2" />
                            Set Maintenance
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => onStatusChange(VehicleStatus.RETIRED)}
                            disabled={vehicle.status === VehicleStatus.RETIRED}
                            className="text-red-600 dark:text-red-400"
                        >
                            <XCircle className="size-3.5 mr-2" />
                            Set Retired
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={onDelete}
                            className="text-destructive"
                            disabled={vehicle.status === VehicleStatus.RETIRED}
                        >
                            <Trash2 className="size-3.5 mr-2" />
                            Retire Vehicle
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <ChevronRight className="size-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            </div>
        </div>
    )
}

interface VehicleDetailsDialogProps {
    vehicle: Vehicle | null
    open: boolean
    onOpenChange: () => void
    onEdit: () => void
}

function VehicleDetailsDialog({
    vehicle,
    open,
    onOpenChange,
    onEdit,
}: VehicleDetailsDialogProps) {
    const saccoName = useSaccoName(vehicle?.saccoId)

    if (!vehicle) return null

    const StatusIcon = STATUS_ICONS[vehicle.status]

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-5">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <Car className="size-4 text-muted-foreground shrink-0" />
                        <DialogTitle className="truncate text-foreground min-w-0">
                            {vehicle.numberPlate}
                        </DialogTitle>
                    </div>
                    <DialogDescription className="flex items-center gap-2">
                        <Badge
                            variant="outline"
                            className={cn(
                                "text-[10px] h-5 px-1.5 font-medium border",
                                STATUS_COLORS[vehicle.status]
                            )}
                        >
                            <StatusIcon className="size-2.5 mr-1" />
                            {vehicle.status.charAt(0) + vehicle.status.slice(1).toLowerCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            {vehicle.seatingCapacity} seats
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-2">
                    {saccoName && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Sacco</p>
                            <p className="text-sm">{saccoName}</p>
                        </div>
                    )}

                    {vehicle.notes && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Notes</p>
                            <p className="text-sm whitespace-pre-wrap">{vehicle.notes}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <p className="font-medium text-muted-foreground">Added on</p>
                            <p>{formatDate(vehicle.createdAt)}</p>
                        </div>
                        <div>
                            <p className="font-medium text-muted-foreground">Last updated</p>
                            <p>{formatUpdatedAt(vehicle.updatedAt)}</p>
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

function FleetListSkeleton() {
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
                <Car className="size-5 text-muted-foreground/40" />
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