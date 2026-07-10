// src/hooks/useVehicle.ts
import { useQuery } from "@tanstack/react-query"
import { getFleetVehicleRequest } from "@/api/fleetApi"

export function useVehicle(vehicleId?: string) {
    const { data: vehicle, isLoading, error } = useQuery({
        queryKey: ["fleet", "vehicle", vehicleId],
        queryFn: () => getFleetVehicleRequest(vehicleId!),
        enabled: !!vehicleId,
        staleTime: 5 * 60 * 1000,
    })

    return {
        vehicle,
        numberPlate: vehicle?.numberPlate,
        seatingCapacity: vehicle?.seatingCapacity,
        status: vehicle?.status,
        isLoading,
        error,
    }
}



interface UseVehicleNumberPlateResult {
    numberPlate: string | undefined
    isLoading: boolean
    isError: boolean
    error: Error | null
}

export function useVehicleNumberPlate(vehicleId?: string): UseVehicleNumberPlateResult {
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ["fleet", "vehicle", vehicleId],
        queryFn: () => getFleetVehicleRequest(vehicleId!),
        enabled: !!vehicleId,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    })

    return {
        numberPlate: data?.numberPlate,
        isLoading,
        isError,
        error: error as Error | null,
    }
}