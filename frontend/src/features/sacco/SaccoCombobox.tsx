import { EntityCombobox } from "@/components/EntityCombobox"
import { getSaccosRequest, type Sacco } from "@/api/saccoApi"

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