import { BookingStatus, getBookingsRequest } from "@/api/bookingApi"
import { useQuery } from "@tanstack/react-query"

export function useVehicleManifest(
    routeId: string | undefined,
    travelDate: string,
    vehicleId: string | undefined,
    enabled: boolean
) {
    const { data: routeBookings, isLoading } = useQuery({
        queryKey: ["bookings", routeId, travelDate],
        queryFn: () => getBookingsRequest({ routeId, travelDate }),
        enabled: enabled && !!routeId,
    })

    const bookings = (routeBookings ?? []).filter(
        (b) => vehicleId && b.trip?.vehicleId === vehicleId && b.status !== BookingStatus.CANCELLED
    )

    return { bookings, isLoading }
}