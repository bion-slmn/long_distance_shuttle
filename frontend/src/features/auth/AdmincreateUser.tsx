// src/features/admin/AdminCreateUser.tsx
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

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

// ─── Schema ──────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
    { value: "SACCO_ADMIN", label: "Sacco Manager" },
    { value: "CLERK", label: "Clerk" },
    { value: "DRIVER", label: "Driver" },
] as const

const createUserSchema = z
    .object({
        fullName: z.string().min(2, "Full name is required"),
        email: z.string().email("Invalid email").optional().or(z.literal("")),
        phoneNumber: z.string().min(10, "Enter a valid phone number").optional().or(z.literal("")),
        password: z.string().min(8, "Password must be at least 8 characters"),
        role: z.enum(["SACCO_ADMIN", "CLERK", "DRIVER"], { required_error: "Select a role" }),
        saccoId: z.string().min(1, "Sacco ID is required"),
    })
    .refine((d) => !!d.email || !!d.phoneNumber, {
        message: "Provide either an email or phone number",
        path: ["email"],
    })

type CreateUserFormValues = z.infer<typeof createUserSchema>

// ─── Component ───────────────────────────────────────────────────────────────
interface AdminCreateUserProps {
    onCreated?: () => void
}

export default function AdminCreateUser({ onCreated }: AdminCreateUserProps) {
    const form = useForm<CreateUserFormValues>({
        resolver: zodResolver(createUserSchema),
        defaultValues: { fullName: "", email: "", phoneNumber: "", password: "", saccoId: "" },
    })

    const staffMutation = useMutation({
        mutationFn: (payload: CreateStaffPayload) => createStaffRequest(payload),
        onSuccess: () => { toast.success("Account created"); form.reset() },
        onError: (error: any) => toast.error(error?.response?.data?.message ?? "Failed to create account."),
    })

    const managerMutation = useMutation({
        mutationFn: (payload: CreateManagerPayload) => createManagerRequest(payload),
        onSuccess: () => { toast.success("Sacco manager created"); form.reset() },
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

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle>Add a user</CardTitle>
                <CardDescription>Create a staff account or onboard a Sacco manager</CardDescription>
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

                        <Controller
                            name="password"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="password">Password</FieldLabel>
                                    <Input {...field} id="password" type="password" placeholder="••••••••" aria-invalid={fieldState.invalid} autoComplete="new-password" />
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                            )}
                        />

                        <Button type="submit" className="w-full" disabled={isPending}>
                            {isPending ? "Creating..." : "Create user"}
                        </Button>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}