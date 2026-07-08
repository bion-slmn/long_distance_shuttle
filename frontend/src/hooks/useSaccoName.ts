import { getSaccoByIdRequest } from "@/api/saccoApi"
import { useQuery, } from "@tanstack/react-query"


export function useSaccoName(saccoId?: string) {
    const { data: sacco } = useQuery({
        queryKey: ["saccos", saccoId],
        queryFn: () => getSaccoByIdRequest(saccoId!),
        enabled: !!saccoId, // don't fetch if there's no id
        staleTime: 5 * 60 * 1000,
    })

    return sacco?.name
}