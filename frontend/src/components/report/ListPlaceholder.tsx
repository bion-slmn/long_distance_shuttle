// src/components/report/ListPlaceholder.tsx
import { Skeleton } from "@/components/ui/skeleton";

/** What a report list shows instead of rows: loading, failed, or nothing to show. */
export function ListPlaceholder({
    state,
    message,
}: {
    state: "loading" | "error" | "empty";
    message?: string;
}) {
    if (state === "loading") {
        return (
            <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        );
    }

    if (state === "error") {
        return (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                <p className="text-sm text-destructive">{message ?? "Couldn't load this list. Please try again."}</p>
            </div>
        );
    }

    return (
        <div className="bg-muted/30 rounded-lg px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{message ?? "Nothing to show."}</p>
        </div>
    );
}
