// src/hooks/useSaccoPaymentOptions.ts
import { useQuery } from "@tanstack/react-query"
import { getSaccoPaymentOptionsRequest } from "@/api/saccoApi"

/**
 * Which payment methods a sacco actually accepts right now.
 *
 * M-Pesa takes two things to be usable — credentials on file
 * (`mpesaConfigured`) and the sacco not having switched it off
 * (`acceptsMpesa`) — so `mpesaEnabled` folds both into the one answer every
 * caller wants. Until the read lands it reports M-Pesa as unavailable, which
 * keeps a clerk from firing an STK push at a sacco that has no shortcode.
 */
export function useSaccoPaymentOptions(saccoId?: string) {
    const query = useQuery({
        queryKey: ["sacco-payment-options", saccoId],
        queryFn: () => getSaccoPaymentOptionsRequest(saccoId!),
        enabled: !!saccoId,
        // Payment configuration changes about as often as a sacco signs a new
        // Daraja contract — no reason to re-read it per booking.
        staleTime: 5 * 60 * 1000,
    })

    return {
        ...query,
        mpesaEnabled: !!query.data?.acceptsMpesa && !!query.data?.mpesaConfigured,
        // Cash is the fallback the sheet defaults to, so an unread or failed
        // settings call must not take it away.
        cashEnabled: query.data?.acceptsCash ?? true,
    }
}
