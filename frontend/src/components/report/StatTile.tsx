// src/components/report/StatTile.tsx
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "primary" | "emerald" | "amber";

const TONES: Record<StatTone, { box: string; iconBox: string; icon: string; label: string }> = {
    primary: {
        box: "border-primary/20 bg-primary/5",
        iconBox: "bg-primary/10",
        icon: "text-primary",
        label: "text-primary/70",
    },
    emerald: {
        box: "border-emerald-500/20 bg-emerald-500/5",
        iconBox: "bg-emerald-500/10",
        icon: "text-emerald-500",
        label: "text-emerald-600 dark:text-emerald-400",
    },
    amber: {
        box: "border-amber-500/20 bg-amber-500/5",
        iconBox: "bg-amber-500/10",
        icon: "text-amber-500",
        label: "text-amber-600 dark:text-amber-400",
    },
};

/** One headline number in a report header: icon, tiny label, big value. */
export function StatTile({
    icon: Icon,
    label,
    value,
    tone = "primary",
}: {
    icon: LucideIcon;
    label: string;
    value: string | number;
    tone?: StatTone;
}) {
    const t = TONES[tone];
    return (
        <div className={cn("rounded-lg border px-3 py-2 flex items-center gap-2", t.box)}>
            <div className={cn("hidden sm:flex rounded-md p-1.5 shrink-0", t.iconBox)}>
                <Icon className={cn("size-3.5", t.icon)} />
            </div>
            <div className="min-w-0">
                <p className={cn("text-[9px] font-semibold uppercase tracking-wide truncate", t.label)}>
                    {label}
                </p>
                <p className="text-base font-bold leading-none mt-0.5">{value}</p>
            </div>
        </div>
    );
}
