// src/features/auth/SaccoUsersTable.tsx
import { useState, useEffect } from "react"
import {
    useQuery,
    useMutation,
    useQueryClient,
    keepPreviousData,
} from "@tanstack/react-query"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
    ChevronLeft,
    ChevronRight,
    Search,
    Users,
    Pencil,
    Trash2,
    Plus,
    X,
    Loader2,
    MailWarning,
    Send,
    Undo2,
    Archive,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    getUsersRequest,
    updateUserRequest,
    deleteUserRequest,
    restoreUserRequest,
    sendPasswordLinkRequest,
    type UpdateUserPayload,
} from "@/api/authApi"
import AdminCreateUser from "@/features/auth/AdmincreateUser"
import { useSaccoName } from "@/hooks/useSaccoName"
import { ALL_ADMINS, RoleGuard } from "../auth/RoleGuard"
import type { User } from "@/api/authApi"

// ─── Types ───────────────────────────────────────────────────────────────────

interface SaccoUsersTableProps {
    saccoId?: string
}



// ─── Constants ───────────────────────────────────────────────────────────────

const ROLE_META: Record<
    string,
    { label: string; dot: string }
> = {
    SUPER_ADMIN: {
        label: "Super Admin",
        dot: "bg-purple-500",
    },
    SACCO_ADMIN: {
        label: "Sacco Admin",
        dot: "bg-blue-500",
    },
    CLERK: {
        label: "Clerk",
        dot: "bg-emerald-500",
    },
    DRIVER: {
        label: "Driver",
        dot: "bg-amber-500",
    },
}

const EDITABLE_ROLES = ["SACCO_ADMIN", "CLERK", "DRIVER"]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string) {
    const parts = name.trim().split(/\s+/)
    if (parts.length === 0) return "?"
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    })
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Shown until the user follows their invite link and picks a password. Until
// then the account exists but nobody can sign into it.
function PendingInviteBadge() {
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            <MailWarning className="size-2.5" />
            Invite pending
        </span>
    )
}

// One place for the resend, used by both the row and the details dialog.
function useSendPasswordLink() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (id: string) => sendPasswordLinkRequest(id),
        onSuccess: (data) => {
            toast.success(data.message)
            queryClient.invalidateQueries({ queryKey: ["users", "table"] })
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to send the link")
        },
    })
}

function RoleBadge({ role }: { role: string }) {
    const meta = ROLE_META[role]
    if (!meta) return <span className="text-xs text-muted-foreground">{role}</span>

    return (
        <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", meta.dot)} />
            <span className="text-xs text-muted-foreground">{meta.label}</span>
        </div>
    )
}

function UserSaccoCell({ saccoId }: { saccoId: string | null }) {
    const name = useSaccoName(saccoId ?? undefined)
    if (!saccoId) return <span className="text-muted-foreground">—</span>
    return <span className="text-sm text-muted-foreground">{name ?? "…"}</span>
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function SaccoUsersTable({ saccoId }: SaccoUsersTableProps) {
    const [page, setPage] = useState(1)
    const [search, setSearch] = useState("")
    const [selectedUser, setSelectedUser] = useState<User | null>(null)
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [deletingUser, setDeletingUser] = useState<User | null>(null)
    const [createUserOpen, setCreateUserOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    // Removed users are soft-deleted, so they're hidden until you ask for them.
    const [showRemoved, setShowRemoved] = useState(false)

    const limit = 10
    const queryClient = useQueryClient()
    const saccoName = useSaccoName(saccoId)

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768)
        check()
        window.addEventListener("resize", check)
        return () => window.removeEventListener("resize", check)
    }, [])

    const {
        data,
        isLoading,
        isFetching,
        isError,
        refetch,
    } = useQuery({
        queryKey: ["users", "table", saccoId, page, limit, search, showRemoved],
        queryFn: () =>
            getUsersRequest({
                saccoId,
                page,
                limit,
                search,
                status: showRemoved ? "removed" : "active",
            }),
        placeholderData: keepPreviousData,
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteUserRequest(id),
        onSuccess: (data) => {
            toast.success(data.message ?? "User removed")
            queryClient.invalidateQueries({ queryKey: ["users", "table"] })
            setDeletingUser(null)
            setSelectedUser(null)
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to remove user")
        },
    })

    const restoreMutation = useMutation({
        mutationFn: (id: string) => restoreUserRequest(id),
        onSuccess: (data) => {
            toast.success(data.message)
            queryClient.invalidateQueries({ queryKey: ["users", "table"] })
            setSelectedUser(null)
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to restore user")
        },
    })

    const users = data?.data ?? []
    const meta = data?.meta

    // Loading
    if (isLoading) return <UsersTableSkeleton isMobile={isMobile} />

    // Error
    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="text-sm text-muted-foreground">Failed to load users</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                    Try again
                </Button>
            </div>
        )
    }

    // Empty
    if (!users.length) {
        // The removed list has its own empty state — offering "Add user" there
        // would answer a question nobody asked.
        if (showRemoved) {
            return (
                <EmptyState
                    title="Nothing in here"
                    description="No removed users to restore."
                    action={
                        <Button size="sm" variant="outline" onClick={() => setShowRemoved(false)}>
                            Back to active users
                        </Button>
                    }
                />
            )
        }

        return (
            <EmptyState
                title="No users found"
                description={
                    saccoId
                        ? `No users in ${saccoName ?? "this sacco"}`
                        : search
                            ? "Try a different search term"
                            : "Get started by adding your first user"
                }
                action={
                    <RoleGuard allowed={ALL_ADMINS}>
                        <Button size="sm" variant="outline" onClick={() => setCreateUserOpen(true)}>
                            <Plus className="mr-1.5 size-3.5" />
                            Add user
                        </Button>
                    </RoleGuard>
                }
            />
        )
    }

    return (
        <>
            <div className="space-y-4">
                {/* Toolbar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-lg font-medium tracking-tight">
                            {saccoId ? saccoName ?? "Sacco" : "All users"}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {meta?.total ?? 0}{" "}
                            {showRemoved
                                ? meta?.total === 1
                                    ? "removed user"
                                    : "removed users"
                                : meta?.total === 1
                                    ? "user"
                                    : "users"}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                            <Input
                                type="search"
                                placeholder="Search…"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value)
                                    setPage(1)
                                }}
                                className="h-8 w-full pl-8 pr-7 text-xs sm:w-56"
                            />
                            {search && (
                                <button
                                    onClick={() => {
                                        setSearch("")
                                        setPage(1)
                                    }}
                                    className="absolute right-0 top-0 flex h-full items-center px-2 text-muted-foreground/50 hover:text-foreground"
                                >
                                    <X className="size-3" />
                                </button>
                            )}
                        </div>

                        {/* Removed users are hidden by default — this is how you find
                            someone to restore */}
                        <RoleGuard allowed={ALL_ADMINS}>
                            <Button
                                size="sm"
                                variant={showRemoved ? "secondary" : "outline"}
                                className="h-8 gap-1.5 text-xs"
                                onClick={() => {
                                    setShowRemoved((v) => !v)
                                    setPage(1)
                                }}
                            >
                                <Archive className="size-3.5" />
                                <span className="hidden sm:inline">
                                    {showRemoved ? "Showing removed" : "Removed"}
                                </span>
                            </Button>
                        </RoleGuard>

                        {/* Add user – only for admins */}
                        <RoleGuard allowed={ALL_ADMINS}>
                            <Button
                                size="sm"
                                className="h-8 gap-1.5 text-xs"
                                onClick={() => setCreateUserOpen(true)}
                            >
                                <Plus className="size-3.5" />
                                <span className="hidden sm:inline">Add user</span>
                            </Button>
                        </RoleGuard>
                    </div>
                </div>

                {/* Content */}
                {isMobile ? (
                    <div className="divide-y">
                        {users.map((user) => (
                            <MobileUserRow
                                key={user.id}
                                user={user}
                                onSelect={() => setSelectedUser(user)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="h-9 text-xs font-medium text-muted-foreground">
                                        User
                                    </TableHead>
                                    <TableHead className="h-9 w-[140px] text-xs font-medium text-muted-foreground">
                                        Role
                                    </TableHead>
                                    {!saccoId && (
                                        <TableHead className="h-9 w-[160px] text-xs font-medium text-muted-foreground">
                                            Sacco
                                        </TableHead>
                                    )}
                                    {/* Actions column – only for admins */}
                                    <RoleGuard allowed={ALL_ADMINS}>
                                        <TableHead className="h-9 w-[80px]" />
                                    </RoleGuard>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.map((user) => (
                                    <DesktopUserRow
                                        key={user.id}
                                        user={user}
                                        showSacco={!saccoId}
                                        onSelect={() => setSelectedUser(user)}
                                        onEdit={() => setEditingUser(user)}
                                        onDelete={() => setDeletingUser(user!)}
                                        onRestore={() => restoreMutation.mutate(user.id)}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {/* Pagination */}
                {meta && meta.totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                        <p className="text-xs text-muted-foreground">
                            Page {page} of {meta.totalPages}
                        </p>
                        <div className="flex items-center gap-1.5">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                disabled={isFetching || page <= 1}
                                onClick={() => setPage((p) => p - 1)}
                            >
                                <ChevronLeft className="mr-1 size-3" />
                                Prev
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                disabled={isFetching || page >= meta.totalPages}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                Next
                                <ChevronRight className="ml-1 size-3" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            <UserDetailsDialog
                user={selectedUser}
                open={!!selectedUser}
                onOpenChange={() => setSelectedUser(null)}
                showSacco={!saccoId}
                onEdit={() => {
                    if (selectedUser) {
                        setEditingUser(selectedUser)
                        setSelectedUser(null)
                    }
                }}
                onDelete={() => {
                    if (selectedUser) {
                        setDeletingUser(selectedUser)
                        setSelectedUser(null)
                    }
                }}
                onRestore={() => selectedUser && restoreMutation.mutate(selectedUser.id)}
                restoring={restoreMutation.isPending}
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

            <DeleteDialog
                user={deletingUser}
                isPending={deleteMutation.isPending}
                onConfirm={() => deletingUser && deleteMutation.mutate(deletingUser.id)}
                onCancel={() => setDeletingUser(null)}
            />

            <CreateUserDialog
                open={createUserOpen}
                onOpenChange={setCreateUserOpen}
                onCreated={() => {
                    setSearch("")
                    setPage(1)
                    queryClient.invalidateQueries({ queryKey: ["users", "table"] })
                }}
            />
        </>
    )
}

// ─── Desktop Row ─────────────────────────────────────────────────────────────

interface DesktopUserRowProps {
    user: User
    showSacco: boolean
    onSelect: () => void
    onEdit: () => void
    onDelete: () => void
    onRestore: () => void
}

function DesktopUserRow({
    user,
    showSacco,
    onSelect,
    onEdit,
    onDelete,
    onRestore,
}: DesktopUserRowProps) {
    return (
        <TableRow
            className="group cursor-pointer transition-colors hover:bg-muted/40"
            onClick={onSelect}
        >
            <TableCell>
                <div className="flex items-center gap-3">
                    <Avatar className="size-8 border-0">
                        <AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
                            {getInitials(user.fullName)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-medium">{user.fullName}</p>
                            {!user.passwordSetAt && <PendingInviteBadge />}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                            {user.email || user.phoneNumber || "—"}
                        </p>
                    </div>
                </div>
            </TableCell>

            <TableCell>
                <RoleBadge role={user.role} />
            </TableCell>

            {showSacco && (
                <TableCell>
                    <UserSaccoCell saccoId={user.saccoId ?? null} />
                </TableCell>
            )}

            {/* Actions – only for admins */}
            <RoleGuard allowed={ALL_ADMINS}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        {user.isActive === false ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onRestore()
                                }}
                            >
                                <Undo2 className="size-3.5" />
                                Restore
                            </Button>
                        ) : (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onEdit()
                                    }}
                                >
                                    <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground hover:text-destructive"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onDelete()
                                    }}
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </>
                        )}
                    </div>
                </TableCell>
            </RoleGuard>
        </TableRow>
    )
}

// ─── Mobile Row ──────────────────────────────────────────────────────────────

interface MobileUserRowProps {
    user: User
    onSelect: () => void
}

function MobileUserRow({ user, onSelect }: MobileUserRowProps) {
    return (
        <button
            onClick={onSelect}
            className="flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <div className="flex items-center gap-3 min-w-0">
                <Avatar className="size-8 border-0">
                    <AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
                        {getInitials(user.fullName)}
                    </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user.fullName}</p>
                    <div className="flex items-center gap-1.5">
                        <RoleBadge role={user.role} />
                        {!user.passwordSetAt && <PendingInviteBadge />}
                    </div>
                </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
        </button>
    )
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

function UserDetailsDialog({
    user,
    open,
    onOpenChange,
    showSacco,
    onEdit,
    onDelete,
    onRestore,
    restoring,
}: {
    user: User | null
    open: boolean
    onOpenChange: () => void
    showSacco: boolean
    onEdit: () => void
    onDelete: () => void
    onRestore: () => void
    restoring: boolean
}) {
    const saccoName = useSaccoName(user?.saccoId ?? undefined)
    const sendLink = useSendPasswordLink()
    if (!user) return null

    const isPending = !user.passwordSetAt
    const isRemoved = user.isActive === false

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="gap-6 sm:max-w-sm">
                <DialogHeader className="space-y-4">
                    <div className="flex items-center gap-3">
                        <Avatar className="size-10">
                            <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground">
                                {getInitials(user.fullName)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                            <DialogTitle className="truncate text-base">
                                {user.fullName}
                            </DialogTitle>
                            <div className="flex items-center gap-1.5">
                                <RoleBadge role={user.role} />
                                {isPending && <PendingInviteBadge />}
                                {isRemoved && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                        <Archive className="size-2.5" />
                                        Removed
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Email</p>
                        {user.email ? (
                            <a
                                href={`mailto:${user.email}`}
                                className="text-sm hover:underline"
                            >
                                {user.email}
                            </a>
                        ) : (
                            <p className="text-sm text-muted-foreground">—</p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Phone</p>
                        {user.phoneNumber ? (
                            <a
                                href={`tel:${user.phoneNumber}`}
                                className="text-sm hover:underline"
                            >
                                {user.phoneNumber}
                            </a>
                        ) : (
                            <p className="text-sm text-muted-foreground">—</p>
                        )}
                    </div>

                    {showSacco && (
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Sacco</p>
                            <p className="text-sm text-muted-foreground">
                                {user.saccoId ? (saccoName ?? "…") : "—"}
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 border-t pt-4">
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Joined</p>
                            <p className="text-xs">{formatDate(user.createdAt!)}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">User ID</p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                                {user.id}
                            </p>
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex-wrap gap-2 sm:gap-2">
                    {/* Admin gets Edit/Remove, Clerk gets Close */}
                    <RoleGuard
                        allowed={ALL_ADMINS}
                        fallback={
                            <Button variant="outline" size="sm" className="w-full" onClick={onOpenChange}>
                                Close
                            </Button>
                        }
                    >
                        {isRemoved ? (
                            <Button
                                size="sm"
                                className="w-full"
                                disabled={restoring}
                                onClick={onRestore}
                            >
                                {restoring ? (
                                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                ) : (
                                    <Undo2 className="mr-1.5 size-3.5" />
                                )}
                                Restore access
                            </Button>
                        ) : (
                            <>
                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            disabled={!user.email || sendLink.isPending}
                            onClick={() => sendLink.mutate(user.id)}
                            title={
                                user.email
                                    ? undefined
                                    : "This user has no email address on file"
                            }
                        >
                            {sendLink.isPending ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                                <Send className="mr-1.5 size-3.5" />
                            )}
                            {isPending ? "Resend invite" : "Reset password"}
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
                            <Pencil className="mr-1.5 size-3.5" />
                            Edit
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-destructive hover:text-destructive"
                            onClick={onDelete}
                        >
                            <Trash2 className="mr-1.5 size-3.5" />
                            Remove
                        </Button>
                            </>
                        )}
                    </RoleGuard>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function EditUserDialog({
    user,
    open,
    onOpenChange,
    onSaved,
}: {
    user: User | null
    open: boolean
    onOpenChange: () => void
    onSaved: () => void
}) {
    const [form, setForm] = useState<UpdateUserPayload>({})

    useEffect(() => {
        if (!user) return
        setForm({
            fullName: user.fullName,
            email: user.email || undefined,
            phoneNumber: user.phoneNumber || undefined,
            role: user.role as UpdateUserPayload["role"],
        })
    }, [user])

    const mutation = useMutation({
        mutationFn: (payload: UpdateUserPayload) =>
            updateUserRequest(user!.id, payload),
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
                    <DialogTitle className="text-base">Edit user</DialogTitle>
                    <DialogDescription>
                        Update {user.fullName}&apos;s details.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    <div className="space-y-1.5">
                        <Label htmlFor="fullName" className="text-xs">
                            Full name
                        </Label>
                        <Input
                            id="fullName"
                            value={form.fullName ?? ""}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, fullName: e.target.value }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="email" className="text-xs">
                            Email
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            value={form.email ?? ""}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, email: e.target.value }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="phoneNumber" className="text-xs">
                            Phone
                        </Label>
                        <Input
                            id="phoneNumber"
                            value={form.phoneNumber ?? ""}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    phoneNumber: e.target.value,
                                }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Role</Label>
                        <Select
                            value={form.role}
                            onValueChange={(v) =>
                                setForm((f) => ({ ...f, role: v as any }))
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select a role" />
                            </SelectTrigger>
                            <SelectContent>
                                {EDITABLE_ROLES.map((role) => (
                                    <SelectItem key={role} value={role}>
                                        {ROLE_META[role]?.label ?? role}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter className="flex-wrap gap-2 sm:gap-2">
                    <Button variant="outline" size="sm" onClick={onOpenChange}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate(form)}
                    >
                        {mutation.isPending && (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        )}
                        Save changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function DeleteDialog({
    user,
    isPending,
    onConfirm,
    onCancel,
}: {
    user: User | null
    isPending: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    // A never-activated account is erased rather than deactivated — say so,
    // because the two outcomes are genuinely different.
    const isInvitePending = !!user && !user.passwordSetAt

    return (
        <Dialog open={!!user} onOpenChange={onCancel}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-base">
                        {isInvitePending ? "Cancel this invite?" : "Remove user?"}
                    </DialogTitle>
                    <DialogDescription>
                        {isInvitePending
                            ? `${user?.fullName} never set a password, so the account will be deleted outright and their invite link will stop working. The email address becomes free to use again.`
                            : `${user?.fullName} will lose access immediately. Their trips and bookings are kept. This cannot be undone.`}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex-wrap gap-2 sm:gap-2">
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={isPending}
                        onClick={onConfirm}
                    >
                        {isPending && (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        )}
                        {isInvitePending ? "Cancel invite" : "Remove"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function CreateUserDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    onCreated: () => void
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-base">Add user</DialogTitle>
                    <DialogDescription>
                        Create a new user account.
                    </DialogDescription>
                </DialogHeader>
                <AdminCreateUser
                    onCreated={() => {
                        onCreated()
                        onOpenChange(false)
                    }}
                />
            </DialogContent>
        </Dialog>
    )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function UsersTableSkeleton({ isMobile }: { isMobile?: boolean }) {
    if (isMobile) {
        return (
            <div className="divide-y">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                            <Skeleton className="size-8 rounded-full" />
                            <div className="space-y-1.5">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-16" />
                            </div>
                        </div>
                        <Skeleton className="size-4" />
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-8 w-32" />
            </div>
            <div className="space-y-0">
                <div className="flex gap-4 pb-2">
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-[140px]" />
                    <Skeleton className="h-4 w-[160px]" />
                    <Skeleton className="h-4 w-[80px]" />
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 py-3">
                        <div className="flex flex-1 items-center gap-3">
                            <Skeleton className="size-8 rounded-full" />
                            <div className="space-y-1.5">
                                <Skeleton className="h-4 w-40" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                        </div>
                        <Skeleton className="h-4 w-[100px]" />
                        <Skeleton className="h-4 w-[120px]" />
                        <Skeleton className="h-4 w-[60px]" />
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({
    title,
    description,
    action,
}: {
    title: string
    description: string
    action?: React.ReactNode
}) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Users className="size-6 text-muted-foreground/30" />
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{title}</p>
                <p className="text-xs text-muted-foreground/60">{description}</p>
            </div>
            {action}
        </div>
    )
}