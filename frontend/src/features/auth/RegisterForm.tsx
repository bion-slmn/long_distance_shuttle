// src/features/auth/RegisterForm.tsx
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

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
import { registerRequest, type RegisterPayload } from "@/api/authApi"

// ─── Validation schema ───────────────────────────────────────────────────────

const registerSchema = z
    .object({
        fullName: z.string().min(2, "Full name is required"),
        email: z.string().email("Invalid email").optional().or(z.literal("")),
        phoneNumber: z
            .string()
            .min(10, "Enter a valid phone number")
            .optional()
            .or(z.literal("")),
        password: z.string().min(8, "Password must be at least 8 characters"),
        confirmPassword: z.string(),
        role: z.enum(["SACCO_ADMIN", "DRIVER", "CLERK"], {
            error: "Select a role",
        }),
        saccoId: z.string().optional(),
    })
    .refine((d) => d.password === d.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    })
    .refine((d) => d.email || d.phoneNumber, {
        message: "Provide either an email or phone number",
        path: ["email"],
    })

type RegisterFormValues = z.infer<typeof registerSchema>

// ─── Component ───────────────────────────────────────────────────────────────

export default function RegisterForm() {
    const navigate = useNavigate()

    const form = useForm<RegisterFormValues>({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            fullName: "",
            email: "",
            phoneNumber: "",
            password: "",
            confirmPassword: "",
            saccoId: "",
        },
    })

    const registerMutation = useMutation({
        mutationFn: (payload: RegisterPayload) => registerRequest(payload),
        onSuccess: () => navigate("/login"),
    })

    function onSubmit(values: RegisterFormValues) {
        const { confirmPassword, ...payload } = values
        registerMutation.mutate(payload as RegisterPayload)
    }

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle>Create an account</CardTitle>
                <CardDescription>
                    Register to access the SACCO management platform
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form id="register-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                            <Controller
                                name="fullName"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel htmlFor="reg-fullName">Full name</FieldLabel>
                                        <Input
                                            {...field}
                                            id="reg-fullName"
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
                                        <FieldLabel htmlFor="reg-role">Role</FieldLabel>
                                        <Select
                                            onValueChange={field.onChange}
                                            defaultValue={field.value}
                                        >
                                            <SelectTrigger id="reg-role" aria-invalid={fieldState.invalid}>
                                                <SelectValue placeholder="Select a role" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="SACCO_ADMIN">SACCO Admin</SelectItem>
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
                                        <FieldLabel htmlFor="reg-email">Email</FieldLabel>
                                        <Input
                                            {...field}
                                            id="reg-email"
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
                                        <FieldLabel htmlFor="reg-phone">Phone number</FieldLabel>
                                        <Input
                                            {...field}
                                            id="reg-phone"
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
                                    <FieldLabel htmlFor="reg-saccoId">
                                        SACCO ID <span className="text-muted-foreground">(optional)</span>
                                    </FieldLabel>
                                    <Input
                                        {...field}
                                        id="reg-saccoId"
                                        placeholder="SACCO-001"
                                        aria-invalid={fieldState.invalid}
                                    />
                                    {fieldState.invalid && (
                                        <FieldError errors={[fieldState.error]} />
                                    )}
                                </Field>
                            )}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Controller
                                name="password"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel htmlFor="reg-password">Password</FieldLabel>
                                        <Input
                                            {...field}
                                            id="reg-password"
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

                            <Controller
                                name="confirmPassword"
                                control={form.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel htmlFor="reg-confirmPassword">
                                            Confirm password
                                        </FieldLabel>
                                        <Input
                                            {...field}
                                            id="reg-confirmPassword"
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
                        </div>

                        {registerMutation.isError && (
                            <p className="text-sm text-destructive">
                                {(registerMutation.error as any)?.response?.data?.message ??
                                    "Registration failed. Please try again."}
                            </p>
                        )}

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={registerMutation.isPending}
                        >
                            {registerMutation.isPending ? "Creating account..." : "Register"}
                        </Button>

                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}