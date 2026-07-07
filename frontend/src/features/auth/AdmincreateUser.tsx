// src/features/admin/AdminCreateUser.tsx
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    createStaffRequest,
    createManagerRequest,
    type CreateStaffPayload,
    type CreateManagerPayload,
} from "@/api/authApi"

// ─── Shared identifier rule ─────────────────────────────────────────────────
// mirrors RegisterForm: at least one of email/phone is required

const identifierRefinement = <T extends { email?: string; phoneNumber?: string }>(
    d: T,
) => !!d.email || !!d.phoneNumber

// ─── Staff schema (driver/clerk) ────────────────────────────────────────────

const staffSchema = z
    .object({
        fullName: z.string().min(2, "Full name is required"),
        email: z.string().email("Invalid email").optional().or(z.literal("")),
        phoneNumber: z
            .string()
            .min(10, "Enter a valid phone number")
            .optional()
            .or(z.literal("")),
        password: z.string().min(8, "Password must be at least 8 characters"),
        role: z.enum(["DRIVER", "CLERK"], { error: "Select a role" }),
        saccoId: z.string().min(1, "Sacco ID is required"),
    })
    .refine(identifierRefinement, {
        message: "Provide either an email or phone number",
        path: ["email"],
    })

type StaffFormValues = z.infer<typeof staffSchema>

// ─── Manager schema ──────────────────────────────────────────────────────────

const managerSchema = z
    .object({
        fullName: z.string().min(2, "Full name is required"),
        email: z.string().email("Invalid email").optional().or(z.literal("")),
        phoneNumber: z
            .string()
            .min(10, "Enter a valid phone number")
            .optional()
            .or(z.literal("")),
        password: z.string().min(8, "Password must be at least 8 characters"),
        saccoId: z.string().min(1, "Sacco ID is required"),
    })
    .refine(identifierRefinement, {
        message: "Provide either an email or phone number",
        path: ["email"],
    })

type ManagerFormValues = z.infer<typeof managerSchema>

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminCreateUser() {
    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle>Add a user</CardTitle>
                <CardDescription>
                    Create staff accounts or onboard a Sacco manager
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="staff">
                    <TabsList className="w-full">
                        <TabsTrigger value="staff" className="flex-1">
                            Add Staff
                        </TabsTrigger>
                        <TabsTrigger value="manager" className="flex-1">
                            Add Manager
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="staff">
                        <CreateStaffForm />
                    </TabsContent>

                    <TabsContent value="manager">
                        <CreateManagerForm />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    )
}

// ─── Add Staff form ──────────────────────────────────────────────────────────

function CreateStaffForm() {
    const form = useForm<StaffFormValues>({
        resolver: zodResolver(staffSchema),
        defaultValues: {
            fullName: "",
            email: "",
            phoneNumber: "",
            password: "",
            saccoId: "",
        },
    })

    const createStaffMutation = useMutation({
        mutationFn: (payload: CreateStaffPayload) => createStaffRequest(payload),
        onSuccess: () => {
            toast.success("Staff account created")
            form.reset()
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Failed to create staff account.",
            )
        },
    })

    function onSubmit(values: StaffFormValues) {
        createStaffMutation.mutate(values as CreateStaffPayload)
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="pt-4">
            <FieldGroup>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Controller
                        name="fullName"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="staff-fullName">Full name</FieldLabel>
                                <Input
                                    {...field}
                                    id="staff-fullName"
                                    placeholder="Jane Wanjiku"
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />

                    <Controller
                        name="role"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="staff-role">Role</FieldLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger id="staff-role" aria-invalid={fieldState.invalid}>
                                        <SelectValue placeholder="Select a role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="DRIVER">Driver</SelectItem>
                                        <SelectItem value="CLERK">Clerk</SelectItem>
                                    </SelectContent>
                                </Select>
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Controller
                        name="email"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="staff-email">Email</FieldLabel>
                                <Input
                                    {...field}
                                    id="staff-email"
                                    type="email"
                                    placeholder="jane@example.com"
                                    aria-invalid={fieldState.invalid}
                                    autoComplete="email"
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />

                    <Controller
                        name="phoneNumber"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="staff-phone">Phone number</FieldLabel>
                                <Input
                                    {...field}
                                    id="staff-phone"
                                    type="tel"
                                    placeholder="0712345678"
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />
                </div>

                <Controller
                    name="saccoId"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="staff-saccoId">Sacco ID</FieldLabel>
                            <Input
                                {...field}
                                id="staff-saccoId"
                                placeholder="SACCO-001"
                                aria-invalid={fieldState.invalid}
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />

                <Controller
                    name="password"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="staff-password">Password</FieldLabel>
                            <Input
                                {...field}
                                id="staff-password"
                                type="password"
                                placeholder="••••••••"
                                aria-invalid={fieldState.invalid}
                                autoComplete="new-password"
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />

                <Button
                    type="submit"
                    className="w-full"
                    disabled={createStaffMutation.isPending}
                >
                    {createStaffMutation.isPending ? "Creating..." : "Create staff account"}
                </Button>

            </FieldGroup>
        </form>
    )
}

// ─── Add Manager form ────────────────────────────────────────────────────────

function CreateManagerForm() {
    const form = useForm<ManagerFormValues>({
        resolver: zodResolver(managerSchema),
        defaultValues: {
            fullName: "",
            email: "",
            phoneNumber: "",
            password: "",
            saccoId: "",
        },
    })

    const createManagerMutation = useMutation({
        mutationFn: (payload: CreateManagerPayload) => createManagerRequest(payload),
        onSuccess: () => {
            toast.success("Sacco manager created")
            form.reset()
        },
        onError: (error: any) => {
            toast.error(
                error?.response?.data?.message ?? "Failed to create manager account.",
            )
        },
    })

    function onSubmit(values: ManagerFormValues) {
        createManagerMutation.mutate(values as CreateManagerPayload)
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="pt-4">
            <FieldGroup>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Controller
                        name="fullName"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="manager-fullName">Full name</FieldLabel>
                                <Input
                                    {...field}
                                    id="manager-fullName"
                                    placeholder="Jane Wanjiku"
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />

                    <Controller
                        name="saccoId"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="manager-saccoId">Sacco ID</FieldLabel>
                                <Input
                                    {...field}
                                    id="manager-saccoId"
                                    placeholder="SACCO-001"
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Controller
                        name="email"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="manager-email">Email</FieldLabel>
                                <Input
                                    {...field}
                                    id="manager-email"
                                    type="email"
                                    placeholder="jane@example.com"
                                    aria-invalid={fieldState.invalid}
                                    autoComplete="email"
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />

                    <Controller
                        name="phoneNumber"
                        control={form.control}
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="manager-phone">Phone number</FieldLabel>
                                <Input
                                    {...field}
                                    id="manager-phone"
                                    type="tel"
                                    placeholder="0712345678"
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                )}
                            </Field>
                        )}
                    />
                </div>

                <Controller
                    name="password"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="manager-password">Password</FieldLabel>
                            <Input
                                {...field}
                                id="manager-password"
                                type="password"
                                placeholder="••••••••"
                                aria-invalid={fieldState.invalid}
                                autoComplete="new-password"
                            />
                            {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                            )}
                        </Field>
                    )}
                />

                <Button
                    type="submit"
                    className="w-full"
                    disabled={createManagerMutation.isPending}
                >
                    {createManagerMutation.isPending ? "Creating..." : "Create manager account"}
                </Button>

            </FieldGroup>
        </form>
    )
}