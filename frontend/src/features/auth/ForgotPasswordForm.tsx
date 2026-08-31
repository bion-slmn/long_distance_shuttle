// src/features/auth/ForgotPasswordForm.tsx
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, MailCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Card, CardContent } from "@/components/ui/card"
import { forgotPasswordRequest } from "@/api/authApi"

const forgotSchema = z.object({
    email: z.string().email("Enter the email address on your account"),
})

type ForgotFormValues = z.infer<typeof forgotSchema>

export default function ForgotPasswordForm() {
    const navigate = useNavigate()
    const form = useForm<ForgotFormValues>({
        resolver: zodResolver(forgotSchema),
        defaultValues: { email: "" },
    })

    const mutation = useMutation({
        mutationFn: (values: ForgotFormValues) => forgotPasswordRequest(values.email),
    })

    // The backend deliberately answers the same way for registered and
    // unregistered addresses, so the UI must not hint at which one it was.
    if (mutation.isSuccess) {
        return (
            <Card className="w-full max-w-md mx-auto">
                <CardContent className="pt-6 text-center space-y-4">
                    <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10">
                        <MailCheck className="size-5 text-primary" />
                    </div>
                    <div className="space-y-1.5">
                        <p className="font-medium">Check your inbox</p>
                        <p className="text-sm text-muted-foreground">
                            If <span className="font-medium text-foreground">{form.getValues("email")}</span>{" "}
                            has an account, we've sent a link to reset the password. It expires in an hour.
                        </p>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
                        <ArrowLeft className="mr-1.5 size-4" />
                        Back to sign in
                    </Button>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardContent className="pt-6">
                <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
                    <FieldGroup>
                        <Controller
                            name="email"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="forgot-email">Email address</FieldLabel>
                                    <Input
                                        {...field}
                                        id="forgot-email"
                                        type="email"
                                        placeholder="jane@example.com"
                                        aria-invalid={fieldState.invalid}
                                        autoComplete="email"
                                        autoFocus
                                    />
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                            )}
                        />

                        {mutation.isError && (
                            <p className="text-sm text-destructive">
                                Something went wrong. Please try again.
                            </p>
                        )}

                        <Button type="submit" className="w-full" disabled={mutation.isPending}>
                            {mutation.isPending ? "Sending..." : "Send reset link"}
                        </Button>

                        <Link
                            to="/login"
                            className="text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Back to sign in
                        </Link>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}
