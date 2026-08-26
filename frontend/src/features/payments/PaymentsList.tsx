// src/features/payments/PaymentsList.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    getSaccoPaymentsRequest,
    type Payment,
    type PaymentStatus,
    type PaymentMethod,
} from "@/api/paymentApi";
import { useSaccoName } from "@/hooks/useSaccoName";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Smartphone, Banknote, AlertCircle, Building2, ChevronDown, SlidersHorizontal } from "lucide-react";
import { getBookingRequest, type Booking } from "@/api/bookingApi";
import { MapPin, User, Calendar } from "lucide-react";
import { PaymentsCharts } from "./PaymentsCharts";
import { cn } from "@/lib/utils";

function todayString(): string {
    return new Date().toISOString().slice(0, 10);
}

function daysAgoString(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

function PaymentDetailDialog({
    payment,
    open,
    onOpenChange,
}: {
    payment: Payment | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const saccoName = useSaccoName(payment?.saccoId);

    const bookingQuery = useQuery({
        queryKey: ["booking-for-payment", payment?.referenceId],
        queryFn: () => getBookingRequest(payment!.referenceId),
        enabled: !!payment && payment.referenceType === "BOOKING",
    });

    if (!payment) return null;

    const booking = bookingQuery.data;
    const reason = failureReason(payment);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        KES {Number(payment.amount).toLocaleString()}
                        {statusBadge(payment.status)}
                    </DialogTitle>
                    <DialogDescription>
                        {saccoName ?? "Loading sacco…"} · #{payment.referenceId.slice(0, 6).toUpperCase()}
                    </DialogDescription>
                </DialogHeader>

                {/* ── Route + passenger context ── */}
                {bookingQuery.isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                ) : booking ? (
                    <div className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-1.5">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {booking.route?.origin ?? "—"} → {booking.route?.destination ?? "—"}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <User className="h-3.5 w-3.5 shrink-0" />
                            {booking.passengerName} · {booking.passengerPhone}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5 shrink-0" />
                            {booking.travelDate}
                            {booking.seatNumber && ` · Seat ${booking.seatNumber}`}
                        </div>
                        <div className="pt-1">
                            <Badge variant="outline" className="text-[11px]">
                                Booking: {booking.status}
                            </Badge>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">Couldn't load booking details.</p>
                )}

                {reason && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-destructive">Payment failed</p>
                            <p className="text-xs text-destructive/80 mt-0.5">{reason}</p>
                            {payment.resultCode && (
                                <p className="text-[11px] text-destructive/60 mt-1 font-mono">
                                    Daraja code: {payment.resultCode}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground">Payer phone</span>
                        <span className="font-medium">{payment.payerPhone ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground">Method</span>
                        <span className="font-medium">{payment.method === "MPESA" ? "M-Pesa" : "Cash"}</span>
                    </div>
                    {payment.mpesaReceiptNumber && (
                        <div className="flex items-center justify-between border-b pb-2">
                            <span className="text-muted-foreground">Receipt no.</span>
                            <span className="font-medium font-mono">{payment.mpesaReceiptNumber}</span>
                        </div>
                    )}
                    {payment.checkoutRequestId && (
                        <div className="flex items-center justify-between border-b pb-2">
                            <span className="text-muted-foreground">Checkout ID</span>
                            <span className="font-medium font-mono text-xs truncate max-w-[220px]">
                                {payment.checkoutRequestId}
                            </span>
                        </div>
                    )}
                    <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-muted-foreground">Initiated</span>
                        <span className="font-medium">{formatDateTime(payment.initiatedAt)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Completed</span>
                        <span className="font-medium">{formatDateTime(payment.completedAt)}</span>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function statusBadge(status: PaymentStatus) {
    switch (status) {
        case "SUCCESS":
            return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Success</Badge>;
        case "PROCESSING":
            return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Processing</Badge>;
        case "PENDING":
            return <Badge variant="secondary">Pending</Badge>;
        case "FAILED":
            return <Badge variant="destructive">Failed</Badge>;
        case "EXPIRED":
            return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Expired</Badge>;
        default:
            return <Badge variant="outline">{status}</Badge>;
    }
}

function formatDateTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-KE", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function failureReason(payment: Payment): string | null {
    if (payment.status !== "FAILED") return null;
    return payment.resultDesc ?? payment.initiationErrorMessage ?? "Payment failed for an unknown reason.";
}

// ─── Individual card — owns its own sacco-name lookup ──────────────────
function PaymentCard({ payment, onSelect }: { payment: Payment; onSelect: (p: Payment) => void }) {
    const saccoName = useSaccoName(payment.saccoId);

    const bookingQuery = useQuery({
        queryKey: ["booking-for-payment", payment.referenceId],
        queryFn: () => getBookingRequest(payment.referenceId),
        enabled: payment.referenceType === "BOOKING",
        staleTime: 60 * 1000,
    });
    const booking = bookingQuery.data;

    const reason = failureReason(payment);

    return (
        <button
            onClick={() => onSelect(payment)}
            className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-all hover:border-primary hover:bg-primary/5 active:scale-[0.98]"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    {payment.method === "MPESA" ? (
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                    ) : (
                        <Banknote className="h-4 w-4 text-muted-foreground" />
                    )}
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">
                            KES {Number(payment.amount).toLocaleString()}
                        </p>
                        {statusBadge(payment.status)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {booking
                            ? `${booking.route?.origin ?? "?"} → ${booking.route?.destination ?? "?"} · ${booking.passengerName}`
                            : saccoName ?? "Loading…"}
                    </p>
                    {reason && (
                        <p className="text-xs text-destructive mt-0.5 flex items-center gap-1 truncate">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            {reason}
                        </p>
                    )}
                </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs shrink-0 ml-2">
                #{payment.referenceId.slice(0, 6).toUpperCase()}
            </Badge>
        </button>
    );
}



// ─── Main list ───────────────────────────────────────────────────────────
export default function PaymentsList() {
    const [from, setFrom] = useState(daysAgoString(7));
    const [to, setTo] = useState(todayString());
    const [status, setStatus] = useState<PaymentStatus | "ALL">("ALL");
    const [method, setMethod] = useState<PaymentMethod | "ALL">("ALL");
    const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
    const [showFilters, setShowFilters] = useState(false);

    const paymentsQuery = useQuery({
        queryKey: ["sacco-payments", from, to, status, method],
        queryFn: () =>
            getSaccoPaymentsRequest({
                from,
                to,
                status: status === "ALL" ? undefined : status,
                method: method === "ALL" ? undefined : method,
            }),
        staleTime: 15 * 1000,
    });

    const payments = paymentsQuery.data ?? [];

    const totalSuccess = payments
        .filter((p) => p.status === "SUCCESS")
        .reduce((sum, p) => sum + Number(p.amount), 0);

    // Drives the mobile filter-toggle badge — date range excluded since it
    // always has a value and isn't really an "active filter" in this sense.
    const activeFilterCount = [
        status !== "ALL" ? status : null,
        method !== "ALL" ? method : null,
    ].filter(Boolean).length;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-semibold">Payments</h2>

                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
                    <div className="hidden sm:flex rounded-md bg-emerald-500/10 p-1.5 shrink-0">
                        <Banknote className="size-3.5 text-emerald-500" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide truncate">
                            Collected
                        </p>
                        <p className="text-base font-bold leading-none mt-0.5">
                            KES {totalSuccess.toLocaleString()}
                        </p>
                    </div>
                </div>
            </div>

            {/* Mobile filter toggle — filters grid is always visible on sm+ */}
            <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="sm:hidden flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
                <SlidersHorizontal className="size-3.5" />
                Filters
                {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        {activeFilterCount}
                    </Badge>
                )}
                <ChevronDown className={cn("size-3.5 transition-transform", showFilters && "rotate-180")} />
            </button>

            <div
                className={cn(
                    "grid grid-cols-2 sm:grid-cols-4 gap-2 sm:grid",
                    !showFilters && "hidden sm:grid"
                )}
            >
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input
                        type="date"
                        value={from}
                        max={to}
                        onChange={(e) => setFrom(e.target.value)}
                        className="h-9"
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                        type="date"
                        value={to}
                        min={from}
                        max={todayString()}
                        onChange={(e) => setTo(e.target.value)}
                        className="h-9"
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={status} onValueChange={(v) => setStatus(v as PaymentStatus | "ALL")}>
                        <SelectTrigger className="h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All statuses</SelectItem>
                            <SelectItem value="SUCCESS">Success</SelectItem>
                            <SelectItem value="PROCESSING">Processing</SelectItem>
                            <SelectItem value="PENDING">Pending</SelectItem>
                            <SelectItem value="FAILED">Failed</SelectItem>
                            <SelectItem value="EXPIRED">Expired</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Method</Label>
                    <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod | "ALL")}>
                        <SelectTrigger className="h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All methods</SelectItem>
                            <SelectItem value="MPESA">M-Pesa</SelectItem>
                            <SelectItem value="CASH">Cash</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {paymentsQuery.isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : paymentsQuery.isError ? (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                    <p className="text-sm text-destructive">Couldn't load payments. Please try again.</p>
                </div>
            ) : payments.length === 0 ? (
                <div className="bg-muted/30 rounded-lg px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground">No payments in this range.</p>
                </div>
            ) : (
                <>
                    <PaymentsCharts payments={payments} />
                    <div className="space-y-2">
                        {payments.map((payment) => (
                            <PaymentCard key={payment.id} payment={payment} onSelect={setSelectedPayment} />
                        ))}
                    </div>
                </>
            )}

            <PaymentDetailDialog
                payment={selectedPayment}
                open={!!selectedPayment}
                onOpenChange={(open) => !open && setSelectedPayment(null)}
            />
        </div>
    );
}