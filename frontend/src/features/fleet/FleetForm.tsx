// src/features/fleet/FleetForm.tsx
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { createFleetRequest, updateFleetVehicleRequest, type Vehicle } from "@/api/fleetApi"
import { SaccoCombobox } from "@/features/sacco/SaccoCombobox"

// ─── Validation Schema ───────────────────────────────────────────────────────

const fleetSchema = z.object({
    numberPlate: z
        .string()
        .min(1, "Number plate is required")
        .regex(/^[A-Z0-9\s-]{3,10}$/, "Enter a valid number plate"),
    seatingCapacity: z
        .number({ error: "Seating capacity is required" })
        .min(1, "Seating capacity must be at least 1")
        .max(100, "Seating capacity must be at most 100"),
    saccoId: z.string().optional(),
    notes: z.string().optional(),
})

type FleetFormValues = z.infer<typeof fleetSchema>

// ─── Component ───────────────────────────────────────────────────────────────

interface FleetFormProps {
    mode?: "create" | "edit"
    vehicle?: Vehicle | null
    saccoId?: string
    onSuccess?: () => void
    onCancel?: () => void
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

export function FleetForm({
    mode = "create",
    vehicle = null,
    saccoId,
    onSuccess,
    onCancel,
    open,
    onOpenChange,
}: FleetFormProps) {
    const isEditMode = mode === "edit"
    const queryClient = useQueryClient()

    const form = useForm<FleetFormValues>({
        resolver: zodResolver(fleetSchema),
        defaultValues: {
            numberPlate: "",
            seatingCapacity: 0,
            saccoId: saccoId || "",
            notes: "",
        },
    })

    // Populate form with vehicle data when editing
    useEffect(() => {
        if (isEditMode && vehicle) {
            form.reset({
                numberPlate: vehicle.numberPlate,
                seatingCapacity: vehicle.seatingCapacity,
                saccoId: vehicle.saccoId,
                notes: vehicle.notes || "",
            })
        }
    }, [isEditMode, vehicle, form])

    // Create mutation
    const createMutation = useMutation({
        mutationFn: (values: FleetFormValues) =>
            createFleetRequest({
                numberPlate: values.numberPlate,
                seatingCapacity: values.seatingCapacity,
                saccoId: values.saccoId || saccoId || "",
                notes: values.notes,
            }),
        onSuccess: () => {
            toast.success("Vehicle added successfully")
            queryClient.invalidateQueries({ queryKey: ["fleet"] })
            form.reset()
            onSuccess?.()
            onOpenChange?.(false)
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Couldn't add the vehicle. Try again."
            )
        },
    })

    // Update mutation
    const updateMutation = useMutation({
        mutationFn: ({ id, values }: { id: string; values: FleetFormValues }) =>
            updateFleetVehicleRequest(id, {
                numberPlate: values.numberPlate,
                seatingCapacity: values.seatingCapacity,
                notes: values.notes,
            }),
        onSuccess: () => {
            toast.success("Vehicle updated successfully")
            queryClient.invalidateQueries({ queryKey: ["fleet"] })
            onSuccess?.()
            onOpenChange?.(false)
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Couldn't update the vehicle. Try again."
            )
        },
    })

    const isPending = createMutation.isPending || updateMutation.isPending

    function onSubmit(values: FleetFormValues) {
        if (isEditMode && vehicle) {
            updateMutation.mutate({ id: vehicle.id, values })
        } else {
            createMutation.mutate(values)
        }
    }

    const title = isEditMode ? `Edit ${vehicle?.numberPlate}` : "Add Vehicle"
    const description = isEditMode
        ? "Update the vehicle details"
        : "Register a new vehicle to the fleet"

    const formContent = (
        <form id="fleet-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FieldGroup>
                <Controller
                    name="numberPlate"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="number-plate">Number Plate</FieldLabel>
                            <Input
                                id="number-plate"
                                placeholder="KCA 123A"
                                name={field.name}
                                ref={field.ref}
                                value={field.value}
                                onBlur={field.onBlur}
                                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                aria-invalid={fieldState.invalid}
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />

                <Controller
                    name="seatingCapacity"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="seating-capacity">Seating Capacity</FieldLabel>
                            <Input
                                id="seating-capacity"
                                type="number"
                                placeholder="14"
                                name={field.name}
                                ref={field.ref}
                                value={field.value ?? ""}
                                onBlur={field.onBlur}
                                onChange={(e) =>
                                    field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                                }
                                aria-invalid={fieldState.invalid}
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />

                {!saccoId && (
                    <Controller
                        name="saccoId"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="sacco-id">Sacco</FieldLabel>
                                <SaccoCombobox
                                    value={field.value}
                                    onChange={field.onChange}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />
                )}

                <Controller
                    name="notes"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="notes">Notes (optional)</FieldLabel>
                            <Textarea
                                {...field}
                                id="notes"
                                placeholder="Any additional information about the vehicle"
                                rows={3}
                                aria-invalid={fieldState.invalid}
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />
            </FieldGroup>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={onCancel || (() => onOpenChange?.(false))}
                    disabled={isPending}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    className="w-full sm:w-auto"
                    disabled={isPending}
                >
                    {isPending
                        ? (isEditMode ? "Updating..." : "Adding...")
                        : (isEditMode ? "Update Vehicle" : "Add Vehicle")
                    }
                </Button>
            </div>
        </form>
    )

    if (open !== undefined && onOpenChange !== undefined) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{description}</DialogDescription>
                    </DialogHeader>
                    {formContent}
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {formContent}
        </div>
    )
}