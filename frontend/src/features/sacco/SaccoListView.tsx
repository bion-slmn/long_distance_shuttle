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
    X
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer"

import { deactivateSaccoRequest, getSaccosRequest, reactivateSaccoRequest } from "@/api/saccoApi"
import type { Sacco } from "@/api/saccoApi"
import { Switch } from "@/components/ui/switch"
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
            setIsMobile(window.innerWidth < 640)
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
        queryFn: () => getSaccosRequest({ includeInactive, page, limit: PAGE_SIZE }),
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

    // NOTE: this only filters the saccos on the CURRENT page, since data is
    // now paginated server-side. For real search-across-all-pages, this
    // needs to become a server-side `search` query param instead.
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

    // Handlers
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
        return <SaccoListSkeleton />
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
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-medium">Saccos</h2>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                {total}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <SaccoSearchBar
                                value={searchQuery}
                                onChange={setSearchQuery}
                                className="w-full sm:w-56"
                            />
                            <Button size="sm" onClick={handleAddSacco} className="gap-1.5">
                                <Plus className="size-3.5" />
                                <span className="hidden sm:inline text-xs">Add</span>
                            </Button>
                        </div>
                    </div>
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-medium">Saccos</h2>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {total}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <SaccoSearchBar
                            value={searchQuery}
                            onChange={setSearchQuery}
                            className="w-full sm:w-56"
                        />
                        <Button size="sm" onClick={handleAddSacco} className="gap-1.5">
                            <Plus className="size-3.5" />
                            <span className="hidden sm:inline text-xs">Add</span>
                        </Button>
                    </div>
                </div>

                <div
                    className={cn(
                        "grid gap-2 transition-opacity",
                        isPlaceholderData && "opacity-60 pointer-events-none",
                    )}
                >
                    {filteredSaccos.map((sacco) => (
                        <SaccoCard
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

// Pagination controls
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

// Edit/Create form — Dialog (modal) on desktop, Drawer (bottom sheet) on mobile
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

    // Mobile: Drawer from bottom (unchanged)
    if (isMobile) {
        return (
            <Drawer open={open} onOpenChange={onOpenChange}>
                <DrawerContent className="h-[92vh] max-h-[92vh]">
                    <div className="flex flex-col h-full">
                        <div className="flex justify-center pt-2 pb-1">
                            <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                        </div>

                        <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-start justify-between shrink-0">

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

    // Desktop: centered modal (Dialog) instead of side Sheet
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl p-0 max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between">
                    <DialogHeader className="space-y-0.5">
                        <DialogDescription className="text-xs sm:text-sm">
                            {description}
                        </DialogDescription>
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

// Mobile-friendly Details Dialog
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
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md p-4 sm:p-5 max-h-[90vh] overflow-y-auto">                <DialogHeader className="space-y-1.5">
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
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:flex-1 text-xs"
                        onClick={() => {
                            onOpenChange(false)
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
                            onOpenChange(false)
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

// Minimal Sacco Card
function SaccoCard({
    sacco,
    onSelect,
    onEdit,
    onToggleActive,
    isToggling,
}: SaccoCardProps) {
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
            <div className={cn(
                "size-2 rounded-full transition-colors shrink-0",
                sacco.isActive ? "bg-emerald-500" : "bg-muted-foreground/30"
            )} />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                    <p className="truncate text-sm font-medium min-w-0">
                        {sacco.name}
                    </p>
                    {sacco.registrationNumber && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                            {sacco.registrationNumber}
                        </span>
                    )}
                </div>
                {sacco.headquarters && (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground/70">
                        <MapPin className="size-3 shrink-0" />
                        {sacco.headquarters}
                    </p>
                )}
            </div>

            <div
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <Switch
                    checked={sacco.isActive}
                    disabled={isToggling}
                    onCheckedChange={onToggleActive}
                    className="scale-75 data-[state=checked]:bg-emerald-500"
                    aria-label={
                        sacco.isActive
                            ? `Deactivate ${sacco.name}`
                            : `Activate ${sacco.name}`
                    }
                />

                <DropdownMenu>
                    <DropdownMenuTrigger
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground"
                        aria-label={`Actions for ${sacco.name}`}
                    >
                        <MoreVertical className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={onSelect} className="text-xs">
                            View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onEdit} className="text-xs">
                            Edit
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <ChevronRight className="size-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            </div>
        </div>
    )
}

// Minimal Search Bar
function SaccoSearchBar({ value, onChange, className }: SaccoSearchBarProps) {
    return (
        <div className={cn("relative", className)}>
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
                type="search"
                placeholder="Search..."
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 pl-7 pr-7 text-xs bg-muted/30 border-muted-foreground/10 focus-visible:ring-0"
                aria-label="Search saccos"
            />
            {value && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-2 text-muted-foreground/50 hover:text-foreground"
                    onClick={() => onChange("")}
                    aria-label="Clear search"
                >
                    ✕
                </Button>
            )}
        </div>
    )
}

// Minimal Skeleton
function SaccoListSkeleton() {
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

// Minimal Empty State
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

// Types
interface SaccoCardProps {
    sacco: Sacco
    onSelect: () => void
    onEdit: () => void
    onToggleActive: () => void
    isToggling?: boolean
}

interface SaccoDetailsDialogProps {
    sacco: Sacco | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onEdit?: (sacco: Sacco) => void
    onToggleActive?: (sacco: Sacco) => void
}

interface SaccoSearchBarProps {
    value: string
    onChange: (value: string) => void
    className?: string
}

interface EmptyStateProps {
    title: string
    description: string
    actionLabel?: string
    onAction?: () => void
}