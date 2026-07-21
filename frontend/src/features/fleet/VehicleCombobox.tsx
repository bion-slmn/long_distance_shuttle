// src/features/fleet/VehicleCombobox.tsx
import { EntityCombobox } from "@/components/EntityCombobox"
import { getFleetRequest, type Vehicle } from "@/api/fleetApi"

interface VehicleComboboxProps {
    value?: string
    onChange: (id: string) => void
    disabled?: boolean
    placeholder?: string
    saccoId?: string // Add saccoId prop
}

export function VehicleCombobox({
    value,
    onChange,
    disabled,
    placeholder = "Select a vehicle...",
    saccoId, // Add saccoId prop
}: VehicleComboboxProps) {
    console.log(saccoId, 222222222222222222222)
    return (
        <EntityCombobox<Vehicle>
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            searchPlaceholder="Search by number plate..."
            emptyText="No vehicle found."
            queryKey={["fleet", "combobox", saccoId]} // Include saccoId in query key
            fetchFn={({ page, limit, search }) =>
                getFleetRequest({
                    page,
                    limit,
                    search,
                    saccoId, // Pass saccoId to the API
                    status: "ACTIVE", // Only show active vehicles
                    withQueueStatus: false,
                })
            }
            getId={(vehicle) => vehicle.id}
            getLabel={(vehicle) => vehicle.numberPlate}
            renderItem={(vehicle) => (
                <div className="flex items-center justify-between w-full gap-2 min-w-0">
                    <span className="truncate">{vehicle.numberPlate}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                        {vehicle.seatingCapacity} seats
                    </span>
                </div>
            )}
        />
    )
}