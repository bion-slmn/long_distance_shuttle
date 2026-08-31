// src/features/auth/SetPasswordForm.tsx
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CheckCircle2, Eye, EyeOff, LinkIcon, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Card, CardContent } from "@/components/ui/card"
import { resetPasswordRequest, verifyPasswordLinkRequest } from "@/api/authApi"

const setPasswordSchema = z
    .object({
        password: z.string().min(8, "Password must be at least 8 characters"),
        confirmPassword: z.string().min(1, "Re-enter your password"),
    })
    .refine((d) => d.password === d.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
    })

type SetPasswordFormValues = z.infer<typeof setPasswordSchema>

export default function SetPasswordForm() {
    const [searchParams] = useSearchParams()
    const token = searchParams.get("token") ?? ""
    const navigate = useNavigate()
    const [showPassword, setShowPassword] = useState(false)

    // Checked up front so an expired link shows an honest message instead of a
    // form the user fills in and then loses.
    const check = useQuery({
        queryKey: ["password-link", token],
        queryFn: () => verifyPasswordLinkRequest(token),
        enabled: !!token,
        retry: false,
    })

    const form = useForm<SetPasswordFormValues>({
        resolver: zodResolver(setPasswordSchema),
        defaultValues: { password: "", confirmPassword: "" },
    })

    const mutation = useMutation({
        mutationFn: (values: SetPasswordFormValues) =>
            resetPasswordRequest(token, values.password),
        onSuccess: (data) => {
            toast.success(data.message)
            navigate("/login", { replace: true })
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message ?? "Could not set your password.")
        },
    })

    if (!token || check.isError || (check.data && !check.data.valid)) {
        return <ExpiredLink />
    }

    if (check.isLoading) {
        return (
            <Card className="w-full max-w-md mx-auto">
                <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Checking your link…
                </CardContent>
            </Card>
        )
    }

    const isInvite = check.data?.purpose === "invite"

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardContent className="pt-6">
                <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
                    <FieldGroup>
                        {check.data?.email && (
                            <div className="flex items-start gap-2.5 rounded-lg bg-muted/50 p-3">
                                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                                <p className="text-sm text-muted-foreground">
                                    {isInvite ? "Setting up" : "Resetting"} the password for{" "}
                                    <span className="font-medium text-foreground">{check.data.email}</span>
                                </p>
                            </div>
                        )}

                        <Controller
                            name="password"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="new-password">New password</FieldLabel>
                                    <div className="relative">
                                        <Input
                                            {...field}
                                            id="new-password"
                                            type={showPassword ? "text" : "password"}
                                            placeholder="At least 8 characters"
                                            aria-invalid={fieldState.invalid}
                                            autoComplete="new-password"
                                            className="pr-10"
                                            autoFocus
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((v) => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                                            tabIndex={-1}
                                            aria-label={showPassword ? "Hide password" : "Show password"}
                                        >
                                            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                        </button>
                                    </div>
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                            )}
                        />

                        <Controller
                            name="confirmPassword"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
                                    <Input
                                        {...field}
                                        id="confirm-password"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="••••••••"
                                        aria-invalid={fieldState.invalid}
                                        autoComplete="new-password"
                                    />
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                            )}
                        />

                        <Button type="submit" className="w-full" disabled={mutation.isPending}>
                            {mutation.isPending
                                ? "Saving..."
                                : isInvite
                                    ? "Set my password"
                                    : "Update my password"}
                        </Button>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}

function ExpiredLink() {
    const navigate = useNavigate()

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardContent className="pt-6 text-center space-y-4">
                <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/10">
                    <LinkIcon className="size-5 text-destructive" />
                </div>
                <div className="space-y-1.5">
                    <p className="font-medium">This link is no longer valid</p>
                    <p className="text-sm text-muted-foreground">
                        Set-password links expire, and each one only works once. Request a fresh
                        link below, or ask your Sacco admin to re-send your invite.
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <Button className="w-full" onClick={() => navigate("/forgot-password")}>
                        Send me a new link
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={() => navigate("/login")}>
                        Back to sign in
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
