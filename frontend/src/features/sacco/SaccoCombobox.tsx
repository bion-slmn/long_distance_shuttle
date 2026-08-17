// src/features/sacco/SaccoCombobox.tsx (or wherever this lives)
import { EntityCombobox } from "@/components/EntityCombobox"
import { getSaccosRequest, type Sacco } from "@/api/saccoApi"
import { useAuth } from "@/features/auth/AuthContext"
import { useSaccoName } from "@/hooks/useSaccoName"
import { Input } from "@/components/ui/input"
import { useEffect } from "react"

interface SaccoComboboxProps {
    value?: string
    onChange: (id: string) => void
    disabled?: boolean
    placeholder?: string
}

export function SaccoCombobox({
    value,
    onChange,
    disabled,
    placeholder = "Select a sacco...",
}: SaccoComboboxProps) {
    const { user } = useAuth()
    const isScopedToOwnSacco = user?.role === "SACCO_ADMIN" || user?.role === "CLERK"

    // For scoped roles, lock the field to their own sacco and skip the fetch entirely
    if (isScopedToOwnSacco) {
        return (
            <LockedSaccoField saccoId={user?.saccoId!} onChange={onChange} value={value} />
        )
    }

    return (
        <EntityCombobox<Sacco>
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            searchPlaceholder="Search saccos..."
            emptyText="No sacco found."
            queryKey={["saccos", "combobox"]}
            fetchFn={({ page, limit, search }) =>
                getSaccosRequest({
                    includeInactive: false,
                    page,
                    limit,
                    minimalFields: true,
                    search,
                })
            }
            getId={(sacco) => sacco.id}
            getLabel={(sacco) => sacco.name}
        />
    )
}

function LockedSaccoField({
    saccoId,
    value,
    onChange,
}: {
    saccoId?: string
    value?: string
    onChange: (id: string) => void
}) {
    const saccoName = useSaccoName(saccoId)

    useEffect(() => {
        if (saccoId && value !== saccoId) {
            onChange(saccoId)
        }
    }, [saccoId, value, onChange])

    return (
        <Input
            value={saccoName ?? "Loading..."}
            readOnly
            className="bg-muted/40 text-foreground cursor-default focus-visible:ring-0"
        />
    )
}