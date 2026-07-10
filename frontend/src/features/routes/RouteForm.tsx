// src/features/routes/RouteForm.tsx
import { useEffect } from "react"
import { Controller, useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
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
import { createRouteRequest, updateRouteRequest, type Route } from "@/api/routeApi"
import { SaccoCombobox } from "../sacco/SaccoCombobox"
import { Checkbox } from "@/components/ui/checkbox"

// ─── Validation Schema ───────────────────────────────────────────────────────

const routeSchema = z.object({
    origin: z.string().min(1, "Origin is required"),
    destination: z.string().min(1, "Destination is required"),
    description: z.string().optional(),
    fare: z.string().min(1, "Fare is required").regex(/^\d+(\.\d{1,2})?$/, "Enter a valid fare amount"),
    stages: z.array(
        z.object({
            value: z.string().min(1, "Stage cannot be empty"),
        })
    ),
    saccoId: z.string().min(1, "Sacco is required"),
    createReturnLeg: z.boolean().optional(),
})

type RouteFormValues = z.infer<typeof routeSchema>

// ─── Component ───────────────────────────────────────────────────────────────

interface RouteFormProps {
    mode?: "create" | "edit"
    route?: Route | null
    onSuccess?: () => void
    onCancel?: () => void
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

export function RouteForm({
    mode = "create",
    route = null,
    onSuccess,
    onCancel,
    open,
    onOpenChange,
}: RouteFormProps) {
    const isEditMode = mode === "edit"
    const queryClient = useQueryClient()

    const form = useForm<RouteFormValues>({
        resolver: zodResolver(routeSchema),
        defaultValues: {
            origin: "",
            destination: "",
            description: "",
            fare: "",
            stages: [],
            saccoId: "",
            createReturnLeg: false,
        },
    })

    const stagesArray = useFieldArray({
        control: form.control,
        name: "stages",
    })

    // Populate form with route data when editing
    useEffect(() => {
        if (isEditMode && route) {
            form.reset({
                origin: route.origin,
                destination: route.destination,
                description: route.description || "",
                fare: route.fare ? String(route.fare) : "",
                stages: (route.stages || []).map((s) => ({ value: s })),
                saccoId: route.saccoId,
            })
        }
    }, [isEditMode, route, form])

    // Create mutation
    const createMutation = useMutation({
        mutationFn: (values: RouteFormValues) =>
            createRouteRequest({
                origin: values.origin,
                destination: values.destination,
                description: values.description || "",
                fare: parseFloat(values.fare),
                stages: values.stages
                    .map((s) => s.value.trim())
                    .filter((s) => s !== ""),
                saccoId: values.saccoId,
                createReturnLeg: values.createReturnLeg,
            }),
        onSuccess: () => {
            toast.success("Route created successfully")
            queryClient.invalidateQueries({ queryKey: ["routes"] })
            form.reset()
            onSuccess?.()
            onOpenChange?.(false)
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Couldn't create the route. Try again."
            )
        },
    })

    // Update mutation
    const updateMutation = useMutation({
        mutationFn: ({ id, values }: { id: string; values: RouteFormValues }) =>
            updateRouteRequest(id, {
                origin: values.origin,
                destination: values.destination,
                description: values.description || "",
                fare: parseFloat(values.fare),
                stages: values.stages
                    .map((s) => s.value.trim())
                    .filter((s) => s !== ""),
            }),
        onSuccess: () => {
            toast.success("Route updated successfully")
            queryClient.invalidateQueries({ queryKey: ["routes"] })
            onSuccess?.()
            onOpenChange?.(false)
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Couldn't update the route. Try again."
            )
        },
    })

    const isPending = createMutation.isPending || updateMutation.isPending

    function onSubmit(values: RouteFormValues) {
        if (isEditMode && route) {
            updateMutation.mutate({ id: route.id, values })
        } else {
            createMutation.mutate(values)
        }
    }

    const title = isEditMode ? `Edit Route: ${route?.origin} → ${route?.destination}` : "Add Route"
    const description = isEditMode
        ? "Update the route details"
        : "Create a new route for your sacco"

    const formContent = (
        <form id="route-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FieldGroup>
                {/* Sacco Selection */}
                <Controller
                    name="saccoId"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="sacco">Sacco</FieldLabel>
                            <SaccoCombobox
                                value={field.value}
                                onChange={field.onChange}
                                disabled={isEditMode}
                                placeholder="Select a sacco..."
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />

                {/* Origin & Destination */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Controller
                        name="origin"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="origin">Origin</FieldLabel>
                                <Input
                                    {...field}
                                    id="origin"
                                    placeholder="Nairobi"
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />

                    <Controller
                        name="destination"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="destination">Destination</FieldLabel>
                                <Input
                                    {...field}
                                    id="destination"
                                    placeholder="Mombasa"
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />
                </div>

                {/* Fare */}
                <Controller
                    name="fare"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="fare">
                                Fare (KES)
                                <span className="text-xs text-muted-foreground ml-1">per passenger</span>
                            </FieldLabel>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                    KES
                                </span>
                                <Input
                                    {...field}
                                    id="fare"
                                    type="text"
                                    placeholder="500.00"
                                    className="pl-12"
                                    aria-invalid={fieldState.invalid}
                                />
                            </div>
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                                Enter the fare amount per passenger (e.g., 500 or 500.00)
                            </p>
                        </Field>
                    )}
                />

                {/* Description */}
                <Controller
                    name="description"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="description">Description (Optional)</FieldLabel>
                            <Textarea
                                {...field}
                                id="description"
                                placeholder="e.g. Via Kisumu — passes through major town centres"
                                rows={2}
                                aria-invalid={fieldState.invalid}
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />

                {/* Stages */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <FieldLabel className="text-sm font-medium">Stages (Optional)</FieldLabel>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => stagesArray.append({ value: "" })}
                            className="gap-1"
                        >
                            <Plus className="size-3.5" />
                            Add Stage
                        </Button>
                    </div>

                    <div className="space-y-2">
                        {stagesArray.fields.map((field, index) => (
                            <Controller
                                key={field.id}
                                name={`stages.${index}.value`}
                                control={form.control}
                                render={({ field: stageField, fieldState }) => (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            {...stageField}
                                            placeholder={`Stage ${index + 1}`}
                                            className="flex-1"
                                            aria-invalid={fieldState.invalid}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                                            onClick={() => stagesArray.remove(index)}
                                            aria-label="Remove stage"
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                )}
                            />
                        ))}
                        {form.formState.errors.stages && (
                            <p className="text-sm text-destructive">
                                Please fill in or remove empty stages
                            </p>
                        )}
                    </div>

                    {stagesArray.fields.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                            {form.watch("stages").map((stage, index) => (
                                <Badge key={stagesArray.fields[index]?.id ?? index} variant="secondary" className="text-xs">
                                    {stage.value || `Stage ${index + 1}`}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
            </FieldGroup>
            {/* Return leg (create mode only) */}
            {!isEditMode && (
                <Controller
                    name="createReturnLeg"
                    control={form.control}
                    render={({ field }) => (
                        <Field>
                            <label className="flex items-start gap-2 cursor-pointer">
                                <Checkbox
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="text-sm font-medium">
                                        Also create the return route
                                    </span>
                                    <p className="text-xs text-muted-foreground">
                                        Creates {form.watch("destination") || "destination"} → {form.watch("origin") || "origin"} as a separate route automatically.
                                    </p>
                                </span>
                            </label>
                        </Field>
                    )}
                />
            )}

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
                        ? (isEditMode ? "Updating..." : "Creating...")
                        : (isEditMode ? "Update Route" : "Create Route")
                    }
                </Button>
            </div>
        </form>
    )

    if (open !== undefined && onOpenChange !== undefined) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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