// src/hooks/useRoute.ts
import { useQuery } from "@tanstack/react-query"
import { getRouteRequest } from "@/api/routeApi"
import type { Route } from "@/api/routeApi"

interface UseRouteResult {
    route: Route | undefined
    origin: string | undefined
    destination: string | undefined
    description: string | undefined
    stages: string[] | undefined
    fare: number | undefined
    isActive: boolean | undefined
    isLoading: boolean
    isError: boolean
    error: Error | null
}

export function useRoute(routeId?: string): UseRouteResult {
    const { data: route, isLoading, isError, error } = useQuery({
        queryKey: ["routes", "detail", routeId],
        queryFn: () => getRouteRequest(routeId!),
        enabled: !!routeId,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    })

    return {
        route,
        origin: route?.origin,
        destination: route?.destination,
        description: route?.description,
        stages: route?.stages,
        fare: route?.fare,
        isActive: route?.isActive,
        isLoading,
        isError,
        error: error as Error | null,
    }
}



export function useRouteName(routeId?: string) {
    const { data: route } = useQuery({
        queryKey: ["routes", "detail", routeId],
        queryFn: () => getRouteRequest(routeId!),
        enabled: !!routeId,
        staleTime: 5 * 60 * 1000,
    })

    if (!route) return undefined
    return `${route.origin} → ${route.destination}`
}