// src/features/queue/BookingSheet.tsx
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    Users,
    Smartphone,
    Wallet,
    Phone,
    CheckCircle2,
    XCircle,
    Loader2,
    Clock,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetFooter,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import { type QueueEntry } from "@/api/routeApi"
import {
    PaymentMethod,
    type PaymentMethod as PaymentMethodType,
    type Booking,
    getBookingSeatMapRequest,
    SeatState,
} from "@/api/bookingApi"
import { SeatPicker } from "../booking/SeatPicker"
import {
    getMpesaTransactionsByPhoneRequest,
    MpesaTransactionMatchStatus,
    type MpesaTransaction,
} from "@/api/paymentApi"

// ─── Constants ──────────────────────────────────────────────────────────────

/** Shortest phone number we'll bother looking up C2B transactions for. */
const MIN_PHONE_DIGITS = 9

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BookingFormValues {
    bookingId?: string
    passengerName: string
    passengerPhone: string
    seats: number
    paymentMethod: PaymentMethodType
    seatNumbers: number[]
    // Set when the clerk matched an already-paid C2B transaction instead of
    // triggering a fresh STK prompt. Only ever set when seats === 1.
    mpesaTransactionId?: string
}

export interface BookingSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    side: "bottom" | "right"
    entry: QueueEntry
    fare?: number
    isSubmitting?: boolean
    onSubmit: (payload: BookingFormValues) => Promise<Booking[]>
    route?: { origin: string; destination: string; id: string }
    travelDate: string
    /**
     * Set when reopening the sheet to retry a payment that failed. Reuses the
     * existing booking row and seat instead of creating a second claim.
     */
    retryBooking?: Booking | null
}

type MpesaMode = "prompt" | "manual"

// ─── Pure helpers ───────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "")
}

/** Manual match is one seat only, so that mode collapses to a single pick. */
function nextSeatSelection(prev: number[], seat: number, singleSelect: boolean): number[] {
    if (singleSelect) return prev.includes(seat) ? [] : [seat]
    return prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat]
}

function isPromptFlow(paymentMethod: PaymentMethodType, mpesaMode: MpesaMode): boolean {
    return paymentMethod === PaymentMethod.MPESA && mpesaMode === "prompt"
}

function isManualMatchFlow(paymentMethod: PaymentMethodType, mpesaMode: MpesaMode): boolean {
    return paymentMethod === PaymentMethod.MPESA && mpesaMode === "manual"
}

function getSubmitIcon(isFull: boolean, isSoldOut: boolean, promptFlow: boolean) {
    if (isSoldOut) return <XCircle className="size-4" />
    if (isFull) return <Clock className="size-4" />
    if (promptFlow) return <Smartphone className="size-4" />
    return <CheckCircle2 className="size-4" />
}

function getSubmitLabel(
    isFull: boolean,
    isSoldOut: boolean,
    promptFlow: boolean,
    manualMatch: boolean,
): string {
    if (isSoldOut) return "Vehicle Full"
    // Nothing bookable, but only for as long as the holds last — say so
    // rather than sending the clerk off to find another vehicle.
    if (isFull) return "Waiting on Payments"
    if (promptFlow) return "Send Payment Prompt"
    if (manualMatch) return "Confirm & Match Payment"
    return "Confirm Booking"
}

// ─── Booking Sheet ──────────────────────────────────────────────────────────

export function BookingSheet({ open, onOpenChange, side, entry, fare, isSubmitting, onSubmit, route, travelDate, retryBooking }: BookingSheetProps) {
    const capacity = entry.vehicle.seatingCapacity
    const unitFare = fare ?? 0

    const [name, setName] = useState("")
    const [phone, setPhone] = useState("")
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>(PaymentMethod.MPESA)
    const [selectedSeats, setSelectedSeats] = useState<number[]>([])

    const [mpesaMode, setMpesaMode] = useState<MpesaMode>("prompt")
    const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)

    const queryClient = useQueryClient()

    const seatMapKey = ["seat-map", route?.id, travelDate]

    // Closing the sheet is the moment other clerks' bookings are most likely
    // to have landed, and it's when this clerk's own pending booking has just
    // claimed a seat — so drop the cached map rather than reopening onto a
    // stale one.
    useEffect(() => {
        if (!open && route?.id) {
            queryClient.invalidateQueries({ queryKey: seatMapKey })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, route?.id, travelDate])

    const seatMapQuery = useQuery({
        queryKey: seatMapKey,
        queryFn: () => getBookingSeatMapRequest(route!.id, travelDate),
        enabled: open && !!route?.id,
        // Overrides the app-wide 5-minute staleTime: seats get taken by other
        // clerks constantly, so this is one of the few queries that must be
        // re-read from the backend every single time the sheet opens.
        staleTime: 0,
        refetchOnMount: "always",
    })

    // A seat is occupied for one of two reasons and they don't mean the same
    // thing to a clerk, so the sheet can't go on deriving capacity from a
    // single seated count. The seat map is the authority once it lands — it
    // describes this vehicle's trip seat by seat — with the queue entry's
    // counts standing in only for the moment before it does.
    const mapSeats = seatMapQuery.data?.seats
    const heldSeats = mapSeats
        ? mapSeats.filter((s) => s.state === SeatState.HELD).length
        : entry.heldCount ?? 0
    const soldSeats = mapSeats
        ? mapSeats.length - heldSeats
        : entry.seatedCount ?? 0

    // Held seats block a booking exactly like sold ones, so nothing can be
    // handed out while they stand...
    const remaining = Math.max(0, capacity - soldSeats - heldSeats)
    const isFull = remaining === 0
    // ...but only sold seats make the vehicle genuinely full. When the last
    // free seats are merely held, the right move is to wait out the
    // countdowns on the grid, not to turn the passenger away — so the two
    // states are never rendered the same way.
    const isSoldOut = soldSeats >= capacity

    // A hold frees its seat the moment it lapses, but only the backend knows
    // that — left alone the grid would sit showing a blocked seat with a
    // spent timer until the clerk closed and reopened the sheet. Re-read it
    // as the soonest hold runs out, so a seat the passenger failed to pay for
    // becomes sellable again while the clerk is still standing there.
    useEffect(() => {
        const nextExpiry = (seatMapQuery.data?.seats ?? [])
            .filter((seat) => seat.state === SeatState.HELD && seat.holdExpiresAt)
            .map((seat) => new Date(seat.holdExpiresAt!).getTime())
            .filter((expiry) => expiry > Date.now())
            .sort((a, b) => a - b)[0]

        if (nextExpiry === undefined) return

        // A second of slack so the backend has definitely dropped the hold by
        // the time we ask about it.
        const timer = setTimeout(
            () => queryClient.invalidateQueries({ queryKey: seatMapKey }),
            nextExpiry - Date.now() + 1_000,
        )
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seatMapQuery.data])

    const normalizedPhone = normalizePhone(phone)
    const manualMatch = isManualMatchFlow(paymentMethod, mpesaMode)
    const promptFlow = isPromptFlow(paymentMethod, mpesaMode)

    const transactionsQuery = useQuery({
        queryKey: ["mpesa-transactions", normalizedPhone],
        queryFn: () => getMpesaTransactionsByPhoneRequest({ phone: normalizedPhone }),
        enabled: open && manualMatch && normalizedPhone.length >= MIN_PHONE_DIGITS,
    })

    const unmatchedTransactions = (transactionsQuery.data ?? []).filter(
        (t) => t.matchStatus === MpesaTransactionMatchStatus.UNMATCHED
    )

    useEffect(() => {
        if (open) {
            // Retrying a failed payment reuses the same booking row and seat,
            // so the form comes back pre-filled rather than making the clerk
            // re-key a passenger who is standing right in front of them.
            setName(retryBooking?.passengerName ?? "")
            setPhone(retryBooking?.passengerPhone ?? "")
            setPaymentMethod(PaymentMethod.MPESA)
            setSelectedSeats(retryBooking?.seatNumber ? [retryBooking.seatNumber] : [])
            setMpesaMode("prompt")
            setSelectedTransactionId(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, retryBooking?.id])

    useEffect(() => {
        setSelectedTransactionId(null)
    }, [normalizedPhone, mpesaMode])

    // Manual match = exactly 1 seat. Trim automatically so the clerk never
    // hits a validation wall after selecting seats.
    useEffect(() => {
        if (mpesaMode === "manual" && selectedSeats.length > 1) {
            setSelectedSeats([selectedSeats[0]])
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mpesaMode])

    const seats = selectedSeats.length
    const total = unitFare * seats

    const manualMatchValid = !manualMatch || (seats === 1 && !!selectedTransactionId)
    const canSubmit =
        seats > 0 && phone.trim().length > 0 && !isSubmitting && !isFull && manualMatchValid

    const handleSubmit = async () => {
        if (!canSubmit) return
        try {
            await onSubmit({
                bookingId: retryBooking?.id,
                passengerName: name.trim(),
                passengerPhone: phone.trim(),
                seats,
                paymentMethod,
                seatNumbers: selectedSeats,
                mpesaTransactionId: manualMatch ? selectedTransactionId! : undefined,
            })
            // The parent closes this sheet and — for the STK prompt flow —
            // opens the M-Pesa dialog over the grid. Nothing to do here.
        } catch {
            // parent's onError already toasts; nothing more to do here.
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side={side}
                className={cn(
                    side === "bottom" && "rounded-t-xl max-h-[85vh]",
                    "flex flex-col p-0 gap-0"
                )}
            >
                {/* ── Header ───────────────────────────────────────────── */}
                <SheetHeader className="px-6 py-4 border-b space-y-0 shrink-0">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="text-base font-bold">Book Passenger</SheetTitle>
                    </div>
                </SheetHeader>

                {/* ── Form ─────────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    <RouteContextCard route={route} numberPlate={entry.vehicle.numberPlate} />

                    {/* Phone / Name */}
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <Label htmlFor="passenger-phone" className="text-sm font-semibold">
                                    Phone number <span className="text-destructive">*</span>
                                </Label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                                    <Input
                                        id="passenger-phone"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        placeholder="07XX XXX XXX"
                                        inputMode="tel"
                                        required
                                        disabled={isSoldOut}
                                        className="pl-9"
                                    />
                                </div>
                                {phone && phone.length < 10 && (
                                    <p className="text-xs text-destructive/70">Please enter a valid phone number</p>
                                )}
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="passenger-name" className="text-sm font-semibold">
                                    Passenger name
                                </Label>
                                <div className="relative">
                                    <Users className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/50" />
                                    <Input
                                        id="passenger-name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Optional"
                                        disabled={isSoldOut}
                                        className="pl-9"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Seat map */}
                        {!isSoldOut && (
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm font-semibold">
                                        Select Seats <span className="text-destructive">*</span>
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px] font-medium text-primary border-primary/30 bg-primary/5">
                                            {capacity}-Seater
                                        </Badge>
                                        {heldSeats > 0 && (
                                            <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                                {heldSeats} paying
                                            </span>
                                        )}
                                        {manualMatch && (
                                            <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded">
                                                1 seat only
                                            </span>
                                        )}
                                        {selectedSeats.length > 0 && !manualMatch && (
                                            <button
                                                type="button"
                                                className="text-xs text-muted-foreground hover:text-foreground"
                                                onClick={() => setSelectedSeats([])}
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {seatMapQuery.isLoading ? (
                                    <Skeleton className="h-32 w-full rounded-xl" />
                                ) : (
                                    <SeatPicker
                                        seatsTotal={seatMapQuery.data?.seatsTotal ?? capacity}
                                        takenSeatNumbers={seatMapQuery.data?.takenSeatNumbers ?? []}
                                        seats={seatMapQuery.data?.seats}
                                        selectedSeats={selectedSeats}
                                        onToggle={(seat) =>
                                            setSelectedSeats((prev) => nextSeatSelection(prev, seat, manualMatch))
                                        }
                                    />
                                )}
                            </div>
                        )}

                        {/* Fare summary */}
                        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                            <span className="text-xs text-muted-foreground/70">
                                {seats} seat{seats === 1 ? "" : "s"} selected (KSh {unitFare.toLocaleString()} each)
                            </span>
                            <span className="text-lg font-bold text-primary">
                                KSh {total.toLocaleString()}
                            </span>
                        </div>

                        {/* Payment — 3 flat pills. No nested toggles, no dialog. */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">Payment method</Label>
                            <PaymentMethodPills
                                paymentMethod={paymentMethod}
                                mpesaMode={mpesaMode}
                                disabled={isSoldOut}
                                onSelect={(method, mode) => {
                                    setPaymentMethod(method)
                                    setMpesaMode(mode)
                                }}
                            />

                            {/* Inline manual match — replaces the old Dialog */}
                            {mpesaMode === "manual" && (
                                <ManualMatchPicker
                                    phoneDigits={normalizedPhone.length}
                                    isLoading={transactionsQuery.isLoading}
                                    transactions={unmatchedTransactions}
                                    selectedTransactionId={selectedTransactionId}
                                    onSelect={(id) =>
                                        setSelectedTransactionId((prev) => (prev === id ? null : id))
                                    }
                                />
                            )}
                        </div>

                        {isSoldOut ? (
                            <div className="flex items-center gap-2 rounded-lg border-2 border-red-500/20 bg-red-500/5 px-4 py-3 text-red-600 dark:text-red-400 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <XCircle className="size-5 shrink-0" />
                                <span className="text-sm">This vehicle is at full capacity. No more seats available.</span>
                            </div>
                        ) : isFull ? (
                            <div className="flex items-center gap-2 rounded-lg border-2 border-amber-500/20 bg-amber-500/5 px-4 py-3 text-amber-700 dark:text-amber-400 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <Clock className="size-5 shrink-0" />
                                <span className="text-sm">
                                    {remaining === 0 && heldSeats === 1
                                        ? "The last free seat is mid-payment. It frees up when the timer on the grid runs out."
                                        : "Every free seat is mid-payment. They free up as the timers on the grid run out."}
                                </span>
                            </div>
                        ) : null}
                </div>

                {/* ── Sticky Footer ────────────────────────────────────── */}
                <SheetFooter className="px-6 py-4 border-t shrink-0">
                    <Button className="w-full h-11 gap-2" onClick={handleSubmit} disabled={!canSubmit}>
                        {isSubmitting ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                Booking...
                            </>
                        ) : (
                            <>
                                {getSubmitIcon(isFull, isSoldOut, promptFlow)}
                                {getSubmitLabel(isFull, isSoldOut, promptFlow, manualMatch)}
                            </>
                        )}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}

// ─── Presentational pieces ──────────────────────────────────────────────────

function RouteContextCard({
    route,
    numberPlate,
}: {
    route?: { origin: string; destination: string; id: string }
    numberPlate: string
}) {
    return (
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 flex items-center justify-between">
            <div>
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-0.5">
                    Route
                </p>
                <p className="text-sm font-semibold">
                    {route ? `${route.origin} to ${route.destination}` : "—"}
                </p>
            </div>
            <div className="text-right">
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-0.5">
                    Vehicle
                </p>
                <p className="text-sm font-mono font-bold text-primary">{numberPlate}</p>
            </div>
        </div>
    )
}

function PaymentMethodPills({
    paymentMethod,
    mpesaMode,
    disabled,
    onSelect,
}: {
    paymentMethod: PaymentMethodType
    mpesaMode: MpesaMode
    disabled: boolean
    onSelect: (method: PaymentMethodType, mode: MpesaMode) => void
}) {
    return (
        <div className="flex gap-1.5 rounded-lg bg-muted p-1">
            {/* Cash — inverted (white/light bg, green text) */}
            <button
                type="button"
                onClick={() => onSelect(PaymentMethod.CASH, "prompt")}
                disabled={disabled}
                className={cn(
                    "flex-1 rounded-md py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50",
                    paymentMethod === PaymentMethod.CASH
                        ? "bg-background text-emerald-600 shadow-sm ring-1 ring-emerald-600/50"
                        : "text-muted-foreground hover:bg-background/50"
                )}
            >
                <Wallet className="size-3.5" />
                Cash
            </button>

            {/* M-Pesa STK — branded green */}
            <button
                type="button"
                onClick={() => onSelect(PaymentMethod.MPESA, "prompt")}
                disabled={disabled}
                className={cn(
                    "flex-1 rounded-md py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50",
                    paymentMethod === PaymentMethod.MPESA && mpesaMode === "prompt"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                )}
            >
                <Smartphone className="size-3.5" />
                M-Pesa
            </button>

            {/* Paybill / Already Paid — branded green, slightly smaller label */}
            <button
                type="button"
                onClick={() => onSelect(PaymentMethod.MPESA, "manual")}
                disabled={disabled}
                className={cn(
                    "flex-1 rounded-md py-2 text-xs font-semibold flex items-center justify-center transition-all disabled:opacity-50",
                    paymentMethod === PaymentMethod.MPESA && mpesaMode === "manual"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                )}
            >
                Paybill/Till
            </button>
        </div>
    )
}

function ManualMatchPicker({
    phoneDigits,
    isLoading,
    transactions,
    selectedTransactionId,
    onSelect,
}: {
    phoneDigits: number
    isLoading: boolean
    transactions: MpesaTransaction[]
    selectedTransactionId: string | null
    onSelect: (id: string) => void
}) {
    return (
        <div className="space-y-2 pt-1">
            {phoneDigits < MIN_PHONE_DIGITS ? (
                <p className="text-xs text-muted-foreground/60 px-1">
                    Enter the passenger's phone number to find their payment.
                </p>
            ) : isLoading ? (
                <div className="space-y-1.5">
                    <Skeleton className="h-10 w-full rounded-md" />
                    <Skeleton className="h-10 w-full rounded-md" />
                </div>
            ) : transactions.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 px-1">
                    No unmatched M-Pesa payments found for this number.
                </p>
            ) : (
                <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground/70 px-1">
                        Tap a payment to match
                    </p>
                    <div className="space-y-1.5">
                        {transactions.map((t) => (
                            <MpesaTransactionOption
                                key={t.id}
                                transaction={t}
                                selected={selectedTransactionId === t.id}
                                onSelect={() => onSelect(t.id)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// ── small presentational helper for one transaction row ──────────────────
function MpesaTransactionOption({
    transaction,
    selected,
    onSelect,
}: {
    transaction: MpesaTransaction
    selected: boolean
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                "w-full flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors",
                selected
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-background hover:border-muted-foreground/20"
            )}
        >
            <div className="min-w-0">
                <p className="text-sm font-semibold">KSh {Number(transaction.amount).toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground/60 truncate">
                    {transaction.mpesaReceiptNumber} · {new Date(transaction.transactionTime).toLocaleString()}
                </p>
            </div>
            {selected && <CheckCircle2 className="size-4 text-primary shrink-0" />}
        </button>
    )
}
