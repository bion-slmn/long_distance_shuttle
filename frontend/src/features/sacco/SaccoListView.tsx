// src/features/sacco/SaccoListView.tsx
import { useState, useMemo, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    MoreVertical,
    MapPin,
    Plus,
    Search,
    Building2,
    Mail,
    Phone,
    CheckCircle,
    Circle,
    XCircle,
    ChevronRight,
    ChevronLeft,
    X,
    RouteIcon,
    Users2,
    Bus,
    Eye,
    Pencil,
    Power,
    PowerOff,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { deactivateSaccoRequest, getSaccosRequest, reactivateSaccoRequest } from "@/api/saccoApi"
import type { Sacco } from "@/api/saccoApi"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import SaccoForm from "./CreateSaccoForm"

interface SaccoListViewProps {
    includeInactive?: boolean
    className?: string
}

const PAGE_SIZE = 20

export default function SaccoListView({
    includeInactive = true,
    className,
}: SaccoListViewProps) {
    const [showForm, setShowForm] = useState(false)
    const [formMode, setFormMode] = useState<"create" | "edit">("create")
    const [editingSacco, setEditingSacco] = useState<Sacco | null>(null)
    const [selectedSacco, setSelectedSacco] = useState<Sacco | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [page, setPage] = useState(1)
    const [isMobile, setIsMobile] = useState(false)
    const queryClient = useQueryClient()
    const queryKey = ["saccos", { includeInactive, page }]

    // Check if mobile
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    // Reset to page 1 whenever the search term or filter changes
    useEffect(() => {
        setPage(1)
    }, [searchQuery, includeInactive])

    const { data: response, isLoading, error, isPlaceholderData } = useQuery({
        queryKey,
        queryFn: () => getSaccosRequest({ includeInactive, page, limit: PAGE_SIZE, withCounts: true }),
        staleTime: 5 * 60 * 1000,
        placeholderData: (prev) => prev,
    })

    const saccos = response?.data ?? []
    const total = response?.total ?? 0
    const totalPages = response?.totalPages ?? 1

    const toggleActiveMutation = useMutation({
        mutationFn: (sacco: Sacco) =>
            sacco.isActive
                ? deactivateSaccoRequest(sacco.id)
                : reactivateSaccoRequest(sacco.id),

        onMutate: async (sacco) => {
            await queryClient.cancelQueries({ queryKey })
            const previous = queryClient.getQueryData<typeof response>(queryKey)

            queryClient.setQueryData<typeof response>(queryKey, (old) =>
                old
                    ? {
                        ...old,
                        data: old.data.map((s) =>
                            s.id === sacco.id ? { ...s, isActive: !s.isActive } : s,
                        ),
                    }
                    : old,
            )

            return { previous }
        },

        onError: (_err, sacco, context) => {
            queryClient.setQueryData(queryKey, context?.previous)
            toast.error(
                `Couldn't ${sacco.isActive ? "deactivate" : "activate"} ${sacco.name}. Try again.`,
            )
        },

        onSuccess: (_data, sacco) => {
            toast.success(
                `${sacco.name} ${sacco.isActive ? "deactivated" : "activated"}`,
            )
        },

        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["saccos"] })
        },
    })

    const filteredSaccos = useMemo(() => {
        if (!searchQuery.trim()) return saccos

        const query = searchQuery.toLowerCase().trim()
        return saccos.filter((sacco) =>
            sacco.name.toLowerCase().includes(query) ||
            sacco.headquarters?.toLowerCase().includes(query) ||
            sacco.registrationNumber?.toLowerCase().includes(query) ||
            sacco.contacts?.some(c => c.phone.includes(query)) ||
            sacco.emails?.some(e => e.email.toLowerCase().includes(query))
        )
    }, [saccos, searchQuery])

    const handleAddSacco = () => {
        setFormMode("create")
        setEditingSacco(null)
        setShowForm(true)
    }

    const handleEditSacco = (sacco: Sacco) => {
        setFormMode("edit")
        setEditingSacco(sacco)
        setShowForm(true)
    }

    const handleFormSuccess = () => {
        setShowForm(false)
        queryClient.invalidateQueries({ queryKey: ["saccos"] })
    }

    const handleFormCancel = () => {
        setShowForm(false)
    }

    const handleDialogClose = () => setSelectedSacco(null)

    if (isLoading) {
        return <SaccoListSkeleton isMobile={isMobile} />
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 py-12 px-4 text-center">
                <p className="text-sm text-destructive">Failed to load saccos</p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Retry
                </Button>
            </div>
        )
    }

    if (!saccos || saccos.length === 0) {
        return (
            <>
                <EmptyState
                    title="No saccos found"
                    description="Get started by adding your first sacco."
                    actionLabel="Add sacco"
                    onAction={handleAddSacco}
                />
                <SaccoFormModal
                    open={showForm}
                    onOpenChange={setShowForm}
                    mode={formMode}
                    sacco={editingSacco}
                    onSuccess={handleFormSuccess}
                    onCancel={handleFormCancel}
                    isMobile={isMobile}
                />
            </>
        )
    }

    if (filteredSaccos.length === 0) {
        return (
            <>
                <div className="space-y-3">
                    <SaccoToolbar
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        onAddSacco={handleAddSacco}
                        total={total}
                        isMobile={isMobile}
                    />
                    <EmptyState
                        title="No matching saccos"
                        description={`No saccos found matching "${searchQuery}" on this page`}
                        actionLabel="Clear search"
                        onAction={() => setSearchQuery("")}
                    />
                </div>
                <SaccoFormModal
                    open={showForm}
                    onOpenChange={setShowForm}
                    mode={formMode}
                    sacco={editingSacco}
                    onSuccess={handleFormSuccess}
                    onCancel={handleFormCancel}
                    isMobile={isMobile}
                />
            </>
        )
    }

    return (
        <>
            <div className={cn("space-y-4", className)}>
                <SaccoToolbar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onAddSacco={handleAddSacco}
                    total={total}
                    isMobile={isMobile}
                />

                {isMobile ? (
                    // Mobile: Compact Card View
                    <div className="grid gap-2">
                        {filteredSaccos.map((sacco) => (
                            <MobileSaccoCard
                                key={sacco.id}
                                sacco={sacco}
                                onSelect={() => setSelectedSacco(sacco)}
                                onEdit={() => handleEditSacco(sacco)}
                                onToggleActive={() => toggleActiveMutation.mutate(sacco)}
                                isToggling={
                                    toggleActiveMutation.isPending &&
                                    toggleActiveMutation.variables?.id === sacco.id
                                }
                            />
                        ))}
                    </div>
                ) : (
                    // Desktop: Table View
                    <div className="rounded-lg border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="w-[30%]">Sacco Name</TableHead>
                                    <TableHead className="w-[15%]">Status</TableHead>
                                    <TableHead className="w-[15%] text-center">Vehicles</TableHead>
                                    <TableHead className="w-[15%] text-center">Users</TableHead>
                                    <TableHead className="w-[15%] text-center">Routes</TableHead>
                                    <TableHead className="w-[10%] text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSaccos.map((sacco) => (
                                    <DesktopSaccoRow
                                        key={sacco.id}
                                        sacco={sacco}
                                        onSelect={() => setSelectedSacco(sacco)}
                                        onEdit={() => handleEditSacco(sacco)}
                                        onToggleActive={() => toggleActiveMutation.mutate(sacco)}
                                        isToggling={
                                            toggleActiveMutation.isPending &&
                                            toggleActiveMutation.variables?.id === sacco.id
                                        }
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                <SaccoPagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    disabled={isPlaceholderData}
                />

                <SaccoDetailsDialog
                    sacco={selectedSacco}
                    open={!!selectedSacco}
                    onOpenChange={handleDialogClose}
                    onEdit={handleEditSacco}
                    onToggleActive={(sacco) => toggleActiveMutation.mutate(sacco)}
                />
            </div>

            <SaccoFormModal
                open={showForm}
                onOpenChange={setShowForm}
                mode={formMode}
                sacco={editingSacco}
                onSuccess={handleFormSuccess}
                onCancel={handleFormCancel}
                isMobile={isMobile}
            />
        </>
    )
}

// ─── Toolbar Component ──────────────────────────────────────────────────────

interface SaccoToolbarProps {
    searchQuery: string
    onSearchChange: (value: string) => void
    onAddSacco: () => void
    total: number
    isMobile: boolean
}

function SaccoToolbar({
    searchQuery,
    onSearchChange,
    onAddSacco,
    total,
    isMobile,
}: SaccoToolbarProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
                <h2 className="text-base font-medium">Saccos</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono">
                    {total}
                </Badge>
            </div>
            <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:flex-none">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                        type="search"
                        placeholder="Search saccos..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="h-8 pl-7 pr-7 text-xs bg-muted/30 border-muted-foreground/10 focus-visible:ring-0 w-full sm:w-44"
                        aria-label="Search saccos"
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
                <Button size="sm" onClick={onAddSacco} className="gap-1.5">
                    <Plus className="size-3.5" />
                    <span className="hidden sm:inline text-xs">Add</span>
                </Button>
            </div>
        </div>
    )
}

// ─── Desktop Table Row ──────────────────────────────────────────────────────

interface DesktopSaccoRowProps {
    sacco: Sacco
    onSelect: () => void
    onEdit: () => void
    onToggleActive: () => void
    isToggling?: boolean
}

function DesktopSaccoRow({
    sacco,
    onSelect,
    onEdit,
    onToggleActive,
    isToggling,
}: DesktopSaccoRowProps) {
    return (
        <TableRow
            className="group cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={onSelect}
        >
            <TableCell>
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "size-2 rounded-full shrink-0",
                        sacco.isActive ? "bg-emerald-500" : "bg-muted-foreground/30"
                    )} />
                    <div className="min-w-0">
                        <p className="truncate font-medium">{sacco.name}</p>
                        {sacco.headquarters && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground/70">
                                <MapPin className="size-3" />
                                {sacco.headquarters}
                            </p>
                        )}
                    </div>
                </div>
            </TableCell>
            <TableCell>
                <Badge
                    variant={sacco.isActive ? "default" : "secondary"}
                    className="text-[10px] h-5 px-1.5 font-medium"
                >
                    {sacco.isActive ? "Active" : "Inactive"}
                </Badge>
            </TableCell>
            <TableCell className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                    <Bus className="size-3.5 text-muted-foreground" />
                    <span className="font-semibold">{sacco.vehicleCount ?? 0}</span>
                </div>
            </TableCell>
            <TableCell className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                    <Users2 className="size-3.5 text-muted-foreground" />
                    <span className="font-semibold">{sacco.userCount ?? 0}</span>
                </div>
            </TableCell>
            <TableCell className="text-center">
                <div className="flex items-center justify-center gap-1.5">
                    <RouteIcon className="size-3.5 text-muted-foreground" />
                    <span className="font-semibold">{sacco.routeCount ?? 0}</span>
                </div>
            </TableCell>
            <TableCell className="text-right">
                <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex items-center justify-end gap-1"
                >
                    <Switch
                        checked={sacco.isActive}
                        disabled={isToggling}
                        onCheckedChange={onToggleActive}
                        className="scale-75 data-[state=checked]:bg-emerald-500"
                        aria-label={sacco.isActive ? "Deactivate" : "Activate"}
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground/50 hover:text-foreground hover:bg-transparent"
                                aria-label={`Actions for ${sacco.name}`}
                            >
                                <MoreVertical className="size-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
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
                                onClick={onToggleActive}
                                className={sacco.isActive ? "text-destructive" : "text-emerald-600"}
                            >
                                {sacco.isActive ? (
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
                </div>
            </TableCell>
        </TableRow>
    )
}

// ─── Mobile Compact Card ────────────────────────────────────────────────────

interface MobileSaccoCardProps {
    sacco: Sacco
    onSelect: () => void
    onEdit: () => void
    onToggleActive: () => void
    isToggling?: boolean
}

function MobileSaccoCard({
    sacco,
    onSelect,
    onEdit,
    onToggleActive,
    isToggling,
}: MobileSaccoCardProps) {
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
            {/* Header: Name + Status + Actions */}
            <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <div className={cn(
                            "size-2 rounded-full shrink-0",
                            sacco.isActive ? "bg-emerald-500" : "bg-muted-foreground/30"
                        )} />
                        <p className="truncate font-medium text-sm">
                            {sacco.name}
                        </p>
                    </div>
                    {sacco.headquarters && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-0.5">
                            <MapPin className="size-3" />
                            <span className="truncate">{sacco.headquarters}</span>
                        </p>
                    )}
                </div>

                <Badge
                    variant={sacco.isActive ? "default" : "secondary"}
                    className="text-[10px] h-5 px-1.5 font-medium shrink-0"
                >
                    {sacco.isActive ? "Active" : "Inactive"}
                </Badge>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground/50 hover:text-foreground"
                            aria-label={`Actions for ${sacco.name}`}
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
                        <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation()
                            onEdit()
                        }}>
                            <Pencil className="size-3.5 mr-2" />
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={(e) => {
                                e.stopPropagation()
                                onToggleActive()
                            }}
                            className={sacco.isActive ? "text-destructive" : "text-emerald-600"}
                        >
                            {sacco.isActive ? (
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
            </div>

            {/* Stats Grid - Compact */}
            <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                <div className="bg-muted/30 rounded-md p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                        <Bus className="size-3 text-muted-foreground" />
                        <span className="text-sm font-semibold">{sacco.vehicleCount ?? 0}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Vehicles</p>
                </div>
                <div className="bg-muted/30 rounded-md p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                        <Users2 className="size-3 text-muted-foreground" />
                        <span className="text-sm font-semibold">{sacco.userCount ?? 0}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Members</p>
                </div>
                <div className="bg-muted/30 rounded-md p-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                        <RouteIcon className="size-3 text-muted-foreground" />
                        <span className="text-sm font-semibold">{sacco.routeCount ?? 0}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Routes</p>
                </div>
            </div>

            {/* Status Toggle - Compact */}
            <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t">
                <span className="text-[10px] text-muted-foreground">Status</span>
                <Switch
                    checked={sacco.isActive}
                    disabled={isToggling}
                    onCheckedChange={onToggleActive}
                    className="scale-75 data-[state=checked]:bg-emerald-500"
                    aria-label={sacco.isActive ? "Deactivate" : "Activate"}
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
        </div>
    )
}

// ─── Pagination ─────────────────────────────────────────────────────────────

interface SaccoPaginationProps {
    page: number
    totalPages: number
    onPageChange: (page: number) => void
    disabled?: boolean
}

function SaccoPagination({ page, totalPages, onPageChange, disabled }: SaccoPaginationProps) {
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

// ─── Form Modal ─────────────────────────────────────────────────────────────

interface SaccoFormModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    sacco: Sacco | null
    onSuccess: () => void
    onCancel: () => void
    isMobile: boolean
}

function SaccoFormModal({
    open,
    onOpenChange,
    mode,
    sacco,
    onSuccess,
    onCancel,
    isMobile,
}: SaccoFormModalProps) {
    const title = mode === "create" ? "Add Sacco" : `Edit ${sacco?.name}`
    const description = mode === "create"
        ? "Register a new sacco on the platform"
        : "Update sacco details and contact information"

    if (isMobile) {
        return (
            <Drawer open={open} onOpenChange={onOpenChange}>
                <DrawerContent className="h-[92vh] max-h-[92vh]">
                    <div className="flex flex-col h-full">
                        <div className="flex justify-center pt-2 pb-1">
                            <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                        </div>
                        <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-start justify-between shrink-0">
                            <DrawerHeader className="p-0">
                                <DrawerTitle className="text-base">{title}</DrawerTitle>
                                <DrawerDescription className="text-xs">{description}</DrawerDescription>
                            </DrawerHeader>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 -mt-1"
                                onClick={() => onOpenChange(false)}
                            >
                                <X className="size-4" />
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-4 py-4">
                            <SaccoForm
                                mode={mode}
                                sacco={sacco}
                                onSuccess={onSuccess}
                                onCancel={onCancel}
                            />
                        </div>
                    </div>
                </DrawerContent>
            </Drawer>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl p-0 max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
                    <DialogHeader>
                        <DialogTitle className="text-lg">{title}</DialogTitle>
                        <DialogDescription className="text-sm">{description}</DialogDescription>
                    </DialogHeader>
                </div>
                <div className="px-6 py-6">
                    <SaccoForm
                        mode={mode}
                        sacco={sacco}
                        onSuccess={onSuccess}
                        onCancel={onCancel}
                    />
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ─── Details Dialog ─────────────────────────────────────────────────────────

interface SaccoDetailsDialogProps {
    sacco: Sacco | null
    open: boolean
    onOpenChange: () => void
    onEdit?: (sacco: Sacco) => void
    onToggleActive?: (sacco: Sacco) => void
}

function SaccoDetailsDialog({
    sacco,
    open,
    onOpenChange,
    onEdit,
    onToggleActive
}: SaccoDetailsDialogProps) {
    if (!sacco) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md p-4 sm:p-5 max-h-[90vh] overflow-y-auto">
                <DialogHeader className="space-y-1.5">
                    <DialogTitle className="text-sm sm:text-base flex items-center gap-2 min-w-0">
                        <Building2 className="size-4 text-muted-foreground shrink-0" />
                        <span className="truncate text-foreground min-w-0">{sacco.name}</span>
                    </DialogTitle>
                    <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
                        {sacco.registrationNumber
                            ? `Reg. ${sacco.registrationNumber}`
                            : "No registration number"}
                        <span className="flex items-center gap-1.5 text-[10px]">
                            <span className={cn(
                                "size-1.5 rounded-full shrink-0",
                                sacco.isActive ? "bg-emerald-500" : "bg-muted-foreground/30"
                            )} />
                            <span className="text-muted-foreground">
                                {sacco.isActive ? "Active" : "Inactive"}
                            </span>
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-2">
                    {sacco.headquarters && (
                        <div className="flex items-start gap-2 text-sm">
                            <MapPin className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <span className="break-words">{sacco.headquarters}</span>
                        </div>
                    )}

                    {sacco.contacts?.length > 0 && (
                        <div className="flex items-start gap-2 text-sm">
                            <Phone className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5 min-w-0">
                                {sacco.contacts.map((contact, index) => (
                                    <span key={index} className="break-words">
                                        {contact.phone}
                                        {contact.label && (
                                            <span className="text-muted-foreground text-xs ml-1">
                                                ({contact.label})
                                            </span>
                                        )}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {sacco.emails?.length > 0 && (
                        <div className="flex items-start gap-2 text-sm">
                            <Mail className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5 min-w-0">
                                {sacco.emails.map((email, index) => (
                                    <a key={index}
                                        href={`mailto:${email.email}`}
                                        className="text-primary hover:underline break-words"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {email.email}
                                        {email.label && (
                                            <span className="text-muted-foreground text-xs ml-1">
                                                ({email.label})
                                            </span>
                                        )}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 pt-1">
                        <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <Bus className="size-4 mx-auto text-muted-foreground" />
                            <p className="text-sm font-bold mt-0.5">{sacco.vehicleCount ?? 0}</p>
                            <p className="text-[10px] text-muted-foreground">Vehicles</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <Users2 className="size-4 mx-auto text-muted-foreground" />
                            <p className="text-sm font-bold mt-0.5">{sacco.userCount ?? 0}</p>
                            <p className="text-[10px] text-muted-foreground">Members</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-2 text-center">
                            <RouteIcon className="size-4 mx-auto text-muted-foreground" />
                            <p className="text-sm font-bold mt-0.5">{sacco.routeCount ?? 0}</p>
                            <p className="text-[10px] text-muted-foreground">Routes</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:flex-1 text-xs"
                        onClick={() => {
                            onOpenChange()
                            onEdit?.(sacco)
                        }}
                    >
                        Edit
                    </Button>
                    <Button
                        size="sm"
                        variant={sacco.isActive ? "destructive" : "default"}
                        className="w-full sm:flex-1 gap-1.5 text-xs"
                        onClick={() => {
                            onToggleActive?.(sacco)
                            onOpenChange()
                        }}
                    >
                        {sacco.isActive ? (
                            <>
                                <XCircle className="size-3.5" />
                                Deactivate
                            </>
                        ) : (
                            <>
                                <CheckCircle className="size-3.5" />
                                Activate
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

interface SaccoListSkeletonProps {
    isMobile?: boolean
}

function SaccoListSkeleton({ isMobile }: SaccoListSkeletonProps) {
    if (isMobile) {
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-7 w-32" />
                </div>
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2.5">
                        <div className="flex items-start justify-between">
                            <div className="space-y-1.5 flex-1">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/2" />
                            </div>
                            <Skeleton className="h-5 w-14" />
                            <Skeleton className="h-7 w-7 rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                            {Array.from({ length: 3 }).map((_, j) => (
                                <div key={j} className="bg-muted/30 rounded-md p-1.5 space-y-0.5">
                                    <Skeleton className="h-4 w-8 mx-auto" />
                                    <Skeleton className="h-2 w-10 mx-auto" />
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-2 border-t">
                            <Skeleton className="h-5 w-12" />
                            <Skeleton className="h-5 w-8 rounded" />
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
                            <Skeleton className="h-5 w-16" />
                            <Skeleton className="h-5 w-12 mx-auto" />
                            <Skeleton className="h-5 w-12 mx-auto" />
                            <Skeleton className="h-5 w-12 mx-auto" />
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
                <Building2 className="size-5 text-muted-foreground/40" />
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