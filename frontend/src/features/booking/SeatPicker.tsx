// src/components/SeatPicker.tsx
//
// Clerk-facing seat grid for BookingSheet. Fixed at 3 columns per row,
// including the driver — the driver always occupies the top-right cell
// of row 0 (index 2), sharing that row with the first two passenger
// seats. Seats flow left-to-right, top-to-bottom filling the remaining
// cells; rows grow downward as needed for larger vehicles. Matatus are
// right-hand drive, so top-right also matches the real vehicle, not just
// a UI convenience. The driver cell is NOT part of seatsTotal/
// takenSeatNumbers; those come straight from BookingService.getSeatMap
// and only ever describe passenger seats.
//
// The seat number always stays visible on the cell — selected/taken state
// is shown via fill color plus an icon overlay (check / diagonal strike),
// never by replacing the number, so a clerk can still tell which seats
// they've picked after tapping them.
//
// An occupied seat is one of two things, and the difference matters to a
// clerk standing at the stage:
//   TAKEN — paid for, gone for good.
//   HELD  — someone's M-Pesa prompt is still in flight. Blocked right now,
//           but it frees itself when the hold lapses, so the cell shows the
//           time remaining instead of a permanent strike-through. A clerk
//           who can see "0:42" knows to wait rather than turn a passenger
//           away or start hunting for another vehicle.
//
// Quantity is no longer a separate control anywhere upstream — however
// many seats the clerk taps here IS the seat count for the booking. There's
// no cap to pass in: a taken seat is simply unclickable, so the picker can
// never select more than what's actually free.
//
// Usage:
//   const { data } = useQuery({
//     queryKey: ["seat-map", routeId, travelDate],
//     queryFn: () => getBookingSeatMapRequest(routeId, travelDate),
//   });
//
//   <SeatPicker
//     seatsTotal={data?.seatsTotal ?? 0}
//     takenSeatNumbers={data?.takenSeatNumbers ?? []}
//     selectedSeats={selectedSeats}
//     onToggle={toggleSeat}
//   />
//
// selectedSeats goes straight onto one CreateBookingPayload.seatNumber per
// request when the clerk submits — the backend re-validates each is still
// free inside the locked transaction, so a stale selection here just
// surfaces as a ConflictException on submit, not silent overbooking.

import { useEffect, useState } from "react";
import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SeatState, type SeatMapSeat } from "@/api/bookingApi";

// lucide-react has no built-in steering-wheel icon — this is a small
// hand-drawn stand-in kept in the same visual language as lucide's set
// (24x24 viewBox, currentColor stroke, round caps/joins) so it drops in
// next to any other lucide icon without looking out of place.
function SteeringWheelIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M12 4.5v5" />
            <path d="M6.2 16.5 10 13.5" />
            <path d="M17.8 16.5 14 13.5" />
        </svg>
    );
}

type SeatCell =
    | { type: "driver" }
    | { type: "seat"; number: number }
    | { type: "empty" };

const COLUMNS = 3;
const DRIVER_INDEX = COLUMNS - 1; // top-right cell of row 0

function buildSeatGrid(seatsTotal: number): SeatCell[] {
    // +1 reserves the driver's cell alongside the passenger seats when
    // deciding how many rows are needed — columns are always fixed at 3.
    const rows = Math.max(1, Math.ceil((seatsTotal + 1) / COLUMNS));

    const flat: SeatCell[] = [];
    let nextSeat = 1;
    for (let i = 0; i < rows * COLUMNS; i++) {
        if (i === DRIVER_INDEX) {
            flat.push({ type: "driver" });
        } else if (nextSeat <= seatsTotal) {
            flat.push({ type: "seat", number: nextSeat });
            nextSeat++;
        } else {
            flat.push({ type: "empty" });
        }
    }
    return flat;
}

export interface SeatPickerProps {
    seatsTotal: number;
    takenSeatNumbers: number[];
    // Per-seat detail from getSeatMap. Optional so callers that haven't been
    // updated still render correctly — without it every occupied seat falls
    // back to the old undifferentiated "taken" look.
    seats?: SeatMapSeat[];
    // Whichever seats the clerk has tapped so far — this list's length IS
    // the seat count for the booking, there's no separate quantity input.
    selectedSeats: number[];
    onToggle: (seat: number) => void;
    disabled?: boolean;
}

/** mm:ss left on a hold, or null once it has lapsed. */
function holdRemaining(holdExpiresAt: string | null, now: number): string | null {
    if (!holdExpiresAt) return null;
    const seconds = Math.floor((new Date(holdExpiresAt).getTime() - now) / 1000);
    if (seconds <= 0) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function SeatPicker({
    seatsTotal,
    takenSeatNumbers,
    seats,
    selectedSeats,
    onToggle,
    disabled = false,
}: SeatPickerProps) {
    // Ticks only while at least one seat is actually held, so a grid of sold
    // and free seats costs no timer at all.
    const hasHolds = !!seats?.some((s) => s.state === SeatState.HELD);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!hasHolds) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [hasHolds]);

    if (!seatsTotal) {
        return (
            <p className="text-xs text-muted-foreground text-center py-4">
                No open trip to seat against yet — booking will queue for the next vehicle.
            </p>
        );
    }

    // takenSeatNumbers stays the source of truth for "is this clickable" —
    // sold and held both block a booking. `seats` only adds the reason why.
    const taken = new Set(takenSeatNumbers);
    const selected = new Set(selectedSeats);
    const bySeat = new Map((seats ?? []).map((s) => [s.seatNumber, s]));
    const cells = buildSeatGrid(seatsTotal);

    function handleClick(cell: SeatCell) {
        if (cell.type !== "seat" || disabled) return;
        if (taken.has(cell.number)) return;
        onToggle(cell.number);
    }

    return (
        <div className="rounded-xl border bg-muted/20 p-4 flex flex-col gap-4">
            {/* Grid — always 3 columns, driver included */}
            <div className="grid grid-cols-3 gap-2">
                {cells.map((cell, i) => {
                    if (cell.type === "empty") {
                        return <div key={i} className="h-12" aria-hidden="true" />;
                    }

                    if (cell.type === "driver") {
                        return (
                            <div
                                key={i}
                                className="h-12 rounded-lg bg-amber-400/20 border border-amber-400/50 flex items-center justify-center text-amber-700 dark:text-amber-400 shadow-sm"
                                title="Driver"
                            >
                                <SteeringWheelIcon className="size-5" />
                            </div>
                        );
                    }

                    const isTaken = taken.has(cell.number);
                    const isSelected = selected.has(cell.number);
                    const detail = bySeat.get(cell.number);
                    const isHeld = isTaken && detail?.state === SeatState.HELD;
                    const remaining = isHeld ? holdRemaining(detail!.holdExpiresAt, now) : null;

                    return (
                        <button
                            key={i}
                            type="button"
                            disabled={isTaken || disabled}
                            onClick={() => handleClick(cell)}
                            title={
                                isHeld
                                    ? `Seat ${cell.number} — payment in progress${remaining ? `, frees in ${remaining}` : ""}`
                                    : isTaken
                                        ? `Seat ${cell.number} — taken`
                                        : `Seat ${cell.number}`
                            }
                            className={cn(
                                "h-12 rounded-lg border flex items-center justify-center relative overflow-hidden transition-all font-semibold text-base",
                                isHeld
                                    ? "bg-amber-500/10 border-amber-500/50 border-dashed text-amber-700 dark:text-amber-400 cursor-not-allowed"
                                    : isTaken
                                        ? "bg-destructive/10 border-destructive/40 text-destructive/60 cursor-not-allowed"
                                        : isSelected
                                            ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                            : "bg-background border-border text-foreground hover:border-primary transition-colors"
                            )}
                        >
                            {isHeld ? (
                                // The countdown replaces the seat number only
                                // while it's genuinely counting — a lapsed or
                                // missing expiry falls back to the number.
                                <span className="relative z-10 flex flex-col items-center leading-none">
                                    <span className={cn(remaining ? "text-[11px]" : "text-base")}>
                                        {cell.number}
                                    </span>
                                    {remaining && (
                                        <span className="text-[10px] font-mono tabular-nums opacity-80 mt-0.5">
                                            {remaining}
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <span className={cn("relative z-10", isTaken && "opacity-50")}>
                                    {cell.number}
                                </span>
                            )}

                            {isSelected && (
                                <Check className="absolute -bottom-1 -right-1 size-6 opacity-30" strokeWidth={3} />
                            )}

                            {isHeld && !remaining && (
                                <Clock className="absolute -bottom-1 -right-1 size-5 opacity-25" strokeWidth={3} />
                            )}

                            {isTaken && !isHeld && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-full h-px bg-destructive rotate-45" />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-4 pt-3 border-t border-border/50">
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm border border-border bg-background" />
                    <span className="text-xs text-muted-foreground">Available</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-primary flex items-center justify-center">
                        <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />
                    </div>
                    <span className="text-xs text-muted-foreground">Selected</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-destructive/10 border border-destructive/40 flex items-center justify-center">
                        <div className="w-full h-px bg-destructive rotate-45" />
                    </div>
                    <span className="text-xs text-muted-foreground">Taken</span>
                </div>
                {hasHolds && (
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-sm bg-amber-500/10 border border-dashed border-amber-500/50 flex items-center justify-center">
                            <Clock className="size-2.5 text-amber-700 dark:text-amber-400" />
                        </div>
                        <span className="text-xs text-muted-foreground">Paying</span>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-amber-400/20 border border-amber-400/50 flex items-center justify-center">
                        <SteeringWheelIcon className="size-2.5 text-amber-700 dark:text-amber-400" />
                    </div>
                    <span className="text-xs text-muted-foreground">Driver</span>
                </div>
            </div>
        </div>
    );
}