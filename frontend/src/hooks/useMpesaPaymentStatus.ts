// hooks/booking/useMpesaPaymentStatus.ts
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBookingStatusRequest, PaymentMethod, type Booking } from "@/api/bookingApi";
import { MPESA_POLL_INTERVAL, MPESA_TIMEOUT } from "@/lib/bookingUtils";


export function useMpesaPaymentStatus(booking: Booking | null) {
    const [paymentTimedOut, setPaymentTimedOut] = useState(false);

    const isAwaitingMpesa =
        booking?.paymentMethod === PaymentMethod.MPESA &&
        booking?.paymentStatus === "PENDING";

    const statusQuery = useQuery({
        queryKey: ["booking-status", booking?.id],
        queryFn: () => getBookingStatusRequest(booking!.id),
        enabled: isAwaitingMpesa,
        refetchInterval: (query) => {
            const status = query.state.data?.paymentStatus ?? booking?.paymentStatus;
            if (status !== "PENDING") return false;
            const startedAt = booking
                ? new Date(booking.createdAt).getTime()
                : Date.now();
            const elapsed = Date.now() - startedAt;
            if (elapsed > MPESA_TIMEOUT) return false;
            return MPESA_POLL_INTERVAL;
        },
    });

    // Merge status update into existing booking
    useEffect(() => {
        if (statusQuery.data) {
            // We return the data directly, parent will merge it
        }
    }, [statusQuery.data]);

    // Track timeout
    useEffect(() => {
        if (
            isAwaitingMpesa &&
            booking &&
            Date.now() - new Date(booking.createdAt).getTime() > MPESA_TIMEOUT &&
            !statusQuery.isFetching
        ) {
            setPaymentTimedOut(true);
        }
    }, [isAwaitingMpesa, booking, statusQuery.isFetching]);

    return {
        statusQuery,
        isAwaitingMpesa,
        paymentTimedOut,
    };
}