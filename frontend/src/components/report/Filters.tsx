// src/components/report/Filters.tsx
//
// The filter chrome every report-style list shares: quick date-range presets,
// a search box, the collapsible filter grid with its mobile toggle, and the
// labelled fields that go inside it.
import { useState, type ReactNode } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { daysAgoString, RANGE_PRESETS, todayString } from "@/lib/dateRange";

export function RangePresets({
    from,
    to,
    onChange,
    className,
}: {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
    className?: string;
}) {
    return (
        <div className={cn("flex rounded-lg border border-border p-0.5", className)}>
            {RANGE_PRESETS.map((preset) => {
                const active = from === daysAgoString(preset.days) && to === todayString();
                return (
                    <button
                        key={preset.label}
                        type="button"
                        onClick={() => onChange(daysAgoString(preset.days), todayString())}
                        className={cn(
                            "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                            active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {preset.label}
                    </button>
                );
            })}
        </div>
    );
}

export function SearchInput({
    value,
    onChange,
    placeholder,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    className?: string;
}) {
    return (
        <div className={cn("relative flex-1 min-w-[10rem]", className)}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-9 pl-8"
            />
        </div>
    );
}

// Tailwind can't build class names at runtime, so the column counts a
// panel may ask for are spelled out.
const COLUMNS: Record<3 | 4 | 5 | 6, string> = {
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
    5: "sm:grid-cols-5",
    6: "sm:grid-cols-6",
};

/**
 * The filter grid. Always visible on sm+; on phones it collapses behind a
 * "Filters" toggle that shows how many filters are set away from default.
 */
export function FilterPanel({
    activeCount,
    columns,
    children,
}: {
    activeCount: number;
    columns: keyof typeof COLUMNS;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="sm:hidden flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
                <SlidersHorizontal className="size-3.5" />
                Filters
                {activeCount > 0 && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        {activeCount}
                    </Badge>
                )}
                <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>

            <div className={cn("grid grid-cols-2 gap-2", COLUMNS[columns], !open && "hidden sm:grid")}>
                {children}
            </div>
        </>
    );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            {children}
        </div>
    );
}

/** From/To date inputs that keep each other in range and never reach into the future. */
export function DateRangeFields({
    from,
    to,
    onFromChange,
    onToChange,
}: {
    from: string;
    to: string;
    onFromChange: (value: string) => void;
    onToChange: (value: string) => void;
}) {
    return (
        <>
            <FilterField label="From">
                <Input type="date" value={from} max={to} onChange={(e) => onFromChange(e.target.value)} className="h-9" />
            </FilterField>
            <FilterField label="To">
                <Input
                    type="date"
                    value={to}
                    min={from}
                    max={todayString()}
                    onChange={(e) => onToChange(e.target.value)}
                    className="h-9"
                />
            </FilterField>
        </>
    );
}
