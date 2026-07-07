// src/features/auth/LoginForm.tsx
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
} from "@/components/ui/card"
import { loginRequest } from "@/api/authApi"
import { setAccessToken } from "@/api/axios"
import { toast } from "sonner"
import { useAuth } from "./AuthContext"

// ─── Validation schema ───────────────────────────────────────────────────────

const loginSchema = z.object({
    identifier: z.string().min(1, "Enter your email or phone number"),
    password: z.string().min(1, "Password is required"),
})

type LoginFormValues = z.infer<typeof loginSchema>

// ─── Component ───────────────────────────────────────────────────────────────

export default function LoginForm() {
    const navigate = useNavigate()
    const location = useLocation()
    const from = (location.state as { from?: Location })?.from?.pathname ?? "/dashboard"
    const { setSession } = useAuth()



    const form = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            identifier: "",
            password: "",
        },
    })

    const loginMutation = useMutation({
        mutationFn: (values: LoginFormValues) => loginRequest(values),
        onSuccess: (data) => {
            setSession(data)
            toast.success("Signed in successfully")
            navigate(from, { replace: true })
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message ?? "Invalid login credentials.")
        },
    })

    function onSubmit(values: LoginFormValues) {
        loginMutation.mutate(values)
    }

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle>Sign in</CardTitle>
                <CardDescription>
                    Log in to access the SACCO management platform
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form id="login-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup>

                        <Controller
                            name="identifier"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="login-identifier">
                                        Email or phone number
                                    </FieldLabel>
                                    <Input
                                        {...field}
                                        id="login-identifier"
                                        placeholder="jane@example.com or 0712345678"
                                        aria-invalid={fieldState.invalid}
                                        autoComplete="username"
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
                                    <FieldLabel htmlFor="login-password">Password</FieldLabel>
                                    <Input
                                        {...field}
                                        id="login-password"
                                        type="password"
                                        placeholder="••••••••"
                                        aria-invalid={fieldState.invalid}
                                        autoComplete="current-password"
                                    />
                                    {fieldState.invalid && (
                                        <FieldError errors={[fieldState.error]} />
                                    )}
                                </Field>
                            )}
                        />

                        {loginMutation.isError && (
                            <p className="text-sm text-destructive">
                                {(loginMutation.error as any)?.response?.data?.message ??
                                    "Invalid login credentials."}
                            </p>
                        )}

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loginMutation.isPending}
                        >
                            {loginMutation.isPending ? "Signing in..." : "Sign in"}
                        </Button>

                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}