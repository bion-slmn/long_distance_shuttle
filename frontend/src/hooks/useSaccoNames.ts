// src/hooks/useSaccoNames.ts
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { getSaccosRequest } from "@/api/saccoApi"

/**
 * Sacco id → name for every sacco the caller can see, in ONE request.
 *
 * Replaces calling useSaccoName(route.saccoId) once per card: the backend
 * scopes GET /saccos to the caller's own sacco for CLERK/SACCO_ADMIN, so this
 * is a single small response instead of one round trip per distinct sacco.
 */
export function useSaccoNames() {
    const { data } = useQuery({
        queryKey: ["saccos", "name-map"],
        queryFn: () => getSaccosRequest({ limit: 100, minimalFields: true }),
        staleTime: 30 * 60 * 1000,
    })

    return useMemo(() => {
        const map = new Map<string, string>()
        for (const sacco of data?.data ?? []) map.set(sacco.id, sacco.name)
        return map
    }, [data])
}
