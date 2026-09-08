// src/features/admin/AdminCreateUser.tsx
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Link2, UserPlus } from "lucide-react"

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
    type CreatedUserResponse,
} from "@/api/authApi"
import { SaccoCombobox } from "../sacco/SaccoCombobox"
import { StageCombobox } from "../routes/StageCombobox"
import { InviteLinkPanel } from "./InviteLinkPanel"

// ─── Schema ──────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
    { value: "SACCO_ADMIN", label: "Sacco Manager" },
    { value: "CLERK", label: "Clerk" },
    { value: "DRIVER", label: "Driver" },
] as const

const createUserSchema = z
    .object({
        fullName: z.string().min(2, "Full name is required"),
        // One of the two is required: the invite link is the only way this
        // account ever gets a password, and it has to reach them somehow —
        // by email, or by the admin sending it to their phone.
        email: z.string().email("Invalid email").optional().or(z.literal("")),
        phoneNumber: z
            .string()
            .regex(/^(?:\+254|254|0)?[17]\d{8}$/, "Enter a valid Kenyan phone number (e.g. 0712345678)")
            .optional()
            .or(z.literal("")),
        role: z.enum(["SACCO_ADMIN", "CLERK", "DRIVER"]),
        saccoId: z.string().min(1, "Sacco is required"),
        assignedStage: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        if (!data.email && !data.phoneNumber) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["phoneNumber"],
                message: "Enter an email or a phone number so they can receive their sign-in link.",
            })
        }
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
    // The account just created, held so the admin can copy or WhatsApp the
    // invite link before the form clears for the next one.
    const [created, setCreated] = useState<CreatedUserResponse | null>(null)

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

    // The account is created either way. `inviteSent` only says whether the
    // email went out; the link itself is always handed back so the admin can
    // pass it on — which is the only route for a phone-only account.
    function reportCreated(label: string, user: CreatedUserResponse) {
        if (user.inviteSent) {
            toast.success(`${label} — invite emailed to ${user.email}`)
        } else {
            toast.info(`${label}. Share the sign-in link with them below.`)
        }
        setCreated(user)
        form.reset()
        onCreated?.()
    }

    const staffMutation = useMutation({
        mutationFn: (payload: CreateStaffPayload) => createStaffRequest(payload),
        onSuccess: (user) => reportCreated("Account created", user),
        onError: (error: any) => toast.error(error?.response?.data?.message ?? "Failed to create account."),
    })

    const managerMutation = useMutation({
        mutationFn: (payload: CreateManagerPayload) => createManagerRequest(payload),
        onSuccess: (user) => reportCreated("Sacco manager created", user),
        onError: (error: any) => toast.error(error?.response?.data?.message ?? "Failed to create manager account."),
    })

    const isPending = staffMutation.isPending || managerMutation.isPending

    function onSubmit(values: CreateUserFormValues) {
        // Blank optional fields go up as absent, not as "", so the backend's
        // "email or phone" rule sees what the admin actually filled in.
        const cleaned = {
            ...values,
            email: values.email || undefined,
            phoneNumber: values.phoneNumber || undefined,
        }
        if (cleaned.role === "SACCO_ADMIN") {
            const { fullName, email, phoneNumber, saccoId } = cleaned
            managerMutation.mutate({ fullName, email, phoneNumber, saccoId } satisfies CreateManagerPayload)
        } else {
            staffMutation.mutate(cleaned as CreateStaffPayload)
        }
    }
    const role = form.watch("role")

    if (created) {
        return (
            <Card className="w-full max-w-md mx-auto">
                <CardHeader>
                    <CardTitle>{created.fullName} added</CardTitle>
                    <CardDescription>
                        Give them their sign-in link. They'll choose their own password when they open it.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <InviteLinkPanel
                        link={created.inviteLink}
                        fullName={created.fullName}
                        phoneNumber={created.phoneNumber}
                        email={created.email}
                        sent={created.inviteSent}
                    />
                    <Button type="button" variant="outline" className="w-full" onClick={() => setCreated(null)}>
                        <UserPlus className="mr-1.5 size-4" />
                        Add another user
                    </Button>
                </CardContent>
            </Card>
        )
    }

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
                            <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                No password needed. You'll get a sign-in link to copy or send on
                                WhatsApp, and it's emailed too if they have an address. The link
                                works once, lasts 3 days, and can be re-issued from the users list.
                            </p>
                        </div>

                        <Button type="submit" className="w-full" disabled={isPending}>
                            {isPending ? "Creating..." : "Create user & get invite link"}
                        </Button>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}