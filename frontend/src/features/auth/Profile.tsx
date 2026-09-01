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
// Same role vocabulary as ROLE_META in SaccoUsersTable.tsx, plus the badge
// tokens the hero header needs so the role reads at a glance. The cover behind
// the avatar is deliberately *not* role-tinted — it uses the app's primary
// colour so the page stays on-theme in both light and dark mode.

const ROLE_META: Record<
    string,
    {
        label: string
        icon: React.ComponentType<{ className?: string }>
        badge: string
    }
> = {
    SUPER_ADMIN: {
        label: "Super Admin",
        icon: ShieldCheck,
        badge: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30",
    },
    SACCO_ADMIN: {
        label: "Sacco Admin",
        icon: Building2,
        badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
    },
    CLERK: {
        label: "Clerk",
        icon: ClipboardList,
        badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
    },
    DRIVER: {
        label: "Driver",
        icon: Car,
        badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    },
    PASSENGER: {
        label: "Passenger",
        icon: UserRound,
        badge: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30",
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
        <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="size-4 text-primary" />
            </div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
            <p className="break-words text-sm font-medium">{value}</p>
        </div>
    )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
    return (
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <Skeleton className="h-32 w-full rounded-none sm:h-40" />
                <div className="px-4 pb-6 sm:px-8">
                    <div className="-mt-16 flex flex-col items-center sm:flex-row sm:items-end sm:gap-6">
                        <Skeleton className="size-32 rounded-full ring-4 ring-card" />
                        <div className="mt-4 flex flex-col items-center gap-2 sm:mb-2 sm:mt-0 sm:items-start">
                            <Skeleton className="h-7 w-48" />
                            <Skeleton className="h-6 w-28 rounded-full" />
                        </div>
                    </div>
                    <div className="mt-6 grid grid-cols-1 gap-4 sm:mt-8 sm:grid-cols-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-28 rounded-xl" />
                        ))}
                    </div>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
                        <Skeleton className="h-11 w-full rounded-lg sm:w-44" />
                        <Skeleton className="h-11 w-full rounded-lg sm:w-32" />
                    </div>
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
            <div className="mx-auto max-w-3xl p-4 sm:p-6">
                <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
                    You're not signed in.
                </div>
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
            <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
                <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                    {/* Cover */}
                    <div className="flex h-32 w-full items-start justify-end bg-gradient-to-r from-primary to-primary/70 px-4 pt-4 sm:h-40 sm:px-8">
                        <span className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/30 bg-primary-foreground/20 px-3 py-1 text-xs font-medium text-primary-foreground backdrop-blur-md">
                            <span
                                className={cn(
                                    "size-2 rounded-full",
                                    user.isActive ? "bg-emerald-300" : "bg-rose-300"
                                )}
                            />
                            {user.isActive ? "Active" : "Inactive"}
                        </span>
                    </div>

                    <div className="px-4 pb-6 sm:px-8">
                        {/* Avatar + identity */}
                        <div className="-mt-16 flex flex-col items-center sm:flex-row sm:items-end sm:gap-6">
                            <Avatar className="relative z-10 size-32 border-4 border-card bg-card shadow-md ring-4 ring-primary/15">
                                <AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary">
                                    {getInitials(user.fullName)}
                                </AvatarFallback>
                            </Avatar>

                            <div className="mt-4 text-center sm:mb-2 sm:mt-0 sm:text-left">
                                <h2 className="text-2xl font-semibold tracking-tight">
                                    {user.fullName}
                                </h2>
                                <span
                                    className={cn(
                                        "mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                                        meta.badge
                                    )}
                                >
                                    <RoleIcon className="size-3.5" />
                                    {meta.label}
                                </span>
                            </div>
                        </div>

                        {/* Details */}
                        <div className="mt-6 grid grid-cols-1 gap-4 sm:mt-8 sm:grid-cols-2">
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
                        <div className="mt-8 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:justify-end">
                            <Button
                                variant="outline"
                                className="h-11 w-full shadow-sm sm:w-auto"
                                onClick={() => setPasswordOpen(true)}
                            >
                                <KeyRound className="mr-2 size-4" />
                                Change password
                            </Button>
                            <Button
                                variant="outline"
                                className="h-11 w-full border-destructive text-destructive shadow-sm hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                                onClick={() => setConfirmOpen(true)}
                            >
                                <LogOut className="mr-2 size-4" />
                                Sign out
                            </Button>
                        </div>
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
