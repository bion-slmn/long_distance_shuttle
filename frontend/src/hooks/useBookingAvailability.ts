// hooks/booking/useBookingAvailability.ts
import { getBookingAvailabilityRequest } from "@/api/bookingApi";
import { AVAILABILITY_REFETCH_INTERVAL } from "@/lib/bookingUtils";
import { useQuery } from "@tanstack/react-query";


export function useBookingAvailability(
    routeId: string | undefined,
    travelDate: string,
    isActive: boolean
) {
    return useQuery({
        queryKey: ["booking-availability", routeId, travelDate],
        queryFn: () => getBookingAvailabilityRequest(routeId!, travelDate),
        enabled: !!routeId && isActive,
        staleTime: 15 * 1000,
        refetchInterval: isActive ? AVAILABILITY_REFETCH_INTERVAL : false,
    });
}