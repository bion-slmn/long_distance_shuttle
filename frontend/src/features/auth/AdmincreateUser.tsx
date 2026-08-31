// src/features/admin/AdminCreateUser.tsx
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    createStaffRequest,
    createManagerRequest,
    type CreateStaffPayload,
    type CreateManagerPayload,
} from "@/api/authApi"
import { SaccoCombobox } from "../sacco/SaccoCombobox"
import { StageCombobox } from "../routes/StageCombobox"

// ─── Schema ──────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
    { value: "SACCO_ADMIN", label: "Sacco Manager" },
    { value: "CLERK", label: "Clerk" },
    { value: "DRIVER", label: "Driver" },
] as const

const createUserSchema = z
    .object({
        fullName: z.string().min(2, "Full name is required"),
        // Required, not optional: the invite link is the only way this account
        // ever gets a password.
        email: z.string().min(1, "Email is required").email("Invalid email"),
        phoneNumber: z.string().min(10, "Enter a valid phone number").optional().or(z.literal("")),
        role: z.enum(["SACCO_ADMIN", "CLERK", "DRIVER"]),
        saccoId: z.string().min(1, "Sacco is required"),
        assignedStage: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        if (data.role === "CLERK" && !data.assignedStage) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["assignedStage"],
                message: "Select a stage.",
            })
        }
    })

type CreateUserFormValues = z.infer<typeof createUserSchema>

// ─── Component ───────────────────────────────────────────────────────────────
interface AdminCreateUserProps {
    onCreated?: () => void
}

export default function AdminCreateUser({ onCreated }: AdminCreateUserProps) {
    const form = useForm<CreateUserFormValues>({
        resolver: zodResolver(createUserSchema),
        defaultValues: {
            fullName: "",
            email: "",
            phoneNumber: "",
            saccoId: "",
            role: undefined,
            assignedStage: "",
        },
    })

    // The account is created either way — `inviteSent: false` only means the
    // email didn't go out, which the admin fixes with "Resend invite" on the
    // users table rather than by creating the user again.
    function reportCreated(label: string, inviteSent: boolean, email: string) {
        if (inviteSent) {
            toast.success(`${label} — invite sent to ${email}`)
        } else {
            toast.warning(`${label}, but the invite email didn't send. Resend it from the users list.`)
        }
        form.reset()
        onCreated?.()
    }

    const staffMutation = useMutation({
        mutationFn: (payload: CreateStaffPayload) => createStaffRequest(payload),
        onSuccess: (user) => reportCreated("Account created", user.inviteSent, user.email ?? ""),
        onError: (error: any) => toast.error(error?.response?.data?.message ?? "Failed to create account."),
    })

    const managerMutation = useMutation({
        mutationFn: (payload: CreateManagerPayload) => createManagerRequest(payload),
        onSuccess: (user) => reportCreated("Sacco manager created", user.inviteSent, user.email ?? ""),
        onError: (error: any) => toast.error(error?.response?.data?.message ?? "Failed to create manager account."),
    })

    const isPending = staffMutation.isPending || managerMutation.isPending

    function onSubmit(values: CreateUserFormValues) {
        if (values.role === "SACCO_ADMIN") {
            const { role, ...rest } = values
            managerMutation.mutate(rest as CreateManagerPayload)
        } else {
            staffMutation.mutate(values as CreateStaffPayload)
        }
    }
    const role = form.watch("role")

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle>Add a user</CardTitle>
                <CardDescription>
                    Create a staff account or onboard a Sacco manager — they'll set their own password
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Controller
                                name="fullName"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel htmlFor="fullName">Full name</FieldLabel>
                                        <Input {...field} id="fullName" placeholder="Jane Wanjiku" aria-invalid={fieldState.invalid} />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <Controller
                                name="role"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel htmlFor="role">Role</FieldLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <SelectTrigger id="role" aria-invalid={fieldState.invalid}>
                                                <SelectValue placeholder="Select a role" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {ROLE_OPTIONS.map((r) => (
                                                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                        </div>

                        <Controller
                            name="saccoId"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="saccoId">Sacco</FieldLabel>
                                    <SaccoCombobox value={field.value} onChange={field.onChange} />
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                            )}
                        />

                        {role === "CLERK" && (
                            <Controller
                                name="assignedStage"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Assigned Stage</FieldLabel>

                                        <StageCombobox
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

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Controller
                                name="email"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel htmlFor="email">Email</FieldLabel>
                                        <Input {...field} id="email" type="email" placeholder="jane@example.com" aria-invalid={fieldState.invalid} autoComplete="email" />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <Controller
                                name="phoneNumber"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel htmlFor="phone">Phone number</FieldLabel>
                                        <Input {...field} id="phone" type="tel" placeholder="0712345678" aria-invalid={fieldState.invalid} />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                        </div>

                        <div className="flex items-start gap-2.5 rounded-lg bg-muted/50 p-3">
                            <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                No password needed. We'll email them a link to set their own —
                                it's valid for 3 days, and you can resend it any time from the
                                users list.
                            </p>
                        </div>

                        <Button type="submit" className="w-full" disabled={isPending}>
                            {isPending ? "Creating..." : "Create user & send invite"}
                        </Button>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}