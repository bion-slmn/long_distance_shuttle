// hooks/booking/useRouteLocations.ts
import { getAvailableLocationsRequest, searchRoutesRequest } from "@/api/routeApi";
import { useQuery } from "@tanstack/react-query";

export function useRouteLocations() {
    return useQuery({
        queryKey: ["route-locations"],
        queryFn: getAvailableLocationsRequest,
        staleTime: 5 * 60 * 1000,
    });
}



export function useRouteSearch(origin: string, destination: string) {
    return useQuery({
        queryKey: ["route-search", origin, destination],
        queryFn: () => searchRoutesRequest(origin, destination),
        enabled: !!origin && !!destination,
        staleTime: 60 * 1000,
    });
}