// src/features/queue/MpesaPaymentDialog.tsx
import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    CheckCircle2,
    XCircle,
    RefreshCw,
    Smartphone,
    Download,
    MapPin,
    Loader2,
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
/** Fire one automatic reconcile just before the poll window closes. */
const AUTO_RECONCILE_AFTER_MS = 175_000

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

/** Tells the clerk what a manual reconcile actually turned up. */
function toastReconcileResult(result: PaymentStatusForBooking) {
    if (result.status === "SUCCESS") return // the receipt view says it better
    if (result.status === "FAILED" || result.status === "EXPIRED") {
        toast.error(result.errorMessage ?? "M-Pesa reports this payment failed.")
        return
    }
    toast.info("M-Pesa hasn't confirmed this payment yet — check again in a moment.")
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
    // One automatic reconcile per attempt — manual presses don't consume it.
    const autoReconciledRef = useRef(false)

    useEffect(() => {
        if (open) {
            setStartedAt(Date.now())
            autoReconciledRef.current = false
        } else {
            setStartedAt(null)
        }
    }, [open, booking.id])

    // Re-renders every second so the countdown and the time-based flags below
    // stay live even though startedAt itself never changes.
    const [tick, setTick] = useState(0)
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

    // Safaricom's callback isn't reliable, so we ask Daraja directly. Runs
    // automatically just before we'd give up, and on demand from the button.
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
            toast.error("Couldn't reach M-Pesa. Try again in a moment.")
        }
    }

    useEffect(() => {
        if (
            open &&
            hasElapsed(startedAt, AUTO_RECONCILE_AFTER_MS) &&
            !paymentSucceeded &&
            !paymentFailed &&
            !reconcileMutation.isPending &&
            !autoReconciledRef.current
        ) {
            autoReconciledRef.current = true
            reconcileMutation.mutate()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, startedAt, paymentSucceeded, paymentFailed, tick])

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
                        seatNumber={finalBookingQuery.data?.seatNumber ?? booking.seatNumber}
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
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                {settled ? (
                                    <XCircle className="size-5 text-red-500" />
                                ) : (
                                    <Smartphone className="size-5 text-emerald-600" />
                                )}
                                {settled ? "Payment didn't go through" : "Waiting for M-Pesa"}
                            </DialogTitle>
                            <DialogDescription>
                                {paymentFailed
                                    ? paymentResult?.errorMessage ??
                                    "The payment failed. Try a different payment method."
                                    : paymentTimedOut
                                        ? "The prompt wasn't completed in time. Ask the passenger to check their phone, or try a different payment method."
                                        : `Ask ${booking.passengerName || "the passenger"} to enter their M-Pesa PIN on ${booking.passengerPhone}.`}
                            </DialogDescription>
                        </DialogHeader>

                        {!settled && (
                            <div className="flex flex-col items-center gap-1 py-2">
                                <p
                                    className={cn(
                                        "text-4xl font-bold font-mono tabular-nums",
                                        secondsRemaining <= 30 ? "text-amber-500" : "text-primary"
                                    )}
                                >
                                    {formatCountdown(secondsRemaining)}
                                </p>
                                <p className="text-[11px] text-muted-foreground/60">
                                    KSh {Number(booking.fare).toLocaleString()}
                                    {booking.seatNumber ? ` · Seat ${booking.seatNumber}` : ""}
                                </p>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Button
                                variant="outline"
                                className="w-full gap-2"
                                onClick={handleManualReconcile}
                                disabled={reconcileMutation.isPending}
                            >
                                <RefreshCw
                                    className={cn("size-4", reconcileMutation.isPending && "animate-spin")}
                                />
                                {reconcileMutation.isPending ? "Checking M-Pesa..." : "Check M-Pesa now"}
                            </Button>
                            <p className="text-[11px] text-center text-muted-foreground/60">
                                Asks Safaricom directly if the money came through, in case the
                                confirmation never reached us.
                            </p>
                        </div>

                        <DialogFooter>
                            {settled ? (
                                <Button className="w-full h-11" onClick={() => onRetry(booking)}>
                                    Try Again
                                </Button>
                            ) : (
                                <Button
                                    variant="outline"
                                    className="w-full h-11"
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
    mpesaReceiptNumber,
    isDownloading,
    onDownload,
    onDone,
}: {
    booking: Booking
    route?: { origin: string; destination: string; id: string }
    travelDate: string
    seatNumber: number | null
    mpesaReceiptNumber: string | null
    isDownloading: boolean
    onDownload: () => void
    onDone: () => void
}) {
    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <CheckCircle2 className="size-5 text-emerald-500" />
                    Payment received
                </DialogTitle>
                <DialogDescription>
                    The seat is confirmed. Hand the passenger their receipt.
                </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border overflow-hidden">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-100 dark:border-emerald-900/50 px-4 py-3">
                    <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                        Receipt
                    </p>
                    <p className="text-[11px] font-mono text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                        REF: #{booking.id.slice(0, 6).toUpperCase()}
                    </p>
                </div>

                <div className="px-4 py-3 space-y-3">
                    {route && (
                        <div className="flex items-center gap-2">
                            <MapPin className="size-4 text-muted-foreground/50" />
                            <span className="text-sm font-medium">
                                {route.origin} → {route.destination}
                            </span>
                        </div>
                    )}

                    <div className="h-px border-t border-dashed" />

                    <dl className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
                        <div>
                            <dt className="text-xs text-muted-foreground">Passenger</dt>
                            <dd className="font-medium">{booking.passengerName}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">Travel date</dt>
                            <dd className="font-medium">{travelDate}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">Phone</dt>
                            <dd className="font-medium">{booking.passengerPhone}</dd>
                        </div>
                        {seatNumber != null && (
                            <div>
                                <dt className="text-xs text-muted-foreground">Seat number</dt>
                                <dd className="font-medium">{seatNumber}</dd>
                            </div>
                        )}
                        {mpesaReceiptNumber && (
                            <div className="col-span-2">
                                <dt className="text-xs text-muted-foreground">M-Pesa Ref</dt>
                                <dd className="font-mono text-xs font-medium mt-0.5">
                                    {mpesaReceiptNumber}
                                </dd>
                            </div>
                        )}
                    </dl>

                    <div className="h-px border-t border-dashed" />

                    <div className="flex items-center justify-between pt-0.5">
                        <div>
                            <p className="text-sm font-semibold">Total paid</p>
                            <Badge variant="secondary" className="mt-0.5 text-[10px]">
                                M-PESA
                            </Badge>
                        </div>
                        <span className="text-lg font-bold">
                            KSh {Number(booking.fare).toLocaleString()}
                        </span>
                    </div>
                </div>
            </div>

            <DialogFooter className="gap-2 sm:flex-col">
                <Button
                    variant="outline"
                    className="w-full gap-2"
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
                <Button className="w-full h-11" onClick={onDone}>
                    Done
                </Button>
            </DialogFooter>
        </>
    )
}
