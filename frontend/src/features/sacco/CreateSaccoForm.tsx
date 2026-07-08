// src/features/sacco/SaccoForm.tsx
import { useEffect } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, Pencil } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from "@/components/ui/card"
import { createSaccoRequest, updateSaccoRequest } from "@/api/saccoApi"
import type { Sacco } from "@/api/saccoApi"

// ─── Validation schema ───────────────────────────────────────────────────────

const contactSchema = z.object({
    phone: z
        .string()
        .min(1, "Phone number is required")
        .regex(/^\+?[0-9\s-]{7,15}$/, "Enter a valid phone number"),
    label: z.string().optional(),
})

const emailSchema = z.object({
    address: z.string().min(1, "Email is required").email("Enter a valid email"),
    label: z.string().optional(),
})

const createSaccoSchema = z.object({
    name: z.string().min(2, "Sacco name is required"),
    registrationNumber: z.string().optional(),
    headquarters: z.string().optional(),
    contacts: z.array(contactSchema).min(1, "Add at least one contact number"),
    emails: z.array(emailSchema).optional(),
})

type CreateSaccoFormValues = z.infer<typeof createSaccoSchema>

// ─── Component ───────────────────────────────────────────────────────────────

interface SaccoFormProps {
    mode?: "create" | "edit"
    sacco?: Sacco | null
    onSuccess?: (saccoId: string) => void
    onCancel?: () => void
}

export default function SaccoForm({
    mode = "create",
    sacco = null,
    onSuccess,
    onCancel
}: SaccoFormProps) {
    const isEditMode = mode === "edit"
    const queryClient = useQueryClient()

    const form = useForm<CreateSaccoFormValues>({
        resolver: zodResolver(createSaccoSchema),
        defaultValues: {
            name: "",
            registrationNumber: "",
            headquarters: "",
            contacts: [{ phone: "", label: "" }],
            emails: [],
        },
    })

    const contactsArray = useFieldArray({
        control: form.control,
        name: "contacts",
    })

    const emailsArray = useFieldArray({
        control: form.control,
        name: "emails",
    })

    // Populate form with sacco data when editing
    useEffect(() => {
        if (isEditMode && sacco) {
            form.reset({
                name: sacco.name,
                registrationNumber: sacco.registrationNumber || "",
                headquarters: sacco.headquarters || "",
                contacts: sacco.contacts?.length
                    ? sacco.contacts.map(c => ({
                        phone: c.phone,
                        label: c.label || "",
                    }))
                    : [{ phone: "", label: "" }],
                emails: sacco.emails?.length
                    ? sacco.emails.map(e => ({
                        address: e.email,
                        label: e.label || "",
                    }))
                    : [],
            })
        }
    }, [isEditMode, sacco, form])

    // Create mutation
    const createMutation = useMutation({
        mutationFn: (values: CreateSaccoFormValues) =>
            createSaccoRequest({
                name: values.name,
                registrationNumber: values.registrationNumber || undefined,
                headquarters: values.headquarters || undefined,
                contacts: values.contacts.map((c) => ({
                    phone: c.phone,
                    label: c.label || "",
                })),
                emails: (values.emails ?? []).map((e) => ({
                    email: e.address,
                    label: e.label || "",
                })),
            }),
        onSuccess: (data) => {
            toast.success(`${data.name} was created`)
            queryClient.invalidateQueries({ queryKey: ["saccos"] })
            form.reset()
            onSuccess?.(data.id)
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Couldn't create the sacco. Try again.",
            )
        },
    })

    // Update mutation
    const updateMutation = useMutation({
        mutationFn: ({ id, values }: { id: string; values: CreateSaccoFormValues }) =>
            updateSaccoRequest(id, {
                name: values.name,
                registrationNumber: values.registrationNumber || undefined,
                headquarters: values.headquarters || undefined,
                contacts: values.contacts.map((c) => ({
                    phone: c.phone,
                    label: c.label || "",
                })),
                emails: (values.emails ?? []).map((e) => ({
                    email: e.address,
                    label: e.label || "",
                })),
            }),
        onSuccess: (data) => {
            toast.success(`${data.name} was updated`)
            queryClient.invalidateQueries({ queryKey: ["saccos"] })
            onSuccess?.(data.id)
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Couldn't update the sacco. Try again.",
            )
        },
    })

    const isPending = createMutation.isPending || updateMutation.isPending

    function onSubmit(values: CreateSaccoFormValues) {
        if (isEditMode && sacco) {
            updateMutation.mutate({ id: sacco.id, values })
        } else {
            createMutation.mutate(values)
        }
    }

    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    {isEditMode ? (
                        <>
                            <Pencil className="size-4" />
                            Edit {sacco?.name}
                        </>
                    ) : (
                        "Add a new sacco"
                    )}
                </CardTitle>
                <CardDescription>
                    {isEditMode
                        ? "Update the sacco's details and contact information"
                        : "Register a sacco and its contact details on the platform"
                    }
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form
                    id="sacco-form"
                    onSubmit={form.handleSubmit(onSubmit)}
                >
                    <FieldGroup>
                        {/* ── Basic details ─────────────────────────────────────── */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field
                                data-invalid={!!form.formState.errors.name}
                                className="sm:col-span-2"
                            >
                                <FieldLabel htmlFor="sacco-name">Sacco name</FieldLabel>
                                <Input
                                    id="sacco-name"
                                    placeholder="Umoja Travellers Sacco"
                                    aria-invalid={!!form.formState.errors.name}
                                    {...form.register("name")}
                                />
                                {form.formState.errors.name && (
                                    <FieldError
                                        errors={[form.formState.errors.name]}
                                    />
                                )}
                            </Field>

                            <Field
                                data-invalid={!!form.formState.errors.registrationNumber}
                            >
                                <FieldLabel htmlFor="sacco-reg-number">
                                    Registration number
                                </FieldLabel>
                                <Input
                                    id="sacco-reg-number"
                                    placeholder="CS/2019/00214"
                                    {...form.register("registrationNumber")}
                                />
                            </Field>

                            <Field data-invalid={!!form.formState.errors.headquarters}>
                                <FieldLabel htmlFor="sacco-hq">Headquarters</FieldLabel>
                                <Input
                                    id="sacco-hq"
                                    placeholder="Nairobi, Kenya"
                                    {...form.register("headquarters")}
                                />
                            </Field>
                        </div>

                        <Separator className="my-2" />

                        {/* ── Contacts ──────────────────────────────────────────── */}
                        <div className="flex items-center justify-between">
                            <FieldLabel className="text-base">Contact numbers</FieldLabel>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    contactsArray.append({ phone: "", label: "" })
                                }
                            >
                                <Plus className="size-4" />
                                Add
                            </Button>
                        </div>

                        {form.formState.errors.contacts?.root && (
                            <p className="text-sm text-destructive">
                                {form.formState.errors.contacts.root.message}
                            </p>
                        )}

                        <div className="flex flex-col gap-3">
                            {contactsArray.fields.map((field, index) => (
                                <div
                                    key={field.id}
                                    className="flex flex-col sm:flex-row gap-3 sm:items-start rounded-lg border p-3"
                                >
                                    <Field className="flex-1">
                                        <FieldLabel htmlFor={`contact-phone-${index}`}>
                                            Phone
                                        </FieldLabel>
                                        <Input
                                            id={`contact-phone-${index}`}
                                            placeholder="0712345678"
                                            {...form.register(`contacts.${index}.phone`)}
                                        />
                                        {form.formState.errors.contacts?.[index]?.phone && (
                                            <FieldError
                                                errors={[
                                                    form.formState.errors.contacts[index]?.phone,
                                                ]}
                                            />
                                        )}
                                    </Field>

                                    <Field className="flex-1">
                                        <FieldLabel htmlFor={`contact-label-${index}`}>
                                            Label (optional)
                                        </FieldLabel>
                                        <Input
                                            id={`contact-label-${index}`}
                                            placeholder="Office, Manager..."
                                            {...form.register(`contacts.${index}.label`)}
                                        />
                                    </Field>

                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="self-start sm:self-end shrink-0 text-muted-foreground hover:text-destructive"
                                        disabled={contactsArray.fields.length === 1}
                                        onClick={() => contactsArray.remove(index)}
                                        aria-label="Remove contact"
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>

                        <Separator className="my-2" />

                        {/* ── Emails ────────────────────────────────────────────── */}
                        <div className="flex items-center justify-between">
                            <FieldLabel className="text-base">
                                Email addresses (optional)
                            </FieldLabel>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    emailsArray.append({ address: "", label: "" })
                                }
                            >
                                <Plus className="size-4" />
                                Add
                            </Button>
                        </div>

                        <div className="flex flex-col gap-3">
                            {emailsArray.fields.map((field, index) => (
                                <div
                                    key={field.id}
                                    className="flex flex-col sm:flex-row gap-3 sm:items-start rounded-lg border p-3"
                                >
                                    <Field className="flex-1">
                                        <FieldLabel htmlFor={`email-address-${index}`}>
                                            Email
                                        </FieldLabel>
                                        <Input
                                            id={`email-address-${index}`}
                                            type="email"
                                            placeholder="info@sacco.co.ke"
                                            {...form.register(`emails.${index}.address`)}
                                        />
                                        {form.formState.errors.emails?.[index]?.address && (
                                            <FieldError
                                                errors={[
                                                    form.formState.errors.emails[index]?.address,
                                                ]}
                                            />
                                        )}
                                    </Field>

                                    <Field className="flex-1">
                                        <FieldLabel htmlFor={`email-label-${index}`}>
                                            Label (optional)
                                        </FieldLabel>
                                        <Input
                                            id={`email-label-${index}`}
                                            placeholder="Support, Billing..."
                                            {...form.register(`emails.${index}.label`)}
                                        />
                                    </Field>

                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="self-start sm:self-end shrink-0 text-muted-foreground hover:text-destructive"
                                        onClick={() => emailsArray.remove(index)}
                                        aria-label="Remove email"
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                </div>
                            ))}
                            {emailsArray.fields.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    No email addresses added yet.
                                </p>
                            )}
                        </div>
                    </FieldGroup>
                </form>
            </CardContent>
            <CardFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={onCancel || (() => form.reset())}
                    disabled={isPending}
                >
                    {isEditMode ? "Cancel" : "Reset"}
                </Button>
                <Button
                    type="submit"
                    form="sacco-form"
                    className="w-full sm:w-auto"
                    disabled={isPending}
                >
                    {isPending
                        ? (isEditMode ? "Updating..." : "Creating...")
                        : (isEditMode ? "Update sacco" : "Create sacco")
                    }
                </Button>
            </CardFooter>
        </Card>
    )
}

export function CreateSaccoPage() {
    const handleSuccess = (saccoId: string) => {
        // Navigate to sacco list or details
        console.log("Created sacco with ID:", saccoId)
    }

    return (
        <SaccoForm
            mode="create"
            onSuccess={handleSuccess}
        />
    )
}