import { useEffect, useState } from "react"
import {
    Bus,
    Route,
    Users,
    CalendarCheck,
    ChartBar,
    Shield,
    ArrowRight,
    MapPin,
    Clock,
    CheckCircle2,
} from "lucide-react"

// ---- Signature element: a split-flap "departure board" ----
// SACCO stages/termini run departure boards for their fleets — this is the
// hero's thesis made literal: routes, statuses, times, flipping live.
type RouteStatus = "ON TIME" | "BOARDING" | "DELAYED"

interface RouteRow {
    no: string
    to: string
    status: RouteStatus
    time: string
}

const ROUTES: RouteRow[] = [
    { no: "14", to: "TOWN — WESTLANDS", status: "ON TIME", time: "6 MIN" },
    { no: "22", to: "RONGAI — TOWN", status: "BOARDING", time: "NOW" },
    { no: "07", to: "KAREN — CBD", status: "ON TIME", time: "11 MIN" },
    { no: "31", to: "THIKA RD — TOWN", status: "DELAYED", time: "18 MIN" },
    { no: "45", to: "NGONG — TOWN", status: "ON TIME", time: "4 MIN" },
]

const STATUS_COLOR: Record<RouteStatus, string> = {
    "ON TIME": "text-emerald-500",
    BOARDING: "text-amber-500",
    DELAYED: "text-red-500",
}

interface FlapCellProps {
    value: string
}

function FlapCell({ value }: FlapCellProps) {
    const [display, setDisplay] = useState(value)
    const [flipping, setFlipping] = useState(false)

    useEffect(() => {
        if (value === display) return
        setFlipping(true)
        const t = setTimeout(() => {
            setDisplay(value)
            setFlipping(false)
        }, 220)
        return () => clearTimeout(t)
    }, [value])

    return (
        <span
            className={cn(
                "inline-block transition-transform duration-200 [transform-style:preserve-3d]",
                flipping && "scale-y-[0.15] opacity-40"
            )}
        >
            {display}
        </span>
    )
}

function cn(...args: Array<string | false | null | undefined>) {
    return args.filter(Boolean).join(" ")
}

function DepartureBoard() {
    const [, setTick] = useState(0)

    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 3200)
        return () => clearInterval(id)
    }, [])

    // `tick` re-renders the board on an interval so each FlapCell gets a
    // chance to animate; the board reads straight from ROUTES otherwise.
    const rows = ROUTES

    return (
        <div className="rounded-md border border-border bg-card shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_60px_-20px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2 text-[11px] font-mono tracking-[0.2em] text-muted-foreground">
                    <MapPin className="size-3.5" />
                    CBD TERMINUS — LIVE DEPARTURES
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-500">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                </div>
            </div>
            <div className="divide-y divide-border">
                {rows.map((r) => (
                    <div
                        key={r.no}
                        className="grid grid-cols-[2.5rem_1fr_5.5rem_4rem] items-center gap-3 px-4 py-3 font-mono text-[13px] sm:text-sm"
                    >
                        <span className="text-foreground font-semibold">{r.no}</span>
                        <span className="text-foreground/70 tracking-wide truncate">
                            <FlapCell value={r.to} />
                        </span>
                        <span className={cn("font-semibold tracking-wide", STATUS_COLOR[r.status])}>
                            <FlapCell value={r.status} />
                        </span>
                        <span className="text-muted-foreground text-right tabular-nums">{r.time}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ---- Feature data (kept from the product's existing vocabulary) ----
const FEATURES = [
    {
        icon: Bus,
        title: "Fleet management",
        copy: "Track every vehicle's papers, service history, and roadworthiness in one register.",
    },
    {
        icon: Route,
        title: "Route optimisation",
        copy: "Balance vehicles across routes as demand shifts through the day.",
    },
    {
        icon: Users,
        title: "Member management",
        copy: "Onboard members, record contributions, and manage vehicle ownership shares.",
    },
    {
        icon: CalendarCheck,
        title: "Trip scheduling",
        copy: "Assign drivers and conductors to trips, and catch clashes before they happen.",
    },
    {
        icon: ChartBar,
        title: "Analytics & reports",
        copy: "See daily takings, route performance, and member payouts at a glance.",
    },
    {
        icon: Shield,
        title: "Secure operations",
        copy: "Role-based access keeps financial records visible only to who should see them.",
    },
]

const STATS = [
    { value: "100+", label: "SACCOs operating" },
    { value: "10,000+", label: "Vehicles managed" },
    { value: "42", label: "Counties covered" },
    { value: "99.9%", label: "Uptime last quarter" },
]

export default function Homepage() {
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    return (
        <div className="min-h-screen bg-background text-foreground font-sans antialiased">
            {/* Hero */}
            <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-20">
                <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_1fr]">
                    <div
                        className={cn(
                            "space-y-7 transition-all duration-700",
                            mounted ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
                        )}
                    >
                        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            BUILT FOR EAST AFRICAN SACCOS
                        </div>
                        <h1 className="text-[2.75rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
                            Run your SACCO
                            <br />
                            like a terminus,
                            <br />
                            <span className="text-emerald-500">not a spreadsheet.</span>
                        </h1>
                        <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
                            ShuttleOps gives fleet managers, dispatchers, and members one
                            dashboard for vehicles, routes, trips, and payouts — updated as
                            operations happen, not at end of month.
                        </p>
                        <div className="flex flex-wrap items-center gap-4 pt-2">
                            <a
                                href="/register"
                                className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                                Start managing your fleet
                                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                            </a>
                            <a
                                href="#features"
                                className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold text-foreground underline decoration-foreground/20 underline-offset-4 hover:decoration-foreground"
                            >
                                See the platform
                            </a>
                        </div>
                        <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                            No card required to try it with your SACCO's data
                        </div>
                    </div>

                    <div
                        className={cn(
                            "transition-all delay-150 duration-700",
                            mounted ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
                        )}
                    >
                        <DepartureBoard />
                        <p className="mt-3 text-center text-xs text-muted-foreground">
                            A live look at dispatch — this is what your stage manager sees.
                        </p>
                    </div>
                </div>
            </section>

            {/* Stats */}
            <section id="stats" className="border-y border-border bg-card">
                <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-10 sm:grid-cols-4">
                    {STATS.map((s) => (
                        <div key={s.label} className="text-center sm:text-left">
                            <div className="font-mono text-3xl font-bold tabular-nums text-foreground">
                                {s.value}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Features */}
            <section id="features" className="mx-auto max-w-6xl px-6 py-20">
                <div className="mb-12 max-w-xl">
                    <div className="text-xs font-semibold tracking-[0.2em] text-emerald-500">
                        THE PLATFORM
                    </div>
                    <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                        Every gate, covered.
                    </h2>
                    <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                        From the vehicle register to the payout ledger, ShuttleOps
                        replaces the notebook-and-WhatsApp-group approach most SACCOs
                        still run on.
                    </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {FEATURES.map(({ icon: Icon, title, copy }) => (
                        <div
                            key={title}
                            className="group rounded-lg border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-[0_12px_30px_-16px_rgba(16,25,46,0.25)]"
                        >
                            <div className="inline-flex rounded-md bg-primary p-2.5">
                                <Icon className="size-4.5 text-primary-foreground" />
                            </div>
                            <h3 className="mt-4 text-base font-bold">{title}</h3>
                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{copy}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* CTA */}
            <section id="cta" className="mx-auto max-w-6xl px-6 pb-24">
                <div className="relative overflow-hidden rounded-2xl bg-primary px-8 py-14 text-center sm:px-16">
                    <div className="absolute -top-24 -right-24 size-64 rounded-full bg-emerald-500/10 blur-3xl" />
                    <div className="absolute -bottom-24 -left-24 size-64 rounded-full bg-amber-500/10 blur-3xl" />
                    <div className="relative mx-auto max-w-lg space-y-6">
                        <div className="flex items-center justify-center gap-2 text-xs font-mono tracking-[0.2em] text-primary-foreground/60">
                            <Clock className="size-3.5" />
                            SET UP IN AN AFTERNOON
                        </div>
                        <h2 className="text-3xl font-extrabold tracking-tight text-primary-foreground sm:text-4xl">
                            Bring your SACCO on board.
                        </h2>
                        <p className="text-primary-foreground/70">
                            Import your existing vehicle and member records, and your
                            dispatch board goes live the same day.
                        </p>
                        <a
                            href="/register"
                            className="inline-flex items-center gap-2 rounded-md bg-background px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-background/90"
                        >
                            Get started free
                            <ArrowRight className="size-4" />
                        </a>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-border px-6 py-10">
                <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
                    <div className="flex items-center gap-2">
                        <Bus className="size-4" />
                        <span className="font-semibold text-foreground">ShuttleOps</span>
                        <span>— SACCO operations, run right.</span>
                    </div>
                    <div className="flex items-center gap-6">
                        <a href="/terms" className="hover:text-foreground">Terms</a>
                        <a href="/privacy" className="hover:text-foreground">Privacy</a>
                        <a href="/contact" className="hover:text-foreground">Contact</a>
                    </div>
                </div>
            </footer>
        </div>
    )
}