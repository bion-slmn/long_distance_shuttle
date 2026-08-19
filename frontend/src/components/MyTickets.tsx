// src/components/MyTickets.tsx
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
    requestTicketCodeRequest,
    verifyTicketCodeRequest,
    getMyTicketsRequest,
    type Booking,
} from "@/api/bookingApi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Mail,
    ShieldCheck,
    ArrowLeft,
    Bus,
    MapPin,
    Calendar,
    Banknote,
    RefreshCw,
} from "lucide-react";

type Step = "email" | "code" | "tickets";

const STATUS_STYLE: Record<string, string> = {
    AWAITING_TRIP: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    CONFIRMED: "bg-primary/10 text-primary border-primary/20",
    BOARDED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    CANCELLED: "bg-muted text-muted-foreground border-transparent",
    NO_SHOW: "bg-red-500/10 text-red-600 border-red-500/20",
};

export default function MyTickets() {
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [token, setToken] = useState<string | null>(null);

    // ── Step 1: request code ────────────────────────────────────────────
    const requestCodeMutation = useMutation({
        mutationFn: () => requestTicketCodeRequest(email.trim()),
        onSuccess: () => setStep("code"),
    });

    // ── Step 2: verify code ─────────────────────────────────────────────
    const verifyCodeMutation = useMutation({
        mutationFn: () => verifyTicketCodeRequest(email.trim(), code.trim()),
        onSuccess: (data) => {
            setToken(data.access_token);
            setStep("tickets");
        },
    });

    // ── Step 3: fetch tickets once we have a token ──────────────────────
    const ticketsQuery = useQuery({
        queryKey: ["my-tickets", token],
        queryFn: () => getMyTicketsRequest(token!),
        enabled: !!token && step === "tickets",
    });

    function startOver() {
        setStep("email");
        setEmail("");
        setCode("");
        setToken(null);
        requestCodeMutation.reset();
        verifyCodeMutation.reset();
    }

    // ─── Step: Email ────────────────────────────────────────────────────
    if (step === "email") {
        return (
            <div className="mx-auto w-full max-w-md px-4 py-6">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/5 mb-3">
                        <Mail className="h-6 w-6 text-primary" />
                    </div>
                    <h1 className="text-xl font-bold">Find your tickets</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Enter the email you used when booking
                    </p>
                </div>

                <form
                    className="mt-6 space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (email.trim()) requestCodeMutation.mutate();
                    }}
                >
                    <div className="space-y-1.5">
                        <Label htmlFor="lookup-email">Email</Label>
                        <Input
                            id="lookup-email"
                            type="email"
                            placeholder="you@example.com"
                            className="h-11"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoFocus
                        />
                    </div>

                    {requestCodeMutation.isError && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2.5">
                            <p className="text-sm text-destructive">
                                Something went wrong. Please try again.
                            </p>
                        </div>
                    )}

                    <Button
                        type="submit"
                        className="w-full h-11"
                        disabled={requestCodeMutation.isPending || !email.trim()}
                    >
                        {requestCodeMutation.isPending ? (
                            <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                Sending code...
                            </>
                        ) : (
                            "Send verification code"
                        )}
                    </Button>
                </form>
            </div>
        );
    }

    // ─── Step: Code ─────────────────────────────────────────────────────
    if (step === "code") {
        return (
            <div className="mx-auto w-full max-w-md px-4 py-6">
                <button
                    onClick={() => setStep("email")}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                </button>

                <div className="text-center mt-4">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/5 mb-3">
                        <ShieldCheck className="h-6 w-6 text-primary" />
                    </div>
                    <h1 className="text-xl font-bold">Enter your code</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
                    </p>
                </div>

                <form
                    className="mt-6 space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (code.trim()) verifyCodeMutation.mutate();
                    }}
                >
                    <div className="space-y-1.5">
                        <Label htmlFor="otp-code">Verification code</Label>
                        <Input
                            id="otp-code"
                            inputMode="numeric"
                            placeholder="123456"
                            className="h-11 text-center text-lg tracking-[0.3em] font-mono"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            autoFocus
                        />
                    </div>

                    {verifyCodeMutation.isError && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2.5">
                            <p className="text-sm text-destructive">
                                Invalid or expired code. Please try again.
                            </p>
                        </div>
                    )}

                    <Button
                        type="submit"
                        className="w-full h-11"
                        disabled={verifyCodeMutation.isPending || code.trim().length !== 6}
                    >
                        {verifyCodeMutation.isPending ? (
                            <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                Verifying...
                            </>
                        ) : (
                            "Verify"
                        )}
                    </Button>

                    <button
                        type="button"
                        onClick={() => requestCodeMutation.mutate()}
                        disabled={requestCodeMutation.isPending}
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                        {requestCodeMutation.isPending ? "Resending..." : "Didn't get a code? Resend"}
                    </button>
                </form>
            </div>
        );
    }

    // ─── Step: Tickets ──────────────────────────────────────────────────
    return (
        <div className="mx-auto w-full max-w-md px-4 py-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold">Your tickets</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{email}</p>
                </div>
                <Button variant="outline" size="sm" onClick={startOver}>
                    Sign out
                </Button>
            </div>

            <div className="mt-5 space-y-3">
                {ticketsQuery.isLoading && (
                    <>
                        <Skeleton className="h-24 w-full rounded-lg" />
                        <Skeleton className="h-24 w-full rounded-lg" />
                    </>
                )}

                {ticketsQuery.isError && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                        <p className="text-sm text-destructive">
                            Your session expired. Please verify again.
                        </p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={startOver}>
                            Start over
                        </Button>
                    </div>
                )}

                {ticketsQuery.data?.length === 0 && (
                    <div className="bg-muted/30 rounded-lg px-4 py-8 text-center">
                        <Bus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No tickets found for this email.</p>
                    </div>
                )}

                {ticketsQuery.data?.map((booking) => (
                    <TicketCard key={booking.id} booking={booking} />
                ))}
            </div>
        </div>
    );
}

// ─── Ticket card ────────────────────────────────────────────────────────

function TicketCard({ booking }: { booking: Booking }) {
    return (
        <div className="rounded-lg border border-border p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">
                        {booking.route?.origin ?? "—"} → {booking.route?.destination ?? "—"}
                    </span>
                </div>
                <Badge
                    variant="outline"
                    className={`text-[10px] shrink-0 ${STATUS_STYLE[booking.status] ?? ""}`}
                >
                    {booking.status.replace("_", " ")}
                </Badge>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {booking.travelDate}
                </span>
                {booking.seatNumber != null && (
                    <span className="flex items-center gap-1">
                        <Bus className="h-3 w-3" />
                        Seat {booking.seatNumber}
                    </span>
                )}
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-border/60">
                <span className="text-xs text-muted-foreground font-mono">
                    #{booking.id.slice(0, 6).toUpperCase()}
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold">
                    <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
                    KES {booking.fare}
                </span>
            </div>
        </div>
    );
}