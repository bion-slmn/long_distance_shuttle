// src/features/auth/Profile.tsx
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    LogOut,
    Mail,
    Phone,
    MapPin,
    Building2,
    Loader2,
    ShieldCheck,
    ClipboardList,
    Car,
    UserRound,
    KeyRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "./AuthContext"
import { changePasswordRequest } from "@/api/authApi"
import { useSaccoName } from "@/hooks/useSaccoName"

// ─── Constants ───────────────────────────────────────────────────────────────
// Same role vocabulary as ROLE_META in SaccoUsersTable.tsx, extended here with
// the extra tokens a hero-style header needs: a cover tint, badge colors, and
// an icon that reads at a glance which seat this account holds.

const ROLE_META: Record<
    string,
    {
        label: string
        icon: React.ComponentType<{ className?: string }>
        cover: string
        badge: string
        ring: string
    }
> = {
    SUPER_ADMIN: {
        label: "Super Admin",
        icon: ShieldCheck,
        cover: "from-purple-500/15 via-purple-500/5 to-transparent",
        badge: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
        ring: "ring-purple-500/20",
    },
    SACCO_ADMIN: {
        label: "Sacco Admin",
        icon: Building2,
        cover: "from-blue-500/15 via-blue-500/5 to-transparent",
        badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
        ring: "ring-blue-500/20",
    },
    CLERK: {
        label: "Clerk",
        icon: ClipboardList,
        cover: "from-emerald-500/15 via-emerald-500/5 to-transparent",
        badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
        ring: "ring-emerald-500/20",
    },
    DRIVER: {
        label: "Driver",
        icon: Car,
        cover: "from-amber-500/15 via-amber-500/5 to-transparent",
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
        ring: "ring-amber-500/20",
    },
    PASSENGER: {
        label: "Passenger",
        icon: UserRound,
        cover: "from-slate-500/15 via-slate-500/5 to-transparent",
        badge: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400",
        ring: "ring-slate-500/20",
    },
}

const FALLBACK_META = ROLE_META.PASSENGER

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string) {
    const parts = name.trim().split(/\s+/)
    if (parts.length === 0) return "?"
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function DetailTile({
    icon: Icon,
    label,
    value,
}: {
    icon: React.ComponentType<{ className?: string }>
    label: string
    value: string
}) {
    return (
        <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
                <Icon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="truncate text-sm font-medium">{value}</p>
            </div>
        </div>
    )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
    return (
        <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border">
            <Skeleton className="h-24 w-full rounded-none" />
            <div className="px-6 pb-6">
                <Skeleton className="-mt-10 size-20 rounded-full ring-4 ring-background" />
                <div className="mt-4 space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-24" />
                </div>
                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 rounded-lg" />
                    ))}
                </div>
            </div>
        </div>
    )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function Profile() {
    const { user, isLoading, logout } = useAuth()
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [passwordOpen, setPasswordOpen] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    // Called unconditionally (rules of hooks) — safe no-op via `enabled` when
    // there's no user yet or no saccoId.
    const saccoName = useSaccoName(user?.saccoId ?? undefined)

    if (isLoading) return <ProfileSkeleton />

    if (!user) {
        return (
            <div className="mx-auto max-w-2xl rounded-xl border p-6 text-center text-sm text-muted-foreground">
                You're not signed in.
            </div>
        )
    }

    const meta = ROLE_META[user.role] ?? FALLBACK_META
    const RoleIcon = meta.icon

    async function handleConfirmLogout() {
        setSigningOut(true)
        try {
            await logout()
        } finally {
            setSigningOut(false)
            setConfirmOpen(false)
        }
    }

    return (
        <>
            <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border">
                {/* Cover */}
                <div className={cn("relative h-24 w-full bg-gradient-to-br", meta.cover)}>
                    <span
                        className={cn(
                            "absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium backdrop-blur",
                            user.isActive ? "text-emerald-700 dark:text-emerald-400" : ""
                        )}
                    >
                        <span
                            className={cn(
                                "size-1.5 rounded-full",
                                user.isActive ? "bg-emerald-500" : ""
                            )}
                        />
                    </span>
                </div>

                <div className="px-6 pb-6">
                    {/* Avatar + identity */}
                    <div className="-mt-10 flex items-end justify-between">
                        <Avatar className={cn("size-20 ring-4 ring-background", meta.ring)}>
                            <AvatarFallback className="bg-background text-lg font-semibold">
                                {getInitials(user.fullName)}
                            </AvatarFallback>
                        </Avatar>
                    </div>

                    <div className="mt-4">
                        <h2 className="text-xl font-semibold tracking-tight">
                            {user.fullName}
                        </h2>
                        <span
                            className={cn(
                                "mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                                meta.badge
                            )}
                        >
                            <RoleIcon className="size-3.5" />
                            {meta.label}
                        </span>
                    </div>

                    {/* Details */}
                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DetailTile icon={Mail} label="Email" value={user.email ?? "—"} />
                        <DetailTile
                            icon={Phone}
                            label="Phone number"
                            value={user.phoneNumber ?? "—"}
                        />
                        {user.saccoId && (
                            <DetailTile
                                icon={Building2}
                                label="Sacco"
                                value={saccoName ?? "…"}
                            />
                        )}
                        {user.assignedStage && (
                            <DetailTile
                                icon={MapPin}
                                label="Assigned stage"
                                value={user.assignedStage}
                            />
                        )}
                    </div>

                    {/* Actions */}
                    <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPasswordOpen(true)}
                        >
                            <KeyRound className="mr-1.5 size-3.5" />
                            Change password
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setConfirmOpen(true)}
                        >
                            <LogOut className="mr-1.5 size-3.5" />
                            Sign out
                        </Button>
                    </div>
                </div>
            </div>

            <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="text-base">Sign out?</DialogTitle>
                        <DialogDescription>
                            You'll need to sign in again to access your account.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={signingOut}
                            onClick={handleConfirmLogout}
                        >
                            {signingOut && (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            )}
                            Sign out
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

// ─── Change password ─────────────────────────────────────────────────────────
// Changing a password bumps tokenVersion server-side, which kills every
// outstanding session. The response carries a fresh access token, so we hand it
// straight to setSession rather than bouncing the user back to the login screen.

function ChangePasswordDialog({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const { setSession } = useAuth()
    const [currentPassword, setCurrentPassword] = useState("")
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [localError, setLocalError] = useState<string | null>(null)

    function reset() {
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
        setLocalError(null)
    }

    const mutation = useMutation({
        mutationFn: () => changePasswordRequest(currentPassword, newPassword),
        onSuccess: (data) => {
            setSession(data)
            toast.success("Password updated")
            reset()
            onOpenChange(false)
        },
        onError: (err: any) => {
            setLocalError(err?.response?.data?.message ?? "Could not update your password.")
        },
    })

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setLocalError(null)

        if (newPassword.length < 8) {
            setLocalError("Your new password must be at least 8 characters.")
            return
        }
        if (newPassword !== confirmPassword) {
            setLocalError("The two new passwords don't match.")
            return
        }

        mutation.mutate()
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) reset()
                onOpenChange(next)
            }}
        >
            <DialogContent className="sm:max-w-sm">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="text-base">Change password</DialogTitle>
                        <DialogDescription>
                            You'll stay signed in here, but any other device will be signed out.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="current-password">Current password</Label>
                            <Input
                                id="current-password"
                                type="password"
                                autoComplete="current-password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="profile-new-password">New password</Label>
                            <Input
                                id="profile-new-password"
                                type="password"
                                autoComplete="new-password"
                                placeholder="At least 8 characters"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="profile-confirm-password">Confirm new password</Label>
                            <Input
                                id="profile-confirm-password"
                                type="password"
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>

                        {localError && (
                            <p className="text-sm text-destructive">{localError}</p>
                        )}
                    </div>

                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={mutation.isPending}>
                            {mutation.isPending && (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            )}
                            Update password
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
