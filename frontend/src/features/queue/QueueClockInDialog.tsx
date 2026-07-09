import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { clockInVehicleRequest } from "@/api/routeApi"
import { VehicleCombobox } from "@/features/fleet/VehicleCombobox"

const clockInSchema = z.object({
    vehicleId: z.string().min(1, "Select a vehicle"),
})

type ClockInValues = z.infer<typeof clockInSchema>

interface QueueClockInDialogProps {
    routeId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function QueueClockInDialog({ routeId, open, onOpenChange }: QueueClockInDialogProps) {
    const queryClient = useQueryClient()

    const form = useForm<ClockInValues>({
        resolver: zodResolver(clockInSchema),
        defaultValues: { vehicleId: "" },
    })

    const clockInMutation = useMutation({
        mutationFn: (values: ClockInValues) =>
            clockInVehicleRequest({ routeId, vehicleId: values.vehicleId }),
        onSuccess: () => {
            toast.success("Vehicle clocked in")
            queryClient.invalidateQueries({ queryKey: ["queue", routeId] })
            form.reset()
            onOpenChange(false)
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
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Clock In Vehicle</DialogTitle>
                    <DialogDescription>
                        Add a vehicle to the waiting queue for this route
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
                                    />
                                    {fieldState.invalid && (
                                        <FieldError errors={[fieldState.error]} />
                                    )}
                                </Field>
                            )}
                        />
                    </FieldGroup>

                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => onOpenChange(false)}
                            disabled={clockInMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            className="w-full sm:w-auto"
                            disabled={clockInMutation.isPending}
                        >
                            {clockInMutation.isPending ? "Clocking in..." : "Clock In"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}