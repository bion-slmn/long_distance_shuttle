// src/components/VerifyReceipt.tsx
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
    ShieldCheck,
    ShieldX,
    AlertTriangle,
    User,
    Banknote,
} from "lucide-react";
import { verifyReceiptRequest } from "@/api/receiptApi";

export default function VerifyReceipt() {
    const { bookingId } = useParams<{ bookingId: string }>();
    const [searchParams] = useSearchParams();
    const sig = searchParams.get("sig") ?? "";

    const query = useQuery({
        queryKey: ["verify-receipt", bookingId, sig],
        queryFn: () => verifyReceiptRequest(bookingId!, sig),
        enabled: !!bookingId && !!sig,
        retry: false,
    });

    // Malformed link — no id or no signature in the URL at all.
    if (!bookingId || !sig) {
        return (
            <VerifyShell>
                <StatusIcon variant="warning" />
                <h1 className="text-lg font-semibold mt-4">Invalid verification link</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    This link is missing a booking reference or signature.
                </p>
            </VerifyShell>
        );
    }

    if (query.isLoading) {
        return (
            <VerifyShell>
                <Skeleton className="h-16 w-16 rounded-full mx-auto" />
                <Skeleton className="h-5 w-40 mx-auto mt-4" />
                <Skeleton className="h-4 w-56 mx-auto mt-2" />
            </VerifyShell>
        );
    }

    if (query.isError) {
        return (
            <VerifyShell>
                <StatusIcon variant="warning" />
                <h1 className="text-lg font-semibold mt-4">Couldn't verify this receipt</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Please check your connection and try again.
                </p>
            </VerifyShell>
        );
    }

    const result = query.data!;

    if (!result.valid || !result.booking) {
        return (
            <VerifyShell>
                <StatusIcon variant="invalid" />
                <h1 className="text-lg font-semibold mt-4 text-red-700">Not a valid receipt</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {result.reason ?? "This receipt could not be verified."}
                </p>
            </VerifyShell>
        );
    }

    const b = result.booking;

    return (
        <VerifyShell>
            <StatusIcon variant="valid" />
            <h1 className="text-lg font-semibold mt-4 text-emerald-700">Receipt verified</h1>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
                REF: #{b.id.slice(0, 6).toUpperCase()}
            </p>

            <div className="mt-6 w-full rounded-xl border border-border divide-y divide-border text-left overflow-hidden">
                <Row icon={User} label="Passenger" value={b.passengerName} />
                <Row
                    icon={Banknote}
                    label="Fare"
                    value={`KES ${b.fare}`}
                    trailing={
                        <Badge
                            variant="secondary"
                            className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                        >
                            {b.paymentStatus}
                        </Badge>
                    }
                />
                <Row label="Payment method" value={b.paymentMethod} />
                <Row label="Booking status" value={b.status} />
                {b.mpesaReceiptNumber && (
                    <Row label="M-Pesa Ref" value={b.mpesaReceiptNumber} mono />
                )}
                <Row label="Paid at" value={new Date(b.paidAt).toLocaleString()} />
            </div>
        </VerifyShell>
    );
}

function VerifyShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto w-full max-w-sm px-4 py-16 text-center flex flex-col items-center">
            {children}
        </div>
    );
}

function StatusIcon({ variant }: { variant: "valid" | "invalid" | "warning" }) {
    if (variant === "valid") {
        return (
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50">
                <ShieldCheck className="h-8 w-8 text-emerald-600" />
            </div>
        );
    }
    if (variant === "invalid") {
        return (
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50">
                <ShieldX className="h-8 w-8 text-red-500" />
            </div>
        );
    }
    return (
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
        </div>
    );
}

function Row({
    icon: Icon,
    label,
    value,
    trailing,
    mono,
}: {
    icon?: React.ElementType;
    label: string;
    value: string;
    trailing?: React.ReactNode;
    mono?: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-background">
            <div className="flex items-center gap-2 min-w-0">
                {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                <span className="text-xs text-muted-foreground shrink-0">{label}</span>
            </div>
            {trailing ?? (
                <span className={`text-sm font-medium truncate ${mono ? "font-mono text-xs" : ""}`}>
                    {value}
                </span>
            )}
        </div>
    );
}