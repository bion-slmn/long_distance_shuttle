// src/features/fleet/FleetListView.tsx
import { useState, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "motion/react"
import {
    MoreVertical,
    Plus,
    Search,
    Truck,
    Wrench,
    CheckCircle2,
    XCircle,
    Pencil,
    Trash2,
    ChevronRight,
    ChevronLeft,
    Eye,
    Users,
    Route,
    Clock,
    Building2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { SaccoCombobox } from "../sacco/SaccoCombobox"

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

// ─── Design tokens (matches FleetManager) ────────────────────────────────────

const STATUS_BADGE: Record<VehicleStatus, string> = {
    [VehicleStatus.ACTIVE]:
        "bg-emerald-50 text-emerald-700 border-emerald-100",
    [VehicleStatus.MAINTENANCE]: "bg-rose-50 text-rose-700 border-rose-100",
    [VehicleStatus.RETIRED]: "bg-slate-100 text-slate-500 border-slate-200",
}

const STATUS_ICONS = {
    [VehicleStatus.ACTIVE]: CheckCircle2,
    [VehicleStatus.MAINTENANCE]: Wrench,
    [VehicleStatus.RETIRED]: XCircle,
}

const STATUS_LABELS: Record<VehicleStatus, string> = {
    [VehicleStatus.ACTIVE]: "Active",
    [VehicleStatus.MAINTENANCE]: "Repair",
    [VehicleStatus.RETIRED]: "Retired",
}

const QUEUE_STATUS_BADGE: Record<string, string> = {
    WAITING: "bg-amber-50 text-amber-700 border-amber-100",
    BOARDING: "bg-violet-50 text-violet-700 border-violet-100",
    DISPATCHED: "bg-emerald-50 text-emerald-700 border-emerald-100",
}

const QUEUE_STATUS_LABELS: Record<string, string> = {
    WAITING: "Waiting",
    BOARDING: "Loading",
    DISPATCHED: "En Route",
}

const inputClass =
    "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-900"

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
    const [saccoFilter, setSaccoFilter] = useState<string>("")
    const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null)
    const [selectedVehicle, setSelectedVehicle] = useState<VehicleWithQueue | null>(null)
    const [page, setPage] = useState(1)
    const [isMobile, setIsMobile] = useState(false)

    const queryClient = useQueryClient()
    const PAGE_SIZE = 20

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

    const queryKey = ["fleet", "list", { saccoId, status: statusFilter, page, search: searchQuery, saccoFilter }]

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

    // Filter vehicles by sacco client-side since the API doesn't support sacco filtering
    const allVehicles = (response?.data as VehicleWithQueue[]) ?? []
    const filteredVehicles = saccoFilter
        ? allVehicles.filter(v => v.saccoId === saccoFilter)
        : allVehicles

    const total = response?.total ?? 0
    const totalPages = response?.totalPages ?? 1

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
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-rose-200 bg-rose-50 py-12 px-4 text-center">
                <p className="text-sm font-medium text-rose-600">Failed to load vehicles</p>
                <Button
                    size="sm"
                    onClick={() => window.location.reload()}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg"
                >
                    Retry
                </Button>
            </div>
        )
    }

    return (
        <>
            <div className={cn("bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col", className)}>
                <FleetToolbar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    saccoFilter={saccoFilter}
                    onSaccoFilterChange={setSaccoFilter}
                    onAddVehicle={handleAddVehicle}
                    totalCount={filteredVehicles.length}
                />

                {!filteredVehicles || filteredVehicles.length === 0 ? (
                    <EmptyState
                        title={saccoFilter ? "No vehicles found for this sacco" : "No vehicles found"}
                        description={saccoFilter
                            ? "Try selecting a different sacco or clear the filter"
                            : "Get started by adding your first vehicle to the fleet."
                        }
                        actionLabel="Add Vehicle"
                        onAction={handleAddVehicle}
                    />
                ) : (
                    <div className="flex-1 overflow-y-auto max-h-[600px] pr-1 space-y-3">
                        <AnimatePresence initial={false}>
                            {filteredVehicles.map((vehicle) =>
                                isMobile ? (
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
                                ) : (
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
                                )
                            )}
                        </AnimatePresence>
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
                <DialogContent className="sm:max-w-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle className="font-display text-slate-900">Retire Vehicle</DialogTitle>
                        <DialogDescription className="text-slate-500">
                            Are you sure you want to retire {vehicleToDelete?.numberPlate}? This action can be reversed.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto rounded-lg border-slate-200 text-slate-600 font-bold text-xs"
                            onClick={() => setVehicleToDelete(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="w-full sm:w-auto rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
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
        <div className="flex items-center justify-between pt-4 mt-1 border-t border-slate-100">
            <p className="text-xs text-slate-400 font-mono">
                Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-1.5">
                <button
                    className="py-1.5 px-2.5 text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-1 transition-all disabled:opacity-40 disabled:pointer-events-none"
                    disabled={disabled || page <= 1}
                    onClick={() => onPageChange(page - 1)}
                >
                    <ChevronLeft className="size-3.5" />
                    Prev
                </button>
                <button
                    className="py-1.5 px-2.5 text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-1 transition-all disabled:opacity-40 disabled:pointer-events-none"
                    disabled={disabled || page >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                >
                    Next
                    <ChevronRight className="size-3.5" />
                </button>
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
    saccoFilter: string
    onSaccoFilterChange: (value: string) => void
    onAddVehicle: () => void
    totalCount: number
}

function FleetToolbar({
    searchQuery,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    saccoFilter,
    onSaccoFilterChange,
    onAddVehicle,
    totalCount,
}: FleetToolbarProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
                <div className="flex items-center gap-2">
                    <Truck className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-lg font-bold font-display text-slate-900">
                        Fleet ({totalCount})
                    </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">Manage statuses, drivers, and maintenance schedules</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 sm:flex-none">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                        type="search"
                        placeholder="Search vehicles..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="py-1.5 pl-7 pr-6 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-900 w-full sm:w-44"
                        aria-label="Search vehicles"
                    />
                    {searchQuery && (
                        <button
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
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
                    <SelectTrigger className="h-auto py-1.5 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-600 w-[130px]">
                        <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        {Object.values(VehicleStatus).map((status) => (
                            <SelectItem key={status} value={status}>
                                {STATUS_LABELS[status]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="w-[160px]">
                    <SaccoCombobox
                        value={saccoFilter}
                        onChange={onSaccoFilterChange}
                        placeholder="All Saccos..."
                        className="h-auto py-1.5 px-2.5 text-xs"
                    />
                </div>

                <button
                    onClick={onAddVehicle}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 shadow transition-all duration-200 active:scale-[0.98]"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                </button>
            </div>
        </div>
    )
}

// ─── Status pill (shared) ───────────────────────────────────────────────────

function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
    const Icon = STATUS_ICONS[status]
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border uppercase font-mono",
                STATUS_BADGE[status]
            )}
        >
            <Icon className="w-3 h-3" />
            {STATUS_LABELS[status]}
        </span>
    )
}

function QueueStatusBadge({ status }: { status: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border uppercase font-mono",
                QUEUE_STATUS_BADGE[status]
            )}
        >
            {status === "BOARDING" ? (
                <span className="w-1.5 h-1.5 bg-violet-600 rounded-full animate-ping" />
            ) : (
                <Clock className="w-3 h-3" />
            )}
            {QUEUE_STATUS_LABELS[status] || status}
        </span>
    )
}

// ─── Row action menu (shared) ───────────────────────────────────────────────

interface RowActionsProps {
    vehicle: Vehicle
    onSelect: () => void
    onEdit: () => void
    onStatusChange: (status: VehicleStatus) => void
    onDelete: () => void
    isUpdating?: boolean
}

function RowActionsMenu({ vehicle, onSelect, onEdit, onStatusChange, onDelete, isUpdating }: RowActionsProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger>
                <button
                    className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-40"
                    aria-label={`Actions for ${vehicle.numberPlate}`}
                    disabled={isUpdating}
                    onClick={(e) => e.stopPropagation()}
                >
                    <MoreVertical className="size-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl border-slate-200">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect() }} className="text-xs font-medium">
                    <Eye className="size-3.5 mr-2" />
                    View details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit() }} className="text-xs font-medium">
                    <Pencil className="size-3.5 mr-2" />
                    Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onStatusChange(VehicleStatus.ACTIVE) }}
                    disabled={vehicle.status === VehicleStatus.ACTIVE}
                    className="text-xs font-bold text-emerald-600"
                >
                    <CheckCircle2 className="size-3.5 mr-2" />
                    Set Active
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onStatusChange(VehicleStatus.MAINTENANCE) }}
                    disabled={vehicle.status === VehicleStatus.MAINTENANCE}
                    className="text-xs font-bold text-rose-600"
                >
                    <Wrench className="size-3.5 mr-2" />
                    Send to Shop
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onStatusChange(VehicleStatus.RETIRED) }}
                    disabled={vehicle.status === VehicleStatus.RETIRED}
                    className="text-xs font-bold text-slate-500"
                >
                    <XCircle className="size-3.5 mr-2" />
                    Set Retired
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onDelete() }}
                    className="text-xs font-bold text-rose-600"
                    disabled={vehicle.status === VehicleStatus.RETIRED}
                >
                    <Trash2 className="size-3.5 mr-2" />
                    Retire Vehicle
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

// ─── Desktop Row (card style, matches FleetManager) ─────────────────────────

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
    const saccoName = useSaccoName(vehicle.saccoId)
    const queue = vehicle.queue

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect()
                }
            }}
            className="border border-slate-200 hover:border-slate-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-all cursor-pointer"
        >
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base font-display text-slate-900">
                        {vehicle.numberPlate}
                    </span>
                    {saccoName && (
                        <span className="text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                            {saccoName}
                        </span>
                    )}
                    <VehicleStatusBadge status={vehicle.status} />
                    {queue?.status && <QueueStatusBadge status={queue.status} />}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
                    <p className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        Seats: <span className="font-mono font-medium text-slate-700">{vehicle.seatingCapacity}</span>
                    </p>
                    {queue?.route && (
                        <>
                            <p>•</p>
                            <p className="flex items-center gap-1 min-w-0">
                                <Route className="w-3 h-3 shrink-0" />
                                <span className="truncate">
                                    {queue.route.origin} → {queue.route.destination}
                                </span>
                            </p>
                        </>
                    )}
                    {vehicle.notes && (
                        <>
                            <p>•</p>
                            <p className="truncate max-w-[220px]">{vehicle.notes}</p>
                        </>
                    )}
                </div>
            </div>

            <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="flex items-center gap-2 shrink-0"
            >
                <RowActionsMenu
                    vehicle={vehicle}
                    onSelect={onSelect}
                    onEdit={onEdit}
                    onStatusChange={onStatusChange}
                    onDelete={onDelete}
                    isUpdating={isUpdating}
                />
            </div>
        </motion.div>
    )
}

// ─── Mobile Card ────────────────────────────────────────────────────────────

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
    const queue = vehicle.queue

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect()
                }
            }}
            className="border border-slate-200 hover:border-slate-300 rounded-xl p-3.5 transition-all cursor-pointer"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <Truck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-bold text-sm font-display text-slate-900 truncate">
                        {vehicle.numberPlate}
                    </span>
                </div>
                <div className="shrink-0">
                    <RowActionsMenu
                        vehicle={vehicle}
                        onSelect={onSelect}
                        onEdit={onEdit}
                        onStatusChange={onStatusChange}
                        onDelete={onDelete}
                        isUpdating={isUpdating}
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 pl-5.5 text-xs text-slate-500">
                <VehicleStatusBadge status={vehicle.status} />

                <span className="flex items-center gap-1">
                    <Users className="size-3" />
                    {vehicle.seatingCapacity}
                </span>

                {queue?.status && <QueueStatusBadge status={queue.status} />}

                {queue?.route && (
                    <span className="flex items-center gap-1 min-w-0">
                        <Route className="size-3 shrink-0" />
                        <span className="truncate">
                            {queue.route.origin} → {queue.route.destination}
                        </span>
                    </span>
                )}
            </div>
        </motion.div>
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

    const queue = vehicle.queue

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-5 max-h-[90vh] overflow-y-auto rounded-2xl">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-emerald-600 shrink-0" />
                        <DialogTitle className="truncate font-display text-slate-900 min-w-0">
                            {vehicle.numberPlate}
                        </DialogTitle>
                    </div>
                    <DialogDescription className="flex items-center gap-2 pt-1">
                        <VehicleStatusBadge status={vehicle.status} />
                        <span className="text-xs text-slate-400">
                            {vehicle.seatingCapacity} seats
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-2">
                    {saccoName && (
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Sacco</p>
                            <p className="text-sm text-slate-900">{saccoName}</p>
                        </div>
                    )}

                    <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Queue Status</p>
                        {queue?.status ? (
                            <div className="space-y-1 mt-1">
                                <QueueStatusBadge status={queue.status} />
                                {queue.route && (
                                    <p className="text-sm text-slate-900">
                                        {queue.route.origin} → {queue.route.destination}
                                    </p>
                                )}
                                {queue.clockedInAt && (
                                    <p className="text-xs text-slate-400">
                                        Clocked in: {new Date(queue.clockedInAt).toLocaleString()}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400">Not in queue</p>
                        )}
                    </div>

                    {vehicle.notes && (
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notes</p>
                            <p className="text-sm text-slate-900 whitespace-pre-wrap">{vehicle.notes}</p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <p className="font-bold text-slate-500 uppercase tracking-wider">Added on</p>
                            <p className="text-slate-700 font-mono mt-0.5">{formatDate(vehicle.createdAt)}</p>
                        </div>
                        <div>
                            <p className="font-bold text-slate-500 uppercase tracking-wider">Last updated</p>
                            <p className="text-slate-700 font-mono mt-0.5">{formatUpdatedAt(vehicle.updatedAt)}</p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 pt-2">
                    <button
                        onClick={onEdit}
                        className="flex-1 py-2 px-3 text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg flex items-center justify-center gap-1.5 transition-all"
                    >
                        <Pencil className="size-3.5" />
                        Edit
                    </button>
                    <button
                        onClick={onOpenChange}
                        className="flex-1 py-2 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all"
                    >
                        Close
                    </button>
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
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs animate-pulse">
            <div className="flex items-center justify-between mb-6">
                <div className="space-y-2">
                    <div className="h-5 w-40 bg-slate-100 rounded" />
                    <div className="h-3 w-56 bg-slate-100 rounded" />
                </div>
                <div className="h-8 w-32 bg-slate-100 rounded-lg" />
            </div>
            <div className="space-y-3">
                {Array.from({ length: isMobile ? 4 : 5 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="h-4 w-24 bg-slate-100 rounded" />
                            <div className="h-4 w-16 bg-slate-100 rounded-full" />
                            <div className="h-4 w-16 bg-slate-100 rounded-full" />
                        </div>
                        <div className="h-3 w-2/3 bg-slate-100 rounded" />
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
        <div className="text-center text-slate-400 py-12 border border-dashed border-slate-200 rounded-2xl">
            <Truck className="w-12 h-12 text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-500">{title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{description}</p>
            {actionLabel && onAction && (
                <button
                    onClick={onAction}
                    className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-4 rounded-lg inline-flex items-center gap-1.5 shadow transition-all duration-200 active:scale-[0.98]"
                >
                    <Plus className="w-3.5 h-3.5" />
                    {actionLabel}
                </button>
            )}
        </div>
    )
}