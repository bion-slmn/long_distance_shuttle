// src/components/report/Detail.tsx
//
// Building blocks for the detail dialogs: a muted "who/where" block with
// icon lines, label/value rows, and a coloured callout for state that needs
// explaining (a failed payment, a lapsed hold).
import type { ReactNode } from "react";
import { AlertCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function InfoBlock({ children }: { children: ReactNode }) {
    return <div className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-1.5">{children}</div>;
}

export function InfoLine({
    icon: Icon,
    primary = false,
    children,
}: {
    icon: LucideIcon;
    /** The headline line of the block: larger and darker than the rest. */
    primary?: boolean;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                "flex items-center gap-2",
                primary ? "text-sm font-medium" : "text-xs text-muted-foreground",
            )}
        >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", primary && "text-muted-foreground")} />
            {children}
        </div>
    );
}

export function DetailRows({ children }: { children: ReactNode }) {
    return <div className="space-y-2 text-sm">{children}</div>;
}

export function DetailRow({
    label,
    mono = false,
    children,
}: {
    label: string;
    mono?: boolean;
    children: ReactNode;
}) {
    return (
        <div className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn("font-medium flex items-center gap-1.5", mono && "font-mono")}>{children}</span>
        </div>
    );
}

export type CalloutTone = "destructive" | "amber" | "blue";

const CALLOUT_TONES: Record<CalloutTone, { box: string; icon: string; title: string; body: string }> = {
    destructive: {
        box: "bg-destructive/10 border-destructive/20",
        icon: "text-destructive",
        title: "text-destructive",
        body: "text-destructive/80",
    },
    amber: {
        box: "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20",
        icon: "text-amber-600",
        title: "text-amber-800 dark:text-amber-200",
        body: "text-amber-700 dark:text-amber-300",
    },
    blue: {
        box: "bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20",
        icon: "text-blue-600",
        title: "text-blue-800 dark:text-blue-200",
        body: "text-blue-700 dark:text-blue-300",
    },
};

export function Callout({
    tone,
    title,
    children,
}: {
    tone: CalloutTone;
    /** With a title the callout gets an alert icon; without, it is a plain note. */
    title?: string;
    children: ReactNode;
}) {
    const t = CALLOUT_TONES[tone];
    return (
        <div className={cn("border rounded-lg px-3 py-2.5 flex items-start gap-2", t.box)}>
            {title && <AlertCircle className={cn("h-4 w-4 shrink-0 mt-0.5", t.icon)} />}
            <div className="min-w-0">
                {title && <p className={cn("text-sm font-medium", t.title)}>{title}</p>}
                <div className={cn("text-xs", t.body, title && "mt-0.5")}>{children}</div>
            </div>
        </div>
    );
}
