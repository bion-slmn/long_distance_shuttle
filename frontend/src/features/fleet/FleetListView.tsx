// src/features/fleet/FleetListView.tsx
import { useState, useEffect } from "react"
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
    ChevronLeft,
    Eye,
    Users,
    Route,
    Clock,
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
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

// Extended Vehicle type with queue data
interface VehicleWithQueue extends Vehicle {
    queue?: {
        status: "WAITING" | "BOARDING" | "DISPATCHED"
        clockedInAt: string
        route: {
            id: string
            origin: string
            destination: string
        }
    }
}

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

const QUEUE_STATUS_COLORS: Record<string, string> = {
    WAITING: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20",
    BOARDING: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20",
    DISPATCHED: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20",
}

const QUEUE_STATUS_LABELS: Record<string, string> = {
    WAITING: "Waiting",
    BOARDING: "Boarding",
    DISPATCHED: "Dispatched",
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
    const [selectedVehicle, setSelectedVehicle] = useState<VehicleWithQueue | null>(null)
    const [page, setPage] = useState(1)
    const [isMobile, setIsMobile] = useState(false)

    const queryClient = useQueryClient()
    const PAGE_SIZE = 20

    // Check if mobile
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    const queryKey = ["fleet", "list", { saccoId, status: statusFilter, page, search: searchQuery }]

    const { data: response, isLoading, error, isPlaceholderData } = useQuery({
        queryKey,
        queryFn: () => getFleetRequest({
            status: statusFilter !== "all" ? statusFilter : undefined,
            page,
            limit: PAGE_SIZE,
            search: searchQuery || undefined,
            withQueueStatus: true,
        }),
        staleTime: 5 * 60 * 1000,
        placeholderData: (prev) => prev,
    })

    const vehicles = (response?.data as VehicleWithQueue[]) ?? []
    const total = response?.total ?? 0
    const totalPages = response?.totalPages ?? 1

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
        return <FleetListSkeleton isMobile={isMobile} />
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

    if (!vehicles || vehicles.length === 0) {
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
                    isMobile={isMobile}
                />

                {isMobile ? (
                    <div className="grid gap-2">
                        {vehicles.map((vehicle) => (
                            <MobileVehicleCard
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
                ) : (
                    <div className="rounded-lg border bg-card overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="w-[20%]">Vehicle</TableHead>
                                    <TableHead className="w-[12%]">Status</TableHead>
                                    <TableHead className="w-[10%] text-center">Seats</TableHead>
                                    <TableHead className="w-[18%]">Queue Status</TableHead>
                                    <TableHead className="w-[20%]">Route</TableHead>
                                    <TableHead className="w-[10%]">Notes</TableHead>
                                    <TableHead className="w-[10%] text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {vehicles.map((vehicle) => (
                                    <DesktopVehicleRow
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
                            </TableBody>
                        </Table>
                    </div>
                )}

                <FleetPagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    disabled={isPlaceholderData}
                />
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

// ─── Pagination ─────────────────────────────────────────────────────────────

interface FleetPaginationProps {
    page: number
    totalPages: number
    onPageChange: (page: number) => void
    disabled?: boolean
}

function FleetPagination({ page, totalPages, onPageChange, disabled }: FleetPaginationProps) {
    if (totalPages <= 1) return null

    return (
        <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-1.5">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs px-2"
                    disabled={disabled || page <= 1}
                    onClick={() => onPageChange(page - 1)}
                >
                    <ChevronLeft className="size-3.5" />
                    Prev
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs px-2"
                    disabled={disabled || page >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                >
                    Next
                    <ChevronRight className="size-3.5" />
                </Button>
            </div>
        </div>
    )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

interface FleetToolbarProps {
    searchQuery: string
    onSearchChange: (value: string) => void
    statusFilter: VehicleStatus | "all"
    onStatusFilterChange: (value: VehicleStatus | "all") => void
    onAddVehicle: () => void
    totalCount: number
    isMobile: boolean
}

function FleetToolbar({
    searchQuery,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    onAddVehicle,
    totalCount,
    isMobile,
}: FleetToolbarProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
                <h2 className="text-base font-medium">Fleet</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono">
                    {totalCount}
                </Badge>
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

// ─── Desktop Table Row ──────────────────────────────────────────────────────

interface DesktopVehicleRowProps {
    vehicle: VehicleWithQueue
    onSelect: () => void
    onEdit: () => void
    onStatusChange: (status: VehicleStatus) => void
    onDelete: () => void
    isUpdating?: boolean
}

function DesktopVehicleRow({
    vehicle,
    onSelect,
    onEdit,
    onStatusChange,
    onDelete,
    isUpdating,
}: DesktopVehicleRowProps) {
    const StatusIcon = STATUS_ICONS[vehicle.status]
    const saccoName = useSaccoName(vehicle.saccoId)

    const queue = vehicle.queue
    const queueStatus = queue?.status
    const queueRoute = queue?.route
    const clockedInAt = queue?.clockedInAt

    return (
        <TableRow
            className="group cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={onSelect}
        >
            <TableCell>
                <div className="flex items-center gap-3">
                    <Car className="size-4 text-muted-foreground/50 shrink-0" />
                    <div className="min-w-0">
                        <p className="truncate font-medium">{vehicle.numberPlate}</p>
                        {saccoName && (
                            <p className="text-xs text-muted-foreground/70 truncate">{saccoName}</p>
                        )}
                    </div>
                </div>
            </TableCell>
            <TableCell>
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
            </TableCell>
            <TableCell className="text-center font-semibold">
                {vehicle.seatingCapacity}
            </TableCell>
            <TableCell>
                {queueStatus ? (
                    <Badge
                        variant="outline"
                        className={cn(
                            "text-[10px] h-5 px-1.5 font-medium border",
                            QUEUE_STATUS_COLORS[queueStatus]
                        )}
                    >
                        <Clock className="size-2.5 mr-1" />
                        {QUEUE_STATUS_LABELS[queueStatus] || queueStatus}
                    </Badge>
                ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                )}
            </TableCell>
            <TableCell>
                {queueRoute ? (
                    <div className="text-xs">
                        <p className="font-medium truncate">
                            {queueRoute.origin} → {queueRoute.destination}
                        </p>
                        {clockedInAt && (
                            <p className="text-[10px] text-muted-foreground">
                                {new Date(clockedInAt).toLocaleTimeString()}
                            </p>
                        )}
                    </div>
                ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                )}
            </TableCell>
            <TableCell>
                <p className="truncate text-xs text-muted-foreground">
                    {vehicle.notes || "—"}
                </p>
            </TableCell>
            <TableCell className="text-right">
                <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex items-center justify-end gap-1"
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
                                <Eye className="size-3.5 mr-2" />
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
                </div>
            </TableCell>
        </TableRow>
    )
}

// ─── Mobile Minimalistic Card ──────────────────────────────────────────────

interface MobileVehicleCardProps {
    vehicle: VehicleWithQueue
    onSelect: () => void
    onEdit: () => void
    onStatusChange: (status: VehicleStatus) => void
    onDelete: () => void
    isUpdating?: boolean
}

function MobileVehicleCard({
    vehicle,
    onSelect,
    onEdit,
    onStatusChange,
    onDelete,
    isUpdating,
}: MobileVehicleCardProps) {
    const StatusIcon = STATUS_ICONS[vehicle.status]

    const queue = vehicle.queue
    const queueStatus = queue?.status
    const queueRoute = queue?.route

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
            className="rounded-lg border bg-card p-3 transition-all hover:bg-accent/30 hover:border-muted-foreground/20 cursor-pointer"
        >
            {/* Header row: plate on the left, status + menu on the right */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Car className="size-4 text-muted-foreground/40 shrink-0" />
                    <p className="truncate font-semibold text-sm">
                        {vehicle.numberPlate}
                    </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
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

                    <DropdownMenu>
                        <DropdownMenuTrigger>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground/30 hover:text-foreground"
                                aria-label={`Actions for ${vehicle.numberPlate}`}
                                onClick={(e) => e.stopPropagation()}
                                disabled={isUpdating}
                            >
                                <MoreVertical className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect() }}>
                                <Eye className="size-3.5 mr-2" />
                                View
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit() }}>
                                <Pencil className="size-3.5 mr-2" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); onStatusChange(VehicleStatus.ACTIVE) }}
                                disabled={vehicle.status === VehicleStatus.ACTIVE}
                                className="text-emerald-600 dark:text-emerald-400"
                            >
                                <CheckCircle className="size-3.5 mr-2" />
                                Active
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); onStatusChange(VehicleStatus.MAINTENANCE) }}
                                disabled={vehicle.status === VehicleStatus.MAINTENANCE}
                                className="text-amber-600 dark:text-amber-400"
                            >
                                <AlertCircle className="size-3.5 mr-2" />
                                Maintenance
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); onStatusChange(VehicleStatus.RETIRED) }}
                                disabled={vehicle.status === VehicleStatus.RETIRED}
                                className="text-red-600 dark:text-red-400"
                            >
                                <XCircle className="size-3.5 mr-2" />
                                Retired
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); onDelete() }}
                                className="text-destructive"
                                disabled={vehicle.status === VehicleStatus.RETIRED}
                            >
                                <Trash2 className="size-3.5 mr-2" />
                                Retire
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Secondary row: seats, queue status, route — visible but subdued vs plate */}
            <div className="flex items-center gap-3 mt-1.5 pl-5.5">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3" />
                    {vehicle.seatingCapacity}
                </span>

                {queueStatus && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {QUEUE_STATUS_LABELS[queueStatus] || queueStatus}
                    </span>
                )}

                {queueRoute && (
                    <span className="flex items-center gap-1 min-w-0 text-xs text-muted-foreground">
                        <Route className="size-3 shrink-0" />
                        <span className="truncate">
                            {queueRoute.origin} → {queueRoute.destination}
                        </span>
                    </span>
                )}
            </div>
        </div>
    )
}
// ─── Details Dialog ─────────────────────────────────────────────────────────

interface VehicleDetailsDialogProps {
    vehicle: VehicleWithQueue | null
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
    const queue = vehicle.queue
    const queueStatus = queue?.status
    const queueRoute = queue?.route
    const clockedInAt = queue?.clockedInAt

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-5 max-h-[90vh] overflow-y-auto">
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

                    {/* Queue Status */}
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Queue Status</p>
                        {queueStatus ? (
                            <div className="space-y-1">
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        "text-[10px] h-5 px-1.5 font-medium border",
                                        QUEUE_STATUS_COLORS[queueStatus]
                                    )}
                                >
                                    <Clock className="size-2.5 mr-1" />
                                    {QUEUE_STATUS_LABELS[queueStatus] || queueStatus}
                                </Badge>
                                {queueRoute && (
                                    <p className="text-sm">
                                        {queueRoute.origin} → {queueRoute.destination}
                                    </p>
                                )}
                                {clockedInAt && (
                                    <p className="text-xs text-muted-foreground">
                                        Clocked in: {new Date(clockedInAt).toLocaleString()}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">Not in queue</p>
                        )}
                    </div>

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

// ─── Skeleton ───────────────────────────────────────────────────────────────

interface FleetListSkeletonProps {
    isMobile?: boolean
}

function FleetListSkeleton({ isMobile }: FleetListSkeletonProps) {
    if (isMobile) {
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-7 w-32" />
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-4 w-4 rounded" />
                            <Skeleton className="h-4 flex-1" />
                            <Skeleton className="h-5 w-14" />
                            <Skeleton className="h-7 w-7 rounded" />
                        </div>
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-3 w-10" />
                            <Skeleton className="h-3 w-12" />
                            <Skeleton className="h-3 w-16" />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-7 w-24" />
            </div>
            <div className="rounded-lg border">
                <div className="p-4 border-b bg-muted/50">
                    <div className="grid grid-cols-7 gap-4">
                        <Skeleton className="h-4 w-full" />
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
                        <div className="grid grid-cols-7 gap-4 items-center">
                            <Skeleton className="h-5 w-3/4" />
                            <Skeleton className="h-5 w-16" />
                            <Skeleton className="h-5 w-12 mx-auto" />
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-7 w-20 ml-auto" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── Empty State ────────────────────────────────────────────────────────────

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