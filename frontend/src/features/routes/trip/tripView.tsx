// src/features/trips/TripListView.tsx
import { useState, useEffect, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
    Search,
    X,
    Calendar,
    ChevronLeft,
    ChevronRight,
    MoreVertical,
    Eye,
    Pencil,
    Truck,
    User,
    Clock,
    DollarSign,
    Users,
    CheckCircle,
    XCircle,
    AlertCircle,
    MapPin,
    RefreshCw,
    Filter,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { getTrips, cancelTrip, TripStatus, type Trip } from "@/api/tripApi"
import { useSaccoName } from "@/hooks/useSaccoName"
import { useRouteName, } from "@/hooks/useRoute"
import { useVehicleNumberPlate } from "@/hooks/useVehicleNumberPlate"

interface TripListViewProps {
    saccoId?: string
    className?: string
}

const STATUS_COLORS: Record<TripStatus, string> = {
    [TripStatus.BOARDING]: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20",
    [TripStatus.EN_ROUTE]: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20",
    [TripStatus.COMPLETED]: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20",
    [TripStatus.CANCELLED]: "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400 border-red-500/20",
}

const STATUS_ICONS: Record<TripStatus, any> = {
    [TripStatus.BOARDING]: Clock,
    [TripStatus.EN_ROUTE]: Truck,
    [TripStatus.COMPLETED]: CheckCircle,
    [TripStatus.CANCELLED]: XCircle,
}

const STATUS_LABELS: Record<TripStatus, string> = {
    [TripStatus.BOARDING]: "Boarding",
    [TripStatus.EN_ROUTE]: "En Route",
    [TripStatus.COMPLETED]: "Completed",
    [TripStatus.CANCELLED]: "Cancelled",
}

function todayIso() {
    const d = new Date()
    return d.toISOString().slice(0, 10)
}

export function TripListView({ saccoId, className }: TripListViewProps) {
    const [searchQuery, setSearchQuery] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [statusFilter, setStatusFilter] = useState<TripStatus | "all">("all")
    const [selectedDate, setSelectedDate] = useState<string>(todayIso())
    const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
    const [page, setPage] = useState(1)
    const [isMobile, setIsMobile] = useState(false)

    const queryClient = useQueryClient()
    const limit = 20

    // Debounce search input so we don't fire a request per keystroke
    useEffect(() => {
        const timeout = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350)
        return () => clearTimeout(timeout)
    }, [searchQuery])

    // Reset to page 1 whenever a filter changes, so results and page never desync
    useEffect(() => {
        setPage(1)
    }, [debouncedSearch, statusFilter, selectedDate])

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    const queryKey = [
        "trips",
        {
            saccoId,
            status: statusFilter,
            date: selectedDate,
            search: debouncedSearch,
            page,
        },
    ]

    const { data: response, isLoading, isFetching, isError } = useQuery({
        queryKey,
        queryFn: () =>
            getTrips({
                status: statusFilter !== "all" ? statusFilter : undefined,
                page,
                limit,
                date: selectedDate,
                plateNumber: debouncedSearch || undefined,
            }),
        staleTime: 30 * 1000,
        placeholderData: (prev) => prev,
    })

    const trips = response?.data ?? []
    const total = response?.total ?? 0
    const totalPages = response?.totalPages ?? 1

    const cancelMutation = useMutation({
        mutationFn: (id: string) => cancelTrip(id),
        onSuccess: () => {
            toast.success("Trip cancelled successfully")
            queryClient.invalidateQueries({ queryKey: ["trips"] })
        },
        onError: () => {
            toast.error("Failed to cancel trip")
        },
    })

    const handleCancelTrip = (trip: Trip) => {
        if (trip.status === TripStatus.COMPLETED) {
            toast.error("Cannot cancel a completed trip")
            return
        }
        cancelMutation.mutate(trip.id)
    }

    const formatCurrency = (amount: number | string) => {
        const num = typeof amount === "string" ? parseFloat(amount) : amount
        return new Intl.NumberFormat("en-KE", {
            style: "currency",
            currency: "KES",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(num)
    }

    const formatDate = (dateString: string | null) => {
        if (!dateString) return "—"
        return new Date(dateString).toLocaleString()
    }

    if (isLoading) {
        return <TripListSkeleton isMobile={isMobile} />
    }

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 py-12 px-4 text-center">
                <p className="text-sm text-destructive">Failed to load trips</p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Retry
                </Button>
            </div>
        )
    }

    if (!trips || trips.length === 0) {
        return (
            <>
                <TripToolbar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    totalCount={total}
                    isMobile={isMobile}
                />
                <EmptyState
                    title="No trips found"
                    description={
                        searchQuery || statusFilter !== "all" || selectedDate !== todayIso()
                            ? "No trips match your filters"
                            : "No trips for this route yet"
                    }
                    onClear={() => {
                        setSearchQuery("")
                        setStatusFilter("all")
                        setSelectedDate(todayIso())
                    }}
                />
            </>
        )
    }

    return (
        <>
            <div className={cn("space-y-4", className)}>
                <TripToolbar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    totalCount={total}
                    isMobile={isMobile}
                />

                {isMobile ? (
                    <div className="grid gap-2">
                        {trips.map((trip) => (
                            <MobileTripCard
                                key={trip.id}
                                trip={trip}
                                onSelect={() => setSelectedTrip(trip)}
                                onCancel={() => handleCancelTrip(trip)}
                                isCancelling={cancelMutation.isPending}
                                formatCurrency={formatCurrency}
                                formatDate={formatDate}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border bg-card overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="w-[15%]">Vehicle</TableHead>
                                    <TableHead className="w-[20%]">Route</TableHead>
                                    <TableHead className="w-[12%] text-center">Fare</TableHead>
                                    <TableHead className="w-[10%] text-center">Passengers</TableHead>
                                    <TableHead className="w-[12%]">Status</TableHead>
                                    <TableHead className="w-[15%]">Driver</TableHead>
                                    <TableHead className="w-[16%]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {trips.map((trip) => (
                                    <DesktopTripRow
                                        key={trip.id}
                                        trip={trip}
                                        onSelect={() => setSelectedTrip(trip)}
                                        onCancel={() => handleCancelTrip(trip)}
                                        isCancelling={cancelMutation.isPending}
                                        formatCurrency={formatCurrency}
                                        formatDate={formatDate}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {totalPages > 1 && (
                    <TripPagination
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        disabled={isFetching}
                    />
                )}
            </div>

            <TripDetailsDialog
                trip={selectedTrip}
                open={!!selectedTrip}
                onOpenChange={() => setSelectedTrip(null)}
                onCancel={() => {
                    if (selectedTrip) {
                        handleCancelTrip(selectedTrip)
                        setSelectedTrip(null)
                    }
                }}
                isCancelling={cancelMutation.isPending}
                formatCurrency={formatCurrency}
                formatDate={formatDate}
            />
        </>
    )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

interface TripToolbarProps {
    searchQuery: string
    onSearchChange: (value: string) => void
    statusFilter: TripStatus | "all"
    onStatusFilterChange: (value: TripStatus | "all") => void
    selectedDate: string
    onDateChange: (value: string) => void
    totalCount: number
    isMobile: boolean
}

function TripToolbar({
    searchQuery,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    selectedDate,
    onDateChange,
    totalCount,
    isMobile,
}: TripToolbarProps) {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base font-medium">Trips</h2>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono">
                        {totalCount}
                    </Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 sm:flex-none">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                        <Input
                            type="search"
                            placeholder="Search trips..."
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="h-8 pl-7 pr-7 text-xs bg-muted/30 border-muted-foreground/10 focus-visible:ring-0 w-full sm:w-40"
                            aria-label="Search trips"
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

                    <div className="relative">
                        <Calendar className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
                        <Input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => onDateChange(e.target.value)}
                            max={todayIso()}
                            className="h-8 pl-7 text-xs w-32"
                            aria-label="Filter by date"
                        />
                    </div>

                    <Select
                        value={statusFilter}
                        onValueChange={(value) => onStatusFilterChange(value as TripStatus | "all")}
                    >
                        <SelectTrigger className="h-8 w-[120px] text-xs bg-muted/30 border-muted-foreground/10">
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            {Object.values(TripStatus).map((status) => (
                                <SelectItem key={status} value={status}>
                                    {STATUS_LABELS[status]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    )
}

// ─── Desktop Table Row ──────────────────────────────────────────────────────

interface DesktopTripRowProps {
    trip: Trip
    onSelect: () => void
    onCancel: () => void
    isCancelling: boolean
    formatCurrency: (amount: number) => string
    formatDate: (date: string | null) => string
}

function DesktopTripRow({
    trip,
    onSelect,
    onCancel,
    isCancelling,
    formatCurrency,
    formatDate,
}: DesktopTripRowProps) {
    const { numberPlate } = useVehicleNumberPlate(trip.vehicleId)
    const routeName = useRouteName(trip.routeId)
    const saccoName = useSaccoName(trip.saccoId)
    const StatusIcon = STATUS_ICONS[trip.status]

    return (
        <TableRow className="group cursor-pointer hover:bg-muted/50 transition-colors" onClick={onSelect}>
            <TableCell>
                <div className="min-w-0">
                    <p className="truncate font-medium">{numberPlate || "—"}</p>
                    <p className="text-xs text-muted-foreground/70 truncate">{saccoName || "—"}</p>
                </div>
            </TableCell>
            <TableCell>
                <p className="truncate text-sm">{routeName || "—"}</p>
            </TableCell>
            <TableCell className="text-center font-semibold">
                {formatCurrency(trip.fare)}
            </TableCell>
            <TableCell className="text-center font-semibold">
                {trip.passengerCount}
            </TableCell>
            <TableCell>
                <Badge
                    variant="outline"
                    className={cn(
                        "text-[10px] h-5 px-1.5 font-medium border",
                        STATUS_COLORS[trip.status]
                    )}
                >
                    <StatusIcon className="size-2.5 mr-1" />
                    {STATUS_LABELS[trip.status]}
                </Badge>
            </TableCell>
            <TableCell>
                <p className="text-sm">{trip.driverId ? "Assigned" : "—"}</p>
            </TableCell>
            <TableCell>
                <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1"
                >
                    <DropdownMenu>
                        <DropdownMenuTrigger >
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground/50 hover:text-foreground hover:bg-transparent"
                                aria-label="Actions"
                            >
                                <MoreVertical className="size-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={onSelect}>
                                <Eye className="size-3.5 mr-2" />
                                View details
                            </DropdownMenuItem>
                            {trip.status !== TripStatus.COMPLETED && trip.status !== TripStatus.CANCELLED && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={onCancel}
                                        disabled={isCancelling}
                                        className="text-destructive"
                                    >
                                        <XCircle className="size-3.5 mr-2" />
                                        Cancel Trip
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </TableCell>
        </TableRow>
    )
}

// ─── Mobile Trip Card ──────────────────────────────────────────────────────

interface MobileTripCardProps {
    trip: Trip
    onSelect: () => void
    onCancel: () => void
    isCancelling: boolean
    formatCurrency: (amount: number) => string
    formatDate: (date: string | null) => string
}

function MobileTripCard({
    trip,
    onSelect,
    onCancel,
    isCancelling,
    formatCurrency,
    formatDate,
}: MobileTripCardProps) {
    const { numberPlate } = useVehicleNumberPlate(trip.vehicleId)
    const routeName = useRouteName(trip.routeId)
    const StatusIcon = STATUS_ICONS[trip.status]

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
            <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-sm">{numberPlate || "—"}</p>
                        <Badge
                            variant="outline"
                            className={cn(
                                "text-[10px] h-5 px-1.5 font-medium border shrink-0",
                                STATUS_COLORS[trip.status]
                            )}
                        >
                            <StatusIcon className="size-2.5 mr-1" />
                            {STATUS_LABELS[trip.status]}
                        </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{routeName || "—"}</p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger >
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground/50 hover:text-foreground"
                            aria-label="Actions"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreVertical className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation()
                            onSelect()
                        }}>
                            <Eye className="size-3.5 mr-2" />
                            View details
                        </DropdownMenuItem>
                        {trip.status !== TripStatus.COMPLETED && trip.status !== TripStatus.CANCELLED && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onCancel()
                                    }}
                                    disabled={isCancelling}
                                    className="text-destructive"
                                >
                                    <XCircle className="size-3.5 mr-2" />
                                    Cancel Trip
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                <div className="bg-muted/30 rounded-md p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                        <DollarSign className="size-3 text-muted-foreground" />
                        <span className="text-sm font-semibold">{formatCurrency(trip.fare)}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Fare</p>
                </div>
                <div className="bg-muted/30 rounded-md p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                        <Users className="size-3 text-muted-foreground" />
                        <span className="text-sm font-semibold">{trip.passengerCount}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Passengers</p>
                </div>
                <div className="bg-muted/30 rounded-md p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                        <Clock className="size-3 text-muted-foreground" />
                        <span className="text-sm font-semibold">
                            {trip.departureTime ? "Departed" : "—"}
                        </span>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Status</p>
                </div>
            </div>

            {trip.driverId && (
                <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground/70">
                    <User className="size-3" />
                    <span>Driver assigned</span>
                </div>
            )}
        </div>
    )
}

// ─── Trip Details Dialog ────────────────────────────────────────────────────

interface TripDetailsDialogProps {
    trip: Trip | null
    open: boolean
    onOpenChange: () => void
    onCancel: () => void
    isCancelling: boolean
    formatCurrency: (amount: number) => string
    formatDate: (date: string | null) => string
}

function TripDetailsDialog({
    trip,
    open,
    onOpenChange,
    onCancel,
    isCancelling,
    formatCurrency,
    formatDate,
}: TripDetailsDialogProps) {
    if (!trip) return null

    const { numberPlate } = useVehicleNumberPlate(trip.vehicleId)
    const routeName = useRouteName(trip.routeId)
    const saccoName = useSaccoName(trip.saccoId)
    const StatusIcon = STATUS_ICONS[trip.status]

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md p-5 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-foreground">
                        <Truck className="size-4 text-muted-foreground" />
                        Trip Details
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-2">
                        <Badge
                            variant="outline"
                            className={cn(
                                "text-[10px] h-5 px-1.5 font-medium border",
                                STATUS_COLORS[trip.status]
                            )}
                        >
                            <StatusIcon className="size-2.5 mr-1" />
                            {STATUS_LABELS[trip.status]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            {formatDate(trip.createdAt)}
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-2">
                    {/* Vehicle & Route */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Vehicle</p>
                            <p className="text-sm font-semibold">{numberPlate || "—"}</p>
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Sacco</p>
                            <p className="text-sm">{saccoName || "—"}</p>
                        </div>
                    </div>

                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Route</p>
                        <p className="text-sm">{routeName || "—"}</p>
                    </div>

                    {/* Fare & Passengers */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <DollarSign className="size-4 mx-auto text-muted-foreground" />
                            <p className="text-lg font-bold mt-1">{formatCurrency(trip.fare)}</p>
                            <p className="text-[10px] text-muted-foreground">Fare per passenger</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-3 text-center">
                            <Users className="size-4 mx-auto text-muted-foreground" />
                            <p className="text-lg font-bold mt-1">{trip.passengerCount}</p>
                            <p className="text-[10px] text-muted-foreground">Passengers</p>
                        </div>
                    </div>

                    {/* Revenue */}
                    <div className="bg-primary/5 rounded-lg p-3 text-center border border-primary/10">
                        <p className="text-xs font-medium text-muted-foreground">Total Revenue</p>
                        <p className="text-xl font-bold text-primary">
                            {formatCurrency(trip.fare * trip.passengerCount)}
                        </p>
                    </div>

                    {/* Driver */}
                    {trip.driverId && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Driver</p>
                            <div className="flex items-center gap-2 mt-1">
                                <Avatar className="size-8">
                                    <AvatarFallback className="text-xs">D</AvatarFallback>
                                </Avatar>
                                <p className="text-sm">Driver assigned</p>
                            </div>
                        </div>
                    )}

                    {/* Timestamps */}
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t">
                        <div>
                            <p className="font-medium text-muted-foreground">Departure</p>
                            <p className="text-foreground">{formatDate(trip.departureTime)}</p>
                        </div>
                        <div>
                            <p className="font-medium text-muted-foreground">Completed</p>
                            <p className="text-foreground">{formatDate(trip.completedAt) || "—"}</p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 pt-2">
                    {trip.status !== TripStatus.COMPLETED && trip.status !== TripStatus.CANCELLED && (
                        <Button
                            variant="destructive"
                            size="sm"
                            className="flex-1"
                            onClick={onCancel}
                            disabled={isCancelling}
                        >
                            <XCircle className="size-3.5 mr-1.5" />
                            Cancel Trip
                        </Button>
                    )}
                    <Button size="sm" className="flex-1" onClick={onOpenChange}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ─── Pagination ─────────────────────────────────────────────────────────────

interface TripPaginationProps {
    page: number
    totalPages: number
    onPageChange: (page: number) => void
    disabled?: boolean
}

function TripPagination({ page, totalPages, onPageChange, disabled }: TripPaginationProps) {
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

// ─── Skeleton ───────────────────────────────────────────────────────────────

interface TripListSkeletonProps {
    isMobile?: boolean
}

function TripListSkeleton({ isMobile }: TripListSkeletonProps) {
    if (isMobile) {
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-7 w-32" />
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-start justify-between">
                            <div className="space-y-1.5 flex-1">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/2" />
                            </div>
                            <Skeleton className="h-5 w-16" />
                            <Skeleton className="h-7 w-7 rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                            {Array.from({ length: 3 }).map((_, j) => (
                                <div key={j} className="bg-muted/30 rounded-md p-1.5 space-y-0.5">
                                    <Skeleton className="h-4 w-10 mx-auto" />
                                    <Skeleton className="h-2 w-8 mx-auto" />
                                </div>
                            ))}
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
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="h-5 w-16 mx-auto" />
                            <Skeleton className="h-5 w-12 mx-auto" />
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-5 w-16" />
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
    onClear?: () => void
}

function EmptyState({ title, description, onClear }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-10 px-4 text-center">
            <div className="rounded-full bg-muted/30 p-2.5">
                <Truck className="size-5 text-muted-foreground/40" />
            </div>
            <div className="space-y-0.5">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {onClear && (
                <Button size="sm" variant="outline" onClick={onClear} className="gap-1.5 text-xs">
                    <RefreshCw className="size-3.5" />
                    Clear filters
                </Button>
            )}
        </div>
    )
}