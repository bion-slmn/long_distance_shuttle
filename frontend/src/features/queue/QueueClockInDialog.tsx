import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { clockInVehicleRequest, QueueEntryStatus } from "@/api/routeApi"
import { invalidateQueues } from "@/hooks/useRouteQueues"
import { VehicleCombobox } from "@/features/fleet/VehicleCombobox"
import { getRouteRequest } from "@/api/routeApi"
import { SaccoCombobox } from "../sacco/SaccoCombobox"

const clockInSchema = z.object({
    vehicleId: z.string().min(1, "Select a vehicle"),
})

type ClockInValues = z.infer<typeof clockInSchema>

interface QueueClockInDialogProps {
    routeId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    /**
     * No vehicle is boarding on this route yet. When that's true the clerk
     * almost always wants the vehicle they're clocking in to start loading
     * immediately, so the option is offered and pre-selected — one dialog,
     * one request, instead of clock in → find it in the queue → promote.
     */
    bayIsEmpty?: boolean
}

export function QueueClockInDialog({
    routeId,
    open,
    onOpenChange,
    bayIsEmpty = false,
}: QueueClockInDialogProps) {
    const queryClient = useQueryClient()

    // Null means "the clerk hasn't touched the box" — so the answer tracks the
    // bay's live state instead of a stale copy taken when the dialog mounted.
    // Cleared on close, below, so a dismissed dialog doesn't carry an old
    // choice into the next vehicle.
    const [boardingOverride, setBoardingOverride] = useState<boolean | null>(null)
    const startBoarding = bayIsEmpty && (boardingOverride ?? true)

    // Every close path goes through here so the checkbox never carries a
    // choice over from the last vehicle.
    const close = () => {
        setBoardingOverride(null)
        onOpenChange(false)
    }

    // Fetch route details to get the saccoId
    const { data: route } = useQuery({
        queryKey: ["routes", "detail", routeId],
        queryFn: () => getRouteRequest(routeId),
        enabled: !!routeId && open, // Only fetch when dialog is open
    })

    const form = useForm<ClockInValues>({
        resolver: zodResolver(clockInSchema),
        defaultValues: { vehicleId: "" },
    })

    const clockInMutation = useMutation({
        mutationFn: (values: ClockInValues) =>
            clockInVehicleRequest({
                routeId,
                vehicleId: values.vehicleId,
                startBoarding: startBoarding || undefined,
            }),
        onSuccess: (entry) => {
            // The server decides: if another vehicle claimed the bay first,
            // this one is WAITING however the box was ticked. Report what
            // actually happened, not what was asked for.
            toast.success(
                entry.status === QueueEntryStatus.BOARDING
                    ? "Vehicle clocked in — now boarding"
                    : "Vehicle clocked in"
            )
            // Must clear every queue cache entry, not just this route's key:
            // the dashboard grid reads from one batched entry covering all
            // routes, which a ["queue", routeId] prefix does not match.
            invalidateQueues(queryClient)
            form.reset()
            close()
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Couldn't clock in the vehicle. Try again."
            )
        },
    })

    function onSubmit(values: ClockInValues) {
        clockInMutation.mutate(values)
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
        >
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Clock In Vehicle</DialogTitle>
                    <DialogDescription>
                        {startBoarding
                            ? "Add a vehicle and open the boarding bay for this route"
                            : "Add a vehicle to the waiting queue for this route"}
                    </DialogDescription>
                </DialogHeader>

                <form
                    id="clock-in-form"
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-4"
                >
                    <FieldGroup>
                        <Controller
                            name="vehicleId"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="vehicle">Vehicle</FieldLabel>
                                    <VehicleCombobox
                                        value={field.value}
                                        onChange={field.onChange}
                                        placeholder="Select vehicle..."
                                        saccoId={route?.saccoId} // Pass the saccoId to filter vehicles
                                    />
                                    {fieldState.invalid && (
                                        <FieldError errors={[fieldState.error]} />
                                    )}
                                </Field>
                            )}
                        />
                    </FieldGroup>

                    {bayIsEmpty && (
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/40 p-3">
                            <Checkbox
                                checked={startBoarding}
                                onCheckedChange={(checked) => setBoardingOverride(checked === true)}
                                disabled={clockInMutation.isPending}
                                className="mt-0.5"
                            />
                            <span className="text-sm leading-tight">
                                Start boarding right away
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                    Opens the bay so you can sell seats immediately. Nothing is
                                    boarding on this route yet.
                                </span>
                            </span>
                        </label>
                    )}

                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={close}
                            disabled={clockInMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            className="w-full sm:w-auto"
                            disabled={clockInMutation.isPending}
                        >
                            {clockInMutation.isPending
                                ? "Clocking in..."
                                : startBoarding
                                    ? "Clock In & Start Boarding"
                                    : "Clock In"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}