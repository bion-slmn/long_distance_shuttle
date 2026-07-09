// src/features/auth/SaccoUsersTable.tsx
import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
    ChevronLeft,
    ChevronRight,
    Search,
    Users,
    Shield,
    MoreVertical,
    Pencil,
    Trash2,
    UserPlus,
    ChevronRight as ChevronRightIcon,
    Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner" // swap for your toast lib if different
import {
    getUsersRequest,
    updateUserRequest,
    deleteUserRequest,
    type UpdateUserPayload,
} from "@/api/authApi"
import { useSaccoName } from "./useSaccoName"

interface SaccoUsersTableProps {
    saccoId?: string
}

interface User {
    id: string
    fullName: string
    email: string
    phoneNumber: string
    role: string
    saccoId: string | null
    createdAt: string
    updatedAt: string
}

function getInitials(name: string) {
    const parts = name.trim().split(" ")
    return parts.length > 1
        ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
        : parts[0].slice(0, 2).toUpperCase()
}

function UserSaccoCell({ saccoId }: { saccoId: string | null }) {
    const name = useSaccoName(saccoId ?? undefined)
    if (!saccoId) return <span className="text-muted-foreground">—</span>
    return <span>{name ?? "Loading..."}</span>
}

const ROLE_COLORS: Record<string, string> = {
    SUPER_ADMIN: "bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 border-purple-500/20",
    SACCO_ADMIN: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20",
    CLERK: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20",
    DRIVER: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border-amber-500/20",
}

const ROLE_LABELS: Record<string, string> = {
    SUPER_ADMIN: "Super Admin",
    SACCO_ADMIN: "Sacco Admin",
    CLERK: "Clerk",
    DRIVER: "Driver",
}

const EDITABLE_ROLES = ["SACCO_ADMIN", "CLERK", "DRIVER"] // super admin excluded from self-service edit UI

export function SaccoUsersTable({ saccoId }: SaccoUsersTableProps) {
    const [page, setPage] = useState(1)
    const [search, setSearch] = useState("")
    const [selectedUser, setSelectedUser] = useState<User | null>(null)
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [deletingUser, setDeletingUser] = useState<User | null>(null)
    const [isMobile, setIsMobile] = useState(false)
    const limit = 10

    const queryClient = useQueryClient()
    const saccoName = useSaccoName(saccoId)

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

    const { data, isLoading, isFetching, isError } = useQuery({
        queryKey: ["users", "table", saccoId, page, limit, search],
        queryFn: () => getUsersRequest({ saccoId, page, limit, search }),
        placeholderData: keepPreviousData,
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteUserRequest(id),
        onSuccess: () => {
            toast.success("User removed")
            queryClient.invalidateQueries({ queryKey: ["users", "table"] })
            setDeletingUser(null)
            setSelectedUser(null)
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to remove user")
        },
    })

    const users = data?.data ?? []
    const meta = data?.meta

    if (isLoading) {
        return <UsersTableSkeleton isMobile={isMobile} />
    }

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 py-12 px-4 text-center">
                <p className="text-sm text-destructive">Failed to load users</p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Retry
                </Button>
            </div>
        )
    }

    if (!users || users.length === 0) {
        return (
            <EmptyState
                title="No users found"
                description={saccoId ? `No users in ${saccoName ?? "this sacco"}` : "No users found"}
            />
        )
    }

    return (
        <>
            <div className="space-y-3">
                <UsersToolbar
                    searchQuery={search}
                    onSearchChange={(value) => {
                        setSearch(value)
                        setPage(1)
                    }}
                    totalCount={meta?.total ?? 0}
                    title={saccoId ? `${saccoName ?? "Sacco"} — Users` : "All Users"}
                />

                {isMobile ? (
                    <div className="grid gap-2">
                        {users.map((user) => (
                            <MobileUserCard
                                key={user.id}
                                user={user}
                                onSelect={() => setSelectedUser(user)}
                                onEdit={() => setEditingUser(user)}
                                onDelete={() => setDeletingUser(user)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border bg-card overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead>User</TableHead>
                                    <TableHead className="w-[130px]">Role</TableHead>
                                    {!saccoId && <TableHead className="w-[140px]">Sacco</TableHead>}
                                    <TableHead className="w-[56px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.map((user) => (
                                    <DesktopUserRow
                                        key={user.id}
                                        user={user}
                                        onSelect={() => setSelectedUser(user)}
                                        onEdit={() => setEditingUser(user)}
                                        onDelete={() => setDeletingUser(user)}
                                        showSacco={!saccoId}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {meta && meta.totalPages > 1 && (
                    <UsersPagination
                        page={page}
                        totalPages={meta.totalPages}
                        onPageChange={setPage}
                        disabled={isFetching}
                    />
                )}
            </div>

            <UserDetailsDialog
                user={selectedUser}
                open={!!selectedUser}
                onOpenChange={() => setSelectedUser(null)}
                showSacco={!saccoId}
                onEdit={() => {
                    if (selectedUser) setEditingUser(selectedUser)
                    setSelectedUser(null)
                }}
                onDelete={() => {
                    if (selectedUser) setDeletingUser(selectedUser)
                }}
            />

            <EditUserDialog
                user={editingUser}
                open={!!editingUser}
                onOpenChange={() => setEditingUser(null)}
                onSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ["users", "table"] })
                    setEditingUser(null)
                }}
            />

            <Dialog open={!!deletingUser} onOpenChange={() => setDeletingUser(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Remove user?</DialogTitle>
                        <DialogDescription>
                            {deletingUser?.fullName} will lose access immediately. This can&apos;t
                            be easily undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDeletingUser(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteMutation.isPending}
                            onClick={() => deletingUser && deleteMutation.mutate(deletingUser.id)}
                        >
                            {deleteMutation.isPending && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                            Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

interface UsersToolbarProps {
    searchQuery: string
    onSearchChange: (value: string) => void
    totalCount: number
    title: string
}

function UsersToolbar({ searchQuery, onSearchChange, totalCount, title }: UsersToolbarProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
                <h2 className="text-base font-medium">{title}</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono">
                    {totalCount}
                </Badge>
            </div>
            <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                    type="search"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="h-8 pl-7 pr-7 text-xs bg-muted/30 border-muted-foreground/10 focus-visible:ring-0 w-full sm:w-52"
                    aria-label="Search users"
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
        </div>
    )
}

// ─── Row actions (shared dropdown) ─────────────────────────────────────────

function RowActionsMenu({
    onView,
    onEdit,
    onDelete,
}: {
    onView: () => void
    onEdit: () => void
    onDelete: () => void
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MoreVertical className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={onView}>View details</DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-3.5 mr-2" />
                    Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                    <Trash2 className="size-3.5 mr-2" />
                    Remove
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

// ─── Desktop Table Row (decluttered: one identity cell, role, sacco, actions) ─

interface DesktopUserRowProps {
    user: User
    onSelect: () => void
    onEdit: () => void
    onDelete: () => void
    showSacco: boolean
}

function DesktopUserRow({ user, onSelect, onEdit, onDelete, showSacco }: DesktopUserRowProps) {
    return (
        <TableRow
            className="group cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={onSelect}
        >
            <TableCell>
                <div className="flex items-center gap-3">
                    <Avatar className="size-8 shrink-0">
                        <AvatarFallback className="text-xs">
                            {getInitials(user.fullName)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <p className="truncate font-medium text-sm leading-tight">{user.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground leading-tight">
                            {user.email || user.phoneNumber || "—"}
                        </p>
                    </div>
                </div>
            </TableCell>
            <TableCell>
                <Badge
                    variant="outline"
                    className={cn(
                        "text-[10px] h-5 px-1.5 font-medium border",
                        ROLE_COLORS[user.role] || "bg-muted/50"
                    )}
                >
                    {ROLE_LABELS[user.role] || user.role}
                </Badge>
            </TableCell>
            {showSacco && (
                <TableCell className="text-sm text-muted-foreground">
                    <UserSaccoCell saccoId={user.saccoId ?? null} />
                </TableCell>
            )}
            <TableCell onClick={(e) => e.stopPropagation()}>
                <RowActionsMenu onView={onSelect} onEdit={onEdit} onDelete={onDelete} />
            </TableCell>
        </TableRow>
    )
}

// ─── Mobile User Card ──────────────────────────────────────────────────────

interface MobileUserCardProps {
    user: User
    onSelect: () => void
    onEdit: () => void
    onDelete: () => void
}

function MobileUserCard({ user, onSelect, onEdit, onDelete }: MobileUserCardProps) {
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
            <div className="flex items-center gap-2">
                <Avatar className="size-8 shrink-0">
                    <AvatarFallback className="text-xs">
                        {getInitials(user.fullName)}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-sm">{user.fullName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                        <Badge
                            variant="outline"
                            className={cn(
                                "text-[10px] h-4 px-1.5 font-medium border",
                                ROLE_COLORS[user.role] || "bg-muted/50"
                            )}
                        >
                            {ROLE_LABELS[user.role] || user.role}
                        </Badge>
                    </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu onView={onSelect} onEdit={onEdit} onDelete={onDelete} />
                </div>
            </div>
        </div>
    )
}

// ─── Pagination ─────────────────────────────────────────────────────────────

interface UsersPaginationProps {
    page: number
    totalPages: number
    onPageChange: (page: number) => void
    disabled?: boolean
}

function UsersPagination({ page, totalPages, onPageChange, disabled }: UsersPaginationProps) {
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

// ─── User Details Dialog ────────────────────────────────────────────────────

interface UserDetailsDialogProps {
    user: User | null
    open: boolean
    onOpenChange: () => void
    showSacco: boolean
    onEdit: () => void
    onDelete: () => void
}

function UserDetailsDialog({ user, open, onOpenChange, showSacco, onEdit, onDelete }: UserDetailsDialogProps) {
    const saccoName = useSaccoName(user?.saccoId ?? undefined)
    if (!user) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md p-4 sm:p-5 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <Avatar className="size-12 shrink-0">
                            <AvatarFallback className="text-base">
                                {getInitials(user.fullName)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                            <DialogTitle className="truncate text-foreground">
                                {user.fullName}
                            </DialogTitle>
                            <DialogDescription className="flex items-center gap-2 mt-1">
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        "text-[10px] h-5 px-1.5 font-medium border",
                                        ROLE_COLORS[user.role] || "bg-muted/50"
                                    )}
                                >
                                    <Shield className="size-2.5 mr-1" />
                                    {ROLE_LABELS[user.role] || user.role}
                                </Badge>
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Email</p>
                            <p className="text-sm truncate">
                                {user.email ? (
                                    <a href={`mailto:${user.email}`} className="text-primary hover:underline">
                                        {user.email}
                                    </a>
                                ) : "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Phone</p>
                            <p className="text-sm">
                                {user.phoneNumber ? (
                                    <a href={`tel:${user.phoneNumber}`} className="text-primary hover:underline">
                                        {user.phoneNumber}
                                    </a>
                                ) : "—"}
                            </p>
                        </div>
                    </div>

                    {showSacco && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Sacco</p>
                            <p className="text-sm">
                                {user.saccoId ? (saccoName ?? "Loading...") : "—"}
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t">
                        <div>
                            <p className="font-medium text-muted-foreground">User ID</p>
                            <p className="font-mono text-[10px] truncate">{user.id}</p>
                        </div>
                        <div>
                            <p className="font-medium text-muted-foreground">Joined</p>
                            <p>{new Date(user.createdAt).toLocaleDateString()}</p>
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-destructive hover:text-destructive"
                        onClick={onDelete}
                    >
                        <Trash2 className="size-3.5 mr-1.5" />
                        Remove
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
                        <Pencil className="size-3.5 mr-1.5" />
                        Edit
                    </Button>
                    <Button size="sm" className="flex-1" onClick={onOpenChange}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Edit User Dialog ────────────────────────────────────────────────────────

interface EditUserDialogProps {
    user: User | null
    open: boolean
    onOpenChange: () => void
    onSaved: () => void
}

function EditUserDialog({ user, open, onOpenChange, onSaved }: EditUserDialogProps) {
    const [form, setForm] = useState<UpdateUserPayload>({})

    // Reset the form whenever a different user is opened for editing.
    useEffect(() => {
        if (user) {
            setForm({
                fullName: user.fullName,
                email: user.email || undefined,
                phoneNumber: user.phoneNumber || undefined,
                role: user.role as UpdateUserPayload["role"],
            })
        }
    }, [user])

    const mutation = useMutation({
        mutationFn: (payload: UpdateUserPayload) => updateUserRequest(user!.id, payload),
        onSuccess: () => {
            toast.success("User updated")
            onSaved()
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to update user")
        },
    })

    if (!user) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit user</DialogTitle>
                    <DialogDescription>Update {user.fullName}&apos;s details.</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="fullName">Full name</Label>
                        <Input
                            id="fullName"
                            value={form.fullName ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={form.email ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="phoneNumber">Phone</Label>
                        <Input
                            id="phoneNumber"
                            value={form.phoneNumber ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Role</Label>
                        <Select
                            value={form.role}
                            onValueChange={(value) => setForm((f) => ({ ...f, role: value as any }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select a role" />
                            </SelectTrigger>
                            <SelectContent>
                                {EDITABLE_ROLES.map((role) => (
                                    <SelectItem key={role} value={role}>
                                        {ROLE_LABELS[role]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" size="sm" onClick={onOpenChange}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate(form)}
                    >
                        {mutation.isPending && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

interface UsersTableSkeletonProps {
    isMobile?: boolean
}

function UsersTableSkeleton({ isMobile }: UsersTableSkeletonProps) {
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
                            <Skeleton className="size-8 rounded-full" />
                            <div className="flex-1">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/3 mt-1" />
                            </div>
                            <Skeleton className="h-4 w-4" />
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
                    <div className="grid grid-cols-4 gap-4">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                    </div>
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 border-b last:border-0">
                        <div className="grid grid-cols-4 gap-4 items-center">
                            <Skeleton className="h-5 w-3/4" />
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-5 w-6" />
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
}

function EmptyState({ title, description }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-10 px-4 text-center">
            <div className="rounded-full bg-muted/30 p-2.5">
                <Users className="size-5 text-muted-foreground/40" />
            </div>
            <div className="space-y-0.5">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
        </div>
    )
}