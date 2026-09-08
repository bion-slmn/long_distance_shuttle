// src/features/payments/PaymentsList.tsx
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
    getSaccoPaymentsRequest,
    type Payment,
    type PaymentStatus,
    type PaymentMethod,
} from "@/api/paymentApi";
import { getBookingRequest, type Booking } from "@/api/bookingApi";
import { useAuth } from "@/features/auth/AuthContext";
import { useSaccoNames } from "@/hooks/useSaccoNames";
import { SaccoCombobox } from "@/features/sacco/SaccoCombobox";
import { PaymentsCharts } from "./PaymentsCharts";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
    Smartphone,
    Banknote,
    AlertCircle,
    MapPin,
    User,
    Calendar,
    ChevronRight,
    CreditCard,
} from "lucide-react";
import { StatTile } from "@/components/report/StatTile";
import {
    DateRangeFields,
    FilterField,
    FilterPanel,
    RangePresets,
    SearchInput,
} from "@/components/report/Filters";
import { ListPlaceholder } from "@/components/report/ListPlaceholder";
import { Callout, DetailRow, DetailRows, InfoBlock, InfoLine } from "@/components/report/Detail";
import { formatDateTime, formatDay, formatTime, toLocalDateString, todayString } from "@/lib/dateRange";
import { cn } from "@/lib/utils";

// ─── Presentation helpers ────────────────────────────────────────────────

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

function failureReason(payment: Payment): string | null {
    if (payment.status !== "FAILED") return null;
    return payment.resultDesc ?? payment.initiationErrorMessage ?? "Payment failed for an unknown reason.";
}

// A payment that ended without money changing hands. These are the rows a
// clerk has to act on (re-send the push, take cash) so they get the same
// amber treatment a lapsed booking gets on the bookings list.
function needsAttention(payment: Payment): boolean {
    return payment.status === "FAILED" || payment.status === "EXPIRED";
}

function shortRef(payment: Payment): string {
    return payment.referenceId.slice(0, 6).toUpperCase();
}

function methodLabel(method: PaymentMethod): string {
    return method === "MPESA" ? "M-Pesa" : "Cash";
}

// ─── Detail dialog ───────────────────────────────────────────────────────

function PaymentDetailDialog({
    payment,
    booking,
    bookingLoading,
    saccoName,
    open,
    onOpenChange,
}: {
    payment: Payment | null;
    booking: Booking | undefined;
    bookingLoading: boolean;
    saccoName: string | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    if (!payment) return null;

    const reason = failureReason(payment);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 flex-wrap">
                        KES {Number(payment.amount).toLocaleString()}
                        {statusBadge(payment.status)}
                    </DialogTitle>
                    <DialogDescription>
                        {saccoName ? `${saccoName} · ` : ""}#{shortRef(payment)}
                    </DialogDescription>
                </DialogHeader>

                {/* ── Route + passenger context ── */}
                {bookingLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                ) : booking ? (
                    <InfoBlock>
                        <InfoLine icon={MapPin} primary>
                            {booking.route?.origin ?? "—"} → {booking.route?.destination ?? "—"}
                        </InfoLine>
                        <InfoLine icon={User}>
                            {booking.passengerName} · {booking.passengerPhone}
                        </InfoLine>
                        <InfoLine icon={Calendar}>
                            {formatDay(booking.travelDate)}
                            {booking.seatNumber && ` · Seat ${booking.seatNumber}`}
                        </InfoLine>
                        <div className="pt-1">
                            <Badge variant="outline" className="text-[11px]">
                                Booking: {booking.status}
                            </Badge>
                        </div>
                    </InfoBlock>
                ) : (
                    <p className="text-xs text-muted-foreground">Couldn't load booking details.</p>
                )}

                {reason && (
                    <Callout tone="destructive" title="Payment failed">
                        <p>{reason}</p>
                        {payment.resultCode && (
                            <p className="text-[11px] opacity-70 mt-1 font-mono">Daraja code: {payment.resultCode}</p>
                        )}
                    </Callout>
                )}

                {payment.status === "EXPIRED" && (
                    <Callout tone="amber" title="Payment never completed">
                        The passenger did not finish the M-Pesa prompt in time and the seat hold
                        was released. Take cash or re-send the STK push before letting them board.
                    </Callout>
                )}

                {payment.status === "PROCESSING" && (
                    <Callout tone="blue">
                        STK push sent — waiting for the passenger to complete it.
                    </Callout>
                )}

                <DetailRows>
                    <DetailRow label="Payer phone">{payment.payerPhone ?? "—"}</DetailRow>
                    <DetailRow label="Method">
                        {payment.method === "MPESA" ? (
                            <Smartphone className="h-3.5 w-3.5" />
                        ) : (
                            <Banknote className="h-3.5 w-3.5" />
                        )}
                        {methodLabel(payment.method)}
                    </DetailRow>
                    {payment.mpesaReceiptNumber && (
                        <DetailRow label="Receipt no." mono>{payment.mpesaReceiptNumber}</DetailRow>
                    )}
                    {payment.checkoutRequestId && (
                        <DetailRow label="Checkout ID" mono>
                            <span className="text-xs truncate max-w-[220px]">{payment.checkoutRequestId}</span>
                        </DetailRow>
                    )}
                    <DetailRow label="Initiated">{formatDateTime(payment.initiatedAt, { seconds: true })}</DetailRow>
                    <DetailRow label="Completed">{formatDateTime(payment.completedAt, { seconds: true })}</DetailRow>
                </DetailRows>
            </DialogContent>
        </Dialog>
    );
}

// ─── Grouping ─────────────────────────────────────────────────────────────

// One card per calendar day. A single-day range (the default) is one card;
// a week shows seven, each with its own collected total, so the shape of the
// week is readable without opening the chart.
interface DayGroup {
    date: string; // YYYY-MM-DD, local
    payments: Payment[];
}

function groupByDay(payments: Payment[]): DayGroup[] {
    const groups = new Map<string, DayGroup>();
    for (const p of payments) {
        const date = toLocalDateString(new Date(p.createdAt));
        let group = groups.get(date);
        if (!group) {
            group = { date, payments: [] };
            groups.set(date, group);
        }
        group.payments.push(p);
    }
    // Input is already newest-first, so insertion order is newest day first.
    return [...groups.values()];
}

const COLLAPSED_ROWS = 8;

// ─── Rows and cards ──────────────────────────────────────────────────────

function PaymentRow({
    payment,
    booking,
    bookingLoading,
    saccoName,
    onSelect,
}: {
    payment: Payment;
    booking: Booking | undefined;
    bookingLoading: boolean;
    saccoName: string | undefined;
    onSelect: (p: Payment) => void;
}) {
    const attention = needsAttention(payment);
    const reason = failureReason(payment);
    const success = payment.status === "SUCCESS";

    // What identifies this payment at a glance: the trip and passenger when
    // we have them, else whoever paid. The sacco name only appears for a
    // super admin, who is the only reader looking across saccos.
    const context = booking
        ? `${booking.route?.origin ?? "?"} → ${booking.route?.destination ?? "?"} · ${booking.passengerName}`
        : bookingLoading
            ? null
            : payment.payerPhone ?? "No booking details";

    return (
        <button
            type="button"
            onClick={() => onSelect(payment)}
            className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                attention && "bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-500/10",
            )}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div
                    className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg",
                        attention
                            ? "bg-amber-500 text-white"
                            : success
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                    )}
                >
                    {payment.method === "MPESA" ? (
                        <Smartphone className="size-4" />
                    ) : (
                        <Banknote className="size-4" />
                    )}
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold">KES {Number(payment.amount).toLocaleString()}</p>
                        {statusBadge(payment.status)}
                        {saccoName && (
                            <span className="text-[10px] text-muted-foreground truncate">{saccoName}</span>
                        )}
                    </div>
                    {context === null ? (
                        <span className="mt-1 inline-block h-3 w-32 animate-pulse rounded bg-muted" />
                    ) : (
                        <p className="truncate text-xs text-muted-foreground">{context}</p>
                    )}
                    {reason && (
                        <p className="truncate text-xs text-destructive flex items-center gap-1">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            {reason}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">{formatTime(payment.createdAt)}</span>
                <Badge variant="outline" className="font-mono text-[10px]">#{shortRef(payment)}</Badge>
            </div>
        </button>
    );
}

function DayCard({
    group,
    showHeader,
    bookings,
    bookingsLoading,
    saccoNames,
    onSelect,
}: {
    group: DayGroup;
    /** Hidden when the whole list is one day: the stat tiles already say it. */
    showHeader: boolean;
    bookings: Map<string, Booking>;
    bookingsLoading: Set<string>;
    saccoNames: Map<string, string> | null;
    onSelect: (p: Payment) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    const collected = group.payments
        .filter((p) => p.status === "SUCCESS")
        .reduce((sum, p) => sum + Number(p.amount), 0);
    const attentionCount = group.payments.filter(needsAttention).length;

    const rows = expanded ? group.payments : group.payments.slice(0, COLLAPSED_ROWS);

    return (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {showHeader && (
                <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-sm font-bold text-primary">{formatDay(group.date)}</span>
                        <span
                            className={cn(
                                "shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold",
                                attentionCount > 0 ? "bg-amber-100 text-amber-800" : "bg-primary/10 text-primary",
                            )}
                        >
                            {group.payments.length} {group.payments.length === 1 ? "payment" : "payments"}
                            {attentionCount > 0 && ` · ${attentionCount} failed`}
                        </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        KES {collected.toLocaleString()} collected
                    </span>
                </div>
            )}

            <div className="divide-y">
                {rows.map((payment) => (
                    <PaymentRow
                        key={payment.id}
                        payment={payment}
                        booking={bookings.get(payment.referenceId)}
                        bookingLoading={bookingsLoading.has(payment.referenceId)}
                        saccoName={saccoNames?.get(payment.saccoId)}
                        onSelect={onSelect}
                    />
                ))}
            </div>

            {group.payments.length > COLLAPSED_ROWS && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="flex w-full items-center justify-center gap-1 border-t bg-muted/20 py-2 text-xs font-semibold text-primary hover:bg-muted/40"
                >
                    {expanded ? "Show fewer" : `View all ${group.payments.length} payments`}
                    <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
                </button>
            )}
        </div>
    );
}

// ─── Main list ───────────────────────────────────────────────────────────
export default function PaymentsList() {
    const { user } = useAuth();
    const isSuperAdmin = user?.role === "SUPER_ADMIN";

    const [saccoId, setSaccoId] = useState<string | undefined>(undefined);
    // Today only by default, matching the bookings list — the payment a clerk
    // or admin is looking for is nearly always one from this shift.
    const [from, setFrom] = useState(todayString());
    const [to, setTo] = useState(todayString());
    const [status, setStatus] = useState<PaymentStatus | "ALL">("ALL");
    const [method, setMethod] = useState<PaymentMethod | "ALL">("ALL");
    const [search, setSearch] = useState("");
    const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

    // One request for every sacco name rather than one per card. Only a super
    // admin sees names on the rows; everyone else only ever sees their own sacco.
    const saccoNameMap = useSaccoNames();
    const saccoNames = isSuperAdmin ? saccoNameMap : null;

    const paymentsQuery = useQuery({
        queryKey: ["sacco-payments", saccoId, from, to, status, method],
        queryFn: () =>
            getSaccoPaymentsRequest({
                saccoId: isSuperAdmin ? saccoId : undefined,
                from,
                to,
                status: status === "ALL" ? undefined : status,
                method: method === "ALL" ? undefined : method,
            }),
        staleTime: 15 * 1000,
    });

    // One booking lookup per distinct booking, shared by the rows, the search
    // box and the detail dialog, instead of each card fetching for itself.
    const bookingIds = useMemo(
        () => [
            ...new Set(
                (paymentsQuery.data ?? [])
                    .filter((p) => p.referenceType === "BOOKING")
                    .map((p) => p.referenceId),
            ),
        ],
        [paymentsQuery.data],
    );
    const bookingQueries = useQueries({
        queries: bookingIds.map((id) => ({
            queryKey: ["booking-for-payment", id],
            queryFn: () => getBookingRequest(id),
            staleTime: 60 * 1000,
            retry: 1,
        })),
    });
    const { bookings, bookingsLoading } = useMemo(() => {
        const bookings = new Map<string, Booking>();
        const bookingsLoading = new Set<string>();
        bookingIds.forEach((id, i) => {
            const q = bookingQueries[i];
            if (q?.data) bookings.set(id, q.data);
            else if (q?.isLoading) bookingsLoading.add(id);
        });
        return { bookings, bookingsLoading };
    }, [bookingIds, bookingQueries]);

    // Newest first, then narrowed by whatever the clerk typed. Passenger
    // name only matches once that booking has loaded, which is the common
    // case by the time anyone has finished typing.
    const payments = useMemo(() => {
        const rows = [...(paymentsQuery.data ?? [])].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
        );
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((p) => {
            const booking = bookings.get(p.referenceId);
            return (
                (p.payerPhone?.includes(q) ?? false) ||
                (p.mpesaReceiptNumber?.toLowerCase().includes(q) ?? false) ||
                (p.checkoutRequestId?.toLowerCase().includes(q) ?? false) ||
                p.referenceId.slice(0, 6).toLowerCase().includes(q) ||
                (booking?.passengerName.toLowerCase().includes(q) ?? false) ||
                (booking?.passengerPhone.includes(q) ?? false)
            );
        });
    }, [paymentsQuery.data, search, bookings]);

    const groups = useMemo(() => groupByDay(payments), [payments]);

    const collected = payments
        .filter((p) => p.status === "SUCCESS")
        .reduce((sum, p) => sum + Number(p.amount), 0);
    const attentionCount = payments.filter(needsAttention).length;

    // Drives the mobile filter-toggle badge — date range excluded since it
    // always has a value and isn't really an "active filter" in this sense.
    const activeFilterCount = [
        isSuperAdmin && saccoId,
        status !== "ALL" ? status : null,
        method !== "ALL" ? method : null,
    ].filter(Boolean).length;

    const selectedBooking = selectedPayment ? bookings.get(selectedPayment.referenceId) : undefined;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-semibold">Payments</h2>

                <div className="grid grid-cols-3 gap-2">
                    <StatTile icon={CreditCard} label="Payments" value={payments.length} />
                    <StatTile icon={Banknote} label="Collected" value={`KES ${collected.toLocaleString()}`} tone="emerald" />
                    <StatTile icon={AlertCircle} label="Failed" value={attentionCount} tone="amber" />
                </div>
            </div>

            {/* Quick ranges + search — the two things reached for most often, so
                they stay out of the collapsible filter drawer. */}
            <div className="flex items-center gap-2 flex-wrap">
                <RangePresets
                    from={from}
                    to={to}
                    onChange={(f, t) => {
                        setFrom(f);
                        setTo(t);
                    }}
                />
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Phone, name, receipt or #ID"
                />
            </div>

            <FilterPanel activeCount={activeFilterCount} columns={isSuperAdmin ? 5 : 4}>
                {isSuperAdmin && (
                    <FilterField label="Sacco">
                        <SaccoCombobox value={saccoId} onChange={setSaccoId} placeholder="All saccos" />
                    </FilterField>
                )}
                <DateRangeFields from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
                <FilterField label="Status">
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
                </FilterField>
                <FilterField label="Method">
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
                </FilterField>
            </FilterPanel>

            {paymentsQuery.isLoading ? (
                <ListPlaceholder state="loading" />
            ) : paymentsQuery.isError ? (
                <ListPlaceholder state="error" message="Couldn't load payments. Please try again." />
            ) : payments.length === 0 ? (
                <ListPlaceholder
                    state="empty"
                    message={
                        search.trim()
                            ? `No payment matches "${search.trim()}" in this range.`
                            : "No payments in this range."
                    }
                />
            ) : (
                <>
                    {/* A one-day range is a single bar — not worth the space. */}
                    {from !== to && <PaymentsCharts payments={payments} />}
                    <div className="space-y-3">
                        {groups.map((group) => (
                            <DayCard
                                key={group.date}
                                group={group}
                                showHeader={groups.length > 1}
                                bookings={bookings}
                                bookingsLoading={bookingsLoading}
                                saccoNames={saccoNames}
                                onSelect={setSelectedPayment}
                            />
                        ))}
                    </div>
                </>
            )}

            <PaymentDetailDialog
                payment={selectedPayment}
                booking={selectedBooking}
                bookingLoading={selectedPayment ? bookingsLoading.has(selectedPayment.referenceId) : false}
                saccoName={selectedPayment ? saccoNames?.get(selectedPayment.saccoId) : undefined}
                open={!!selectedPayment}
                onOpenChange={(open) => !open && setSelectedPayment(null)}
            />
        </div>
    );
}
