// src/features/sacco/SaccoSettingsPanel.tsx
import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { AlertTriangle, CreditCard, Loader2, RefreshCw, ShieldCheck, Smartphone, Wallet } from "lucide-react"
import { toast } from "sonner"
import {
    getSaccoSettingsRequest,
    updateSaccoSettingsRequest,
    configureSaccoMpesaRequest,
    disableSaccoMpesaRequest,
    type ConfigureMpesaDto,
    type UpdateSaccoSettingsDto,
} from "@/api/saccoApi"
import { registerSaccoC2bUrlsRequest } from "@/api/paymentApi"
import { useSaccoName } from "@/hooks/useSaccoName"
import { ALL_ADMINS, RoleGuard } from "@/features/auth/RoleGuard"
import { useAuth } from "../auth/AuthContext"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string) {
    const parts = name.trim().split(/\s+/)
    if (parts.length === 0) return "?"
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

// ─── Main Component ──────────────────────────────────────────────────────────


export function SaccoSettingsPanel() {
    const user = useAuth().user
    const saccoId = user?.saccoId!

    const [mpesaDialogOpen, setMpesaDialogOpen] = useState(false)
    const queryClient = useQueryClient()

    const saccoName = useSaccoName(saccoId)

    const {
        data: settings,
        isLoading,
        isError,
        refetch,
    } = useQuery({
        queryKey: ["sacco-settings", saccoId],
        queryFn: () => getSaccoSettingsRequest(saccoId),
        enabled: !!saccoId,
    })

    const updateMutation = useMutation({
        mutationFn: (payload: UpdateSaccoSettingsDto) =>
            updateSaccoSettingsRequest(saccoId, payload),
        onMutate: async (payload) => {
            await queryClient.cancelQueries({ queryKey: ["sacco-settings", saccoId] })
            const previous = queryClient.getQueryData(["sacco-settings", saccoId])
            queryClient.setQueryData(["sacco-settings", saccoId], (old: any) => ({
                ...old,
                ...payload,
            }))
            return { previous }
        },
        onError: (err: any, _payload, context) => {
            if (context?.previous) {
                queryClient.setQueryData(["sacco-settings", saccoId], context.previous)
            }
            toast.error(err?.response?.data?.message ?? "Failed to update settings")
        },
        onSuccess: () => {
            toast.success("Settings updated")
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["sacco-settings", saccoId] })
        },
    })

    const registerC2bMutation = useMutation({
        mutationFn: () => registerSaccoC2bUrlsRequest(saccoId),
        onSuccess: () => {
            toast.success("Paybill callbacks registered with M-Pesa")
            queryClient.invalidateQueries({ queryKey: ["sacco-settings", saccoId] })
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to register paybill callbacks")
            queryClient.invalidateQueries({ queryKey: ["sacco-settings", saccoId] })
        },
    })

    const disableMpesaMutation = useMutation({
        mutationFn: () => disableSaccoMpesaRequest(saccoId),
        onSuccess: () => {
            toast.success("M-Pesa disabled")
            queryClient.invalidateQueries({ queryKey: ["sacco-settings", saccoId] })
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to disable M-Pesa")
        },
    })

    if (isLoading) return <SettingsSkeleton />

    if (isError || !settings) {
        return (
            <div className="flex flex-col items-start justify-center gap-3 py-16 text-left px-4">
                <p className="text-sm text-muted-foreground">Failed to load settings</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                    Try again
                </Button>
            </div>
        )
    }

    return (
        <div className="space-y-5 px-4 sm:space-y-6 sm:px-0">
            {/* Header */}
            <div className="flex items-center gap-3 text-left">
                <Avatar className="size-9 shrink-0 sm:size-10">
                    <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground">
                        {getInitials(saccoName ?? "?")}
                    </AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-left">
                    <h2 className="truncate text-base font-medium tracking-tight sm:text-lg">
                        {saccoName ?? "…"}
                    </h2>
                    <p className="text-xs text-muted-foreground">Sacco settings</p>
                </div>
            </div>

            {/* Booking & commission */}
            <RoleGuard
                allowed={ALL_ADMINS}
                fallback={
                    <ReadOnlySettingsCard settings={settings} />
                }
            >
                <Card>
                    <CardHeader className="pb-4 text-left">
                        <CardTitle className="text-sm font-medium">Bookings</CardTitle>
                        <CardDescription className="text-xs">
                            Control how this sacco accepts bookings and payments.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <SettingRow
                            label="Accepting bookings"
                            description="Turn off to pause new bookings sacco-wide."
                        >
                            <Switch
                                checked={settings.isAcceptingBookings}
                                disabled={updateMutation.isPending}
                                onCheckedChange={(checked) =>
                                    updateMutation.mutate({ isAcceptingBookings: checked })
                                }
                            />
                        </SettingRow>

                        <Separator />

                        <SettingRow
                            label="Accept cash payments"
                            description="Allow clerks to record cash bookings."
                        >
                            <Switch
                                checked={settings.acceptsCash}
                                disabled={updateMutation.isPending}
                                onCheckedChange={(checked) =>
                                    updateMutation.mutate({ acceptsCash: checked })
                                }
                            />
                        </SettingRow>

                        <Separator />

                        <CommissionRateRow
                            value={settings.commissionRate}
                            isPending={updateMutation.isPending}
                            onSave={(rate) =>
                                updateMutation.mutate({ commissionRate: rate })
                            }
                        />
                    </CardContent>
                </Card>

                {/* M-Pesa */}
                <Card>
                    <CardHeader className="pb-4 text-left">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="text-left">
                                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                    <Smartphone className="size-3.5 text-muted-foreground" />
                                    M-Pesa
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Accept payments via Daraja on this sacco's till.
                                </CardDescription>
                            </div>
                            {settings.mpesaConfigured ? (
                                <Badge
                                    variant="outline"
                                    className="gap-1 border-emerald-500/30 text-emerald-600"
                                >
                                    <ShieldCheck className="size-3" />
                                    Configured
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-muted-foreground">
                                    Not configured
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {settings.mpesaConfigured && (
                            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-left">
                                <div className="flex items-center gap-2">
                                    <Wallet className="size-3.5 shrink-0 text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">
                                        Shortcode
                                    </span>
                                </div>
                                <span className="font-mono text-xs">
                                    {settings.mpesaShortcode ?? "—"}
                                </span>
                            </div>
                        )}

                        {settings.mpesaConfigured && (
                            <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-left sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-start gap-2">
                                    {settings.mpesaC2bRegisteredAt ? (
                                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                                    ) : (
                                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                                    )}
                                    <div className="space-y-0.5">
                                        <p className="text-xs">
                                            {settings.mpesaC2bRegisteredAt
                                                ? "Direct paybill payments reach this system"
                                                : "Direct paybill payments are NOT reaching this system"}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                            {settings.mpesaC2bRegisteredAt
                                                ? `Callbacks registered ${new Date(settings.mpesaC2bRegisteredAt).toLocaleString()}`
                                                : settings.mpesaC2bRegistrationError
                                                    ? `M-Pesa said: ${settings.mpesaC2bRegistrationError}`
                                                    : "Registration has not succeeded yet."}
                                        </p>
                                    </div>
                                </div>
                                {!settings.mpesaC2bRegisteredAt && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 shrink-0 gap-1.5 text-xs"
                                        disabled={registerC2bMutation.isPending}
                                        onClick={() => registerC2bMutation.mutate()}
                                    >
                                        {registerC2bMutation.isPending ? (
                                            <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                            <RefreshCw className="size-3.5" />
                                        )}
                                        Retry registration
                                    </Button>
                                )}
                            </div>
                        )}

                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-full justify-start gap-1.5 text-xs sm:w-auto sm:justify-center"
                                onClick={() => setMpesaDialogOpen(true)}
                            >
                                <CreditCard className="size-3.5 shrink-0" />
                                {settings.mpesaConfigured
                                    ? "Update credentials"
                                    : "Configure M-Pesa"}
                            </Button>
                            {settings.mpesaConfigured && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 w-full justify-start text-xs text-destructive hover:text-destructive sm:w-auto sm:justify-center"
                                    disabled={disableMpesaMutation.isPending}
                                    onClick={() => disableMpesaMutation.mutate()}
                                >
                                    {disableMpesaMutation.isPending && (
                                        <Loader2 className="mr-1.5 size-3.5 shrink-0 animate-spin" />
                                    )}
                                    Disable
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
                {/* Pre-booking limits (read-only for now) */}
                <Card>
                    <CardHeader className="pb-4 text-left">
                        <CardTitle className="text-sm font-medium">Pre-booking limits</CardTitle>
                        <CardDescription className="text-xs">
                            Online booking rules for this sacco. Not yet editable — contact support to adjust.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <div className="flex items-center justify-between text-left">
                            <span className="text-muted-foreground">Online pre-booking</span>
                            <Badge variant="outline" className={settings.preBookingEnabled ? "border-emerald-500/30 text-emerald-600" : "text-muted-foreground"}>
                                {settings.preBookingEnabled ? "Enabled" : "Disabled"}
                            </Badge>
                        </div>
                        <div className="flex items-center justify-between text-left">
                            <span className="text-muted-foreground">Booking window</span>
                            <span className="font-mono text-xs">
                                {settings.preBookingMorningStart.slice(0, 5)} – {settings.preBookingMorningEnd.slice(0, 5)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-left">
                            <span className="text-muted-foreground">Max vehicles/morning</span>
                            <span>{settings.preBookingMaxMorningVehicles}</span>
                        </div>
                        <div className="flex items-center justify-between text-left">
                            <span className="text-muted-foreground">Max seats/trip</span>
                            <span>{settings.preBookingMaxSeatsPerTrip}</span>
                        </div>
                    </CardContent>
                </Card>
            </RoleGuard>

            <ConfigureMpesaDialog
                open={mpesaDialogOpen}
                onOpenChange={setMpesaDialogOpen}
                saccoId={saccoId}
                onConfigured={() => {
                    setMpesaDialogOpen(false)
                    queryClient.invalidateQueries({ queryKey: ["sacco-settings", saccoId] })
                }}
            />
        </div>
    )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SettingRow({
    label,
    description,
    children,
}: {
    label: string
    description: string
    children: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between gap-4 text-left">
            <div className="min-w-0 space-y-0.5 text-left">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    )
}

function CommissionRateRow({
    value,
    isPending,
    onSave,
}: {
    value: number
    isPending: boolean
    onSave: (rate: number) => void
}) {
    const [draft, setDraft] = useState(String(value))

    useEffect(() => {
        setDraft(String(value))
    }, [value])

    const dirty = Number(draft) !== value && draft !== ""

    return (
        <div className="flex items-center justify-between gap-3 text-left">
            <div className="min-w-0 space-y-0.5 text-left">
                <p className="text-sm font-medium">Commission rate</p>
                <p className="text-xs text-muted-foreground">
                    Percentage taken per booking.
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <div className="relative">
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="h-8 w-16 pr-6 text-right text-xs sm:w-20"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                    </span>
                </div>
                {dirty && (
                    <Button
                        size="sm"
                        className="h-8 px-2.5 text-xs"
                        disabled={isPending}
                        onClick={() => onSave(Number(draft))}
                    >
                        {isPending && <Loader2 className="mr-1 size-3 shrink-0 animate-spin" />}
                        Save
                    </Button>
                )}
            </div>
        </div>
    )
}

function ReadOnlySettingsCard({ settings }: { settings: any }) {
    return (
        <Card>
            <CardHeader className="pb-4 text-left">
                <CardTitle className="text-sm font-medium">Sacco overview</CardTitle>
                <CardDescription className="text-xs">
                    Contact a sacco admin to change these settings.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between text-left">
                    <span className="text-muted-foreground">Accepting bookings</span>
                    <span>{settings.isAcceptingBookings ? "Yes" : "No"}</span>
                </div>
                <div className="flex items-center justify-between text-left">
                    <span className="text-muted-foreground">Cash payments</span>
                    <span>{settings.acceptsCash ? "Yes" : "No"}</span>
                </div>
                <div className="flex items-center justify-between text-left">
                    <span className="text-muted-foreground">Commission rate</span>
                    <span>{settings.commissionRate}%</span>
                </div>
                <div className="flex items-center justify-between text-left">
                    <span className="text-muted-foreground">M-Pesa</span>
                    <span>{settings.mpesaConfigured ? "Configured" : "Not configured"}</span>
                </div>
                <div className="flex items-center justify-between text-left">
                    <span className="text-muted-foreground">Online pre-booking</span>
                    <span>{settings.preBookingEnabled ? "Enabled" : "Disabled"}</span>
                </div>
            </CardContent>
        </Card>
    )
}

// ─── M-Pesa Configuration Dialog ─────────────────────────────────────────────

function ConfigureMpesaDialog({
    open,
    onOpenChange,
    saccoId,
    onConfigured,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    saccoId: string
    onConfigured: () => void
}) {
    const [form, setForm] = useState<ConfigureMpesaDto>({
        shortcode: "",
        consumerKey: "",
        consumerSecret: "",
        passkey: "",
    })

    useEffect(() => {
        if (open) {
            setForm({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" })
        }
    }, [open])

    const mutation = useMutation({
        mutationFn: (payload: ConfigureMpesaDto) =>
            configureSaccoMpesaRequest(saccoId, payload),
        onSuccess: (saved) => {
            if (saved.mpesaC2bRegisteredAt) {
                toast.success("M-Pesa configured and paybill callbacks registered")
            } else {
                toast.warning(
                    saved.mpesaC2bRegistrationError
                        ? `M-Pesa configured, but paybill callbacks were not registered: ${saved.mpesaC2bRegistrationError}`
                        : "M-Pesa configured, but paybill callbacks were not registered. Retry from the settings panel.",
                )
            }
            onConfigured()
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message ?? "Failed to configure M-Pesa")
        },
    })

    const isValid =
        form.shortcode.trim() &&
        form.consumerKey.trim() &&
        form.consumerSecret.trim() &&
        form.passkey.trim()

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-lg text-left sm:w-full">
                <DialogHeader className="text-left">
                    <DialogTitle className="text-base">Configure M-Pesa</DialogTitle>
                    <DialogDescription>
                        Daraja credentials for this sacco's till. Stored encrypted and
                        never shown again after saving.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    <div className="space-y-1.5 text-left">
                        <Label htmlFor="shortcode" className="text-xs">
                            Till / paybill shortcode
                        </Label>
                        <Input
                            id="shortcode"
                            value={form.shortcode}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, shortcode: e.target.value }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5 text-left">
                        <Label htmlFor="consumerKey" className="text-xs">
                            Consumer key
                        </Label>
                        <Input
                            id="consumerKey"
                            value={form.consumerKey}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, consumerKey: e.target.value }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5 text-left">
                        <Label htmlFor="consumerSecret" className="text-xs">
                            Consumer secret
                        </Label>
                        <Input
                            id="consumerSecret"
                            type="password"
                            value={form.consumerSecret}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, consumerSecret: e.target.value }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5 text-left">
                        <Label htmlFor="passkey" className="text-xs">
                            Passkey
                        </Label>
                        <Input
                            id="passkey"
                            type="password"
                            value={form.passkey}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, passkey: e.target.value }))
                            }
                        />
                    </div>
                </div>

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={!isValid || mutation.isPending}
                        onClick={() => mutation.mutate(form)}
                    >
                        {mutation.isPending && (
                            <Loader2 className="mr-1.5 size-3.5 shrink-0 animate-spin" />
                        )}
                        Save & connect
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
    return (
        <div className="space-y-5 px-4 sm:space-y-6 sm:px-0">
            <div className="flex items-center gap-3">
                <Skeleton className="size-9 shrink-0 rounded-full sm:size-10" />
                <div className="space-y-1.5">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-24" />
                </div>
            </div>
            <div className="space-y-3">
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
            </div>
        </div>
    )
}