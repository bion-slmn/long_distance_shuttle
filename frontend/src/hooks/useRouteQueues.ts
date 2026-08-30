// src/hooks/useRouteQueues.ts
import { useMemo } from "react"
import { useQuery, type QueryClient } from "@tanstack/react-query"

import { getQueueEntriesRequest, type QueueEntry } from "@/api/routeApi"

/**
 * One query key for every route's queue on a given day. The grid used to fire
 * one request per route; on a 3G link with ~300ms RTT that fan-out was the
 * dominant cost of opening the page, so it's a single batched request now.
 */
export const routeQueuesKey = (date: string) => ["queue", "all", date] as const

/** Invalidates every queue query — batched grid and per-route detail alike. */
export function invalidateQueues(queryClient: QueryClient) {
    return queryClient.invalidateQueries({ queryKey: ["queue"] })
}

export function useRouteQueues(routeIds: string[], date: string, enabled = true) {
    // Sorted + joined so re-ordering the routes array doesn't churn the key.
    const idsKey = useMemo(() => [...routeIds].sort().join(","), [routeIds])

    const query = useQuery({
        queryKey: [...routeQueuesKey(date), idsKey],
        queryFn: () => getQueueEntriesRequest({ date, routeIds: idsKey.split(",") }),
        enabled: enabled && routeIds.length > 0,
    })

    const entriesByRoute = useMemo(() => {
        const map = new Map<string, QueueEntry[]>()
        for (const entry of query.data ?? []) {
            const routeId = entry.routeQueue?.routeId
            if (!routeId) continue
            const existing = map.get(routeId)
            if (existing) existing.push(entry)
            else map.set(routeId, [entry])
        }
        return map
    }, [query.data])

    return {
        entriesByRoute,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        refetch: query.refetch,
    }
}
