// src/features/queue/MpesaPaymentDialog.tsx
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    CheckCircle2,
    XCircle,
    RefreshCw,
    Smartphone,
    Download,
    MapPin,
    Loader2,
    Wallet,
    Armchair,
    CircleAlert,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { getBookingStatusRequest, type Booking } from "@/api/bookingApi"
import {
    getPaymentStatusForBookingRequest,
    reconcilePaymentRequest,
    type PaymentStatusForBooking,
} from "@/api/paymentApi"
import { downloadReceiptPdf } from "@/api/receiptApi"
import { invalidateQueues } from "@/hooks/useRouteQueues"

// ─── Constants ──────────────────────────────────────────────────────────────

/** How long we keep polling an STK push before giving up on it. */
const POLL_WINDOW_MS = 180_000
const POLL_INTERVAL_MS = 3_000

// ─── Pure helpers ───────────────────────────────────────────────────────────

function formatCountdown(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, "0")}`
}

function secondsLeftInPollWindow(startedAt: number | null): number {
    if (startedAt === null) return 0
    return Math.max(0, Math.floor((POLL_WINDOW_MS - (Date.now() - startedAt)) / 1000))
}

function hasElapsed(startedAt: number | null, ms: number): boolean {
    return startedAt !== null && Date.now() - startedAt > ms
}

/**
 * Tells the clerk what a manual check actually did. The button is local by
 * default — it re-reads our records, where the callback, the paybill
 * confirmation and the automatic checks all land — and only reaches
 * Safaricom for a payment the automatic checks have given up on, at most
 * once a minute. The wording has to say which happened, or a clerk will
 * mash it believing each press asks Safaricom.
 */
function toastReconcileResult(result: PaymentStatusForBooking) {
    if (result.status === "SUCCESS") return // the receipt view says it better

    const askedMpesa = result.checkedWith === "mpesa"
    if (result.status === "FAILED") {
        toast.error(result.errorMessage ?? "M-Pesa reports this payment failed.")
        return
    }
    if (result.status === "EXPIRED") {
        if (askedMpesa) {
            toast.error("Asked M-Pesa directly: no payment found for this booking.")
        } else if (result.mpesaCheckAvailableInSeconds) {
            toast.info(
                `No payment in our records. M-Pesa was asked moments ago — you can ask again in ${result.mpesaCheckAvailableInSeconds}s.`
            )
        } else {
            toast.info("No payment in our records yet.")
        }
        return
    }
    toast.info(
        askedMpesa
            ? "Asked M-Pesa directly: still not confirmed."
            : "Not confirmed yet. M-Pesa is checked automatically at 2:30 and 3:00 — no need to keep pressing."
    )
}

// ─── Dialog ─────────────────────────────────────────────────────────────────

export interface MpesaPaymentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The pending booking whose STK push we're waiting on. */
    booking: Booking
    route?: { origin: string; destination: string; id: string }
    travelDate: string
    /** Reopen the booking form to retry this same booking/seat. */
    onRetry: (booking: Booking) => void
}

export function MpesaPaymentDialog({
    open,
    onOpenChange,
    booking,
    route,
    travelDate,
    onRetry,
}: MpesaPaymentDialogProps) {
    const queryClient = useQueryClient()

    const [startedAt, setStartedAt] = useState<number | null>(null)

    useEffect(() => {
        setStartedAt(open ? Date.now() : null)
    }, [open, booking.id])

    // Re-renders every second so the countdown and the time-based flags below
    // stay live even though startedAt itself never changes.
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!open) return
        const interval = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(interval)
    }, [open])

    const paymentStatusQuery = useQuery({
        queryKey: ["payment-status", booking.id],
        queryFn: () => getPaymentStatusForBookingRequest(booking.id),
        enabled: open,
        refetchIntervalInBackground: true,
        refetchInterval: (query) => {
            const status = query.state.data?.status
            if (status && status !== "PENDING" && status !== "PROCESSING") return false
            if (hasElapsed(startedAt, POLL_WINDOW_MS)) return false
            return POLL_INTERVAL_MS
        },
    })

    const paymentResult = paymentStatusQuery.data
    const paymentSucceeded = paymentResult?.status === "SUCCESS"
    const paymentFailed = paymentResult?.status === "FAILED" || paymentResult?.status === "EXPIRED"
    const paymentTimedOut =
        open &&
        !paymentSucceeded &&
        !paymentFailed &&
        hasElapsed(startedAt, POLL_WINDOW_MS) &&
        !paymentStatusQuery.isFetching

    // On demand only. The backend's own schedule asks Safaricom at 2:30 and
    // 3:00; this press re-reads our records (cheap, unlimited) and reaches
    // Safaricom only once that schedule has given up — see toastReconcileResult.
    const reconcileMutation = useMutation({
        mutationFn: () => reconcilePaymentRequest(booking.id),
        onSuccess: (result) => {
            queryClient.setQueryData(["payment-status", booking.id], result)
        },
    })

    const handleManualReconcile = async () => {
        if (reconcileMutation.isPending) return
        try {
            toastReconcileResult(await reconcileMutation.mutateAsync())
        } catch {
            toast.error("Couldn't check right now. Try again in a moment.")
        }
    }

    // Definitive seat number + receipt number for the receipt, straight from
    // the booking record once payment lands.
    const finalBookingQuery = useQuery({
        queryKey: ["booking-final", booking.id],
        queryFn: () => getBookingStatusRequest(booking.id),
        enabled: paymentSucceeded,
    })

    useEffect(() => {
        if (paymentSucceeded) {
            // The seat is now really taken — refresh the grid behind the dialog.
            invalidateQueues(queryClient)
            queryClient.invalidateQueries({ queryKey: ["seat-map", route?.id, travelDate] })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paymentSucceeded])

    const downloadMutation = useMutation({
        mutationFn: () => downloadReceiptPdf(booking.id),
        onError: () => toast.error("Couldn't download the receipt. Try again."),
    })

    const secondsRemaining = secondsLeftInPollWindow(startedAt)
    const settled = paymentFailed || paymentTimedOut

    return (
        // While the prompt is live the dialog is not dismissible — a stray
        // backdrop tap shouldn't lose the clerk's view of a payment in
        // flight. The explicit "Close" button below is always the way out.
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            disablePointerDismissal={!paymentSucceeded && !settled}
        >
            <DialogContent className="sm:max-w-md">
                {paymentSucceeded ? (
                    <PaymentReceipt
                        booking={booking}
                        route={route}
                        travelDate={travelDate}
                        seatNumber={
                            finalBookingQuery.data
                                ? finalBookingQuery.data.seatNumber
                                : booking.seatNumber
                        }
                        seatLost={
                            finalBookingQuery.data != null &&
                            finalBookingQuery.data.seatNumber == null
                        }
                        mpesaReceiptNumber={
                            finalBookingQuery.data?.mpesaReceiptNumber ??
                            paymentResult?.mpesaReceiptNumber ??
                            null
                        }
                        isDownloading={downloadMutation.isPending}
                        onDownload={() => downloadMutation.mutate()}
                        onDone={() => onOpenChange(false)}
                    />
                ) : (
                    <>
                        <DialogHeader className="items-center pt-2 text-center">
                            <div
                                className={cn(
                                    "flex size-14 items-center justify-center rounded-full",
                                    settled
                                        ? "bg-destructive/10 text-destructive"
                                        : "bg-primary/10 text-primary"
                                )}
                            >
                                {settled ? (
                                    <XCircle className="size-7" />
                                ) : (
                                    <Smartphone className="size-7" />
                                )}
                            </div>
                            <DialogTitle className="text-lg">
                                {settled ? "Payment didn't go through" : "Waiting for M-Pesa"}
                            </DialogTitle>
                            <DialogDescription className="max-w-[19rem] text-balance">
                                {paymentFailed
                                    ? paymentResult?.errorMessage ??
                                    "The payment failed. Try a different payment method."
                                    : paymentTimedOut
                                        ? "The prompt wasn't completed in time. Ask the passenger to check their phone, or try a different payment method."
                                        : `Ask ${booking.passengerName || "the passenger"} to enter their M-Pesa PIN on ${booking.passengerPhone}.`}
                            </DialogDescription>
                        </DialogHeader>

                        {settled ? (
                            // Settled: the reconcile button lives inside the failure
                            // card, next to the reference the clerk would quote.
                            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                                <div className="flex gap-3">
                                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                                    <div className="min-w-0 space-y-1">
                                        <p className="text-xs font-semibold text-destructive">
                                            {paymentTimedOut
                                                ? "No confirmation from M-Pesa"
                                                : "Transaction declined"}
                                        </p>
                                        <p className="font-mono text-[11px] text-muted-foreground">
                                            REF: #{booking.id.slice(0, 6).toUpperCase()}
                                        </p>
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto gap-1.5 px-0"
                                            onClick={handleManualReconcile}
                                            disabled={reconcileMutation.isPending}
                                        >
                                            <RefreshCw
                                                className={cn(
                                                    "size-3.5",
                                                    reconcileMutation.isPending && "animate-spin"
                                                )}
                                            />
                                            {reconcileMutation.isPending
                                                ? "Checking M-Pesa..."
                                                : "Check M-Pesa now"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Ticket-shaped status card: countdown above the
                                    perforation, "still working" dots below it. */}
                                <div className="overflow-hidden rounded-xl border bg-muted/40">
                                    <div className="flex flex-col items-center gap-3 px-4 py-6">
                                        <p
                                            className={cn(
                                                "font-mono text-4xl font-bold tabular-nums tracking-[0.08em]",
                                                secondsRemaining <= 30
                                                    ? "text-amber-500"
                                                    : "text-primary"
                                            )}
                                        >
                                            {formatCountdown(secondsRemaining)}
                                        </p>
                                        <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 font-mono text-xs">
                                            <Wallet className="size-3.5 text-primary" />
                                            <span>KSh {Number(booking.fare).toLocaleString()}</span>
                                            {booking.seatNumber != null && (
                                                <>
                                                    <span className="text-border">•</span>
                                                    <Armchair className="size-3.5 text-primary" />
                                                    <span>Seat {booking.seatNumber}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center">
                                        <div className="-ml-2 size-4 rounded-full border bg-popover" />
                                        <div className="flex-1 border-t border-dashed" />
                                        <div className="-mr-2 size-4 rounded-full border bg-popover" />
                                    </div>

                                    <div className="flex justify-center gap-1.5 py-4">
                                        <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
                                        <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
                                        <span className="size-1.5 animate-bounce rounded-full bg-primary/70" />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <Button
                                        variant="outline"
                                        className="h-11 w-full gap-2"
                                        onClick={handleManualReconcile}
                                        disabled={reconcileMutation.isPending}
                                    >
                                        <RefreshCw
                                            className={cn(
                                                "size-4",
                                                reconcileMutation.isPending && "animate-spin"
                                            )}
                                        />
                                        {reconcileMutation.isPending
                                            ? "Checking M-Pesa..."
                                            : "Check M-Pesa now"}
                                    </Button>
                                    <p className="text-center text-[11px] text-muted-foreground/60">
                                        Checks our records for the confirmation. Safaricom is asked
                                        automatically at 2:30 and 3:00 if it hasn't arrived.
                                    </p>
                                </div>
                            </>
                        )}

                        <DialogFooter className="flex-col gap-2 sm:flex-col">
                            {settled ? (
                                <>
                                    <Button className="h-11 w-full" onClick={() => onRetry(booking)}>
                                        Try Again
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="h-11 w-full"
                                        onClick={() => onOpenChange(false)}
                                    >
                                        Close
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    variant="outline"
                                    className="h-11 w-full"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Close — booking stays pending
                                </Button>
                            )}
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

// ─── Receipt ────────────────────────────────────────────────────────────────

function PaymentReceipt({
    booking,
    route,
    travelDate,
    seatNumber,
    seatLost,
    mpesaReceiptNumber,
    isDownloading,
    onDownload,
    onDone,
}: {
    booking: Booking
    route?: { origin: string; destination: string; id: string }
    travelDate: string
    seatNumber: number | null
    /** Paid, but with no seat — a late payment landed after the seat was released. */
    seatLost: boolean
    mpesaReceiptNumber: string | null
    isDownloading: boolean
    onDownload: () => void
    onDone: () => void
}) {
    return (
        <>
            <DialogHeader className="items-center pt-2 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CheckCircle2 className="size-8" />
                </div>
                <DialogTitle className="text-lg">Payment received</DialogTitle>
                <DialogDescription className="max-w-[19rem] text-balance">
                    The seat is confirmed. Hand the passenger their receipt.
                </DialogDescription>
            </DialogHeader>

            <div className="overflow-hidden rounded-xl border">
                <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
                    <p className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
                        Ticket
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                        REF:{" "}
                        <span className="font-semibold text-foreground">
                            #{booking.id.slice(0, 6).toUpperCase()}
                        </span>
                    </p>
                </div>

                <div className="space-y-3 px-4 py-3">
                    {route && (
                        <div className="flex items-center gap-2">
                            <MapPin className="size-4 text-muted-foreground/50" />
                            <span className="text-sm font-medium">
                                {route.origin} → {route.destination}
                            </span>
                        </div>
                    )}

                    {/* A late M-Pesa confirmation can land after the seat was
                        already released to someone else. The money stands, but the
                        clerk has to know the passenger isn't seated yet. */}
                    {seatLost && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                Paid, but the seat was already taken
                            </p>
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-700/80 dark:text-amber-400/80">
                                This payment reached us after the booking had timed out. The
                                passenger is paid up and queued for the next vehicle on this
                                route — seat them manually or refund.
                            </p>
                        </div>
                    )}

                    <div className="h-px border-t border-dashed" />

                    <dl className="grid grid-cols-2 gap-x-2 gap-y-3 text-sm">
                        <div>
                            <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                Passenger
                            </dt>
                            <dd className="truncate font-medium">{booking.passengerName}</dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                Travel date
                            </dt>
                            <dd className="font-medium">{travelDate}</dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                Phone
                            </dt>
                            <dd className="font-mono text-[13px] font-medium">
                                {booking.passengerPhone}
                            </dd>
                        </div>
                        {seatNumber != null && (
                            <div>
                                <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    Seat
                                </dt>
                                <dd className="text-xl leading-tight font-bold text-primary">
                                    {seatNumber}
                                </dd>
                            </div>
                        )}
                        {mpesaReceiptNumber && (
                            <div className="col-span-2">
                                <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    M-Pesa Ref
                                </dt>
                                <dd className="mt-0.5 font-mono text-xs font-medium">
                                    {mpesaReceiptNumber}
                                </dd>
                            </div>
                        )}
                    </dl>
                </div>

                <div className="flex items-center">
                    <div className="-ml-2 size-4 rounded-full border bg-popover" />
                    <div className="flex-1 border-t border-dashed" />
                    <div className="-mr-2 size-4 rounded-full border bg-popover" />
                </div>

                <div className="flex flex-col items-center gap-1 bg-muted/40 px-4 py-4">
                    <p className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
                        Total paid
                    </p>
                    <p className="font-mono text-2xl font-bold tracking-[0.06em] text-primary">
                        KSh {Number(booking.fare).toLocaleString()}
                    </p>
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                        M-PESA
                    </Badge>
                </div>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button
                    variant="outline"
                    className="h-11 w-full gap-2"
                    onClick={onDownload}
                    disabled={isDownloading}
                >
                    {isDownloading ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <Download className="size-4" />
                    )}
                    {isDownloading ? "Preparing..." : "Download receipt"}
                </Button>
                <Button className="h-11 w-full" onClick={onDone}>
                    Done
                </Button>
            </DialogFooter>
        </>
    )
}
