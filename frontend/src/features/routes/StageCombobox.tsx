// src/components/comboboxes/StageCombobox.tsx

import { EntityCombobox } from "@/components/EntityCombobox"
import { getRoutesRequest, type Route } from "@/api/routeApi"

interface StageOption {
    id: string
    name: string
}

interface StageComboboxProps {
    value?: string
    onChange: (stage: string) => void
    disabled?: boolean
    placeholder?: string
}

export function StageCombobox({
    value,
    onChange,
    disabled,
    placeholder = "Select a stage/office...",
}: StageComboboxProps) {
    return (
        <EntityCombobox<StageOption>
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            searchPlaceholder="Search stage..."
            emptyText="No stage found."
            queryKey={["stages", "combobox"]}
            fetchFn={async ({ page, limit, search }) => {
                const routes = await getRoutesRequest()

                const locations = new Set<string>()

                routes.forEach((route: Route) => {
                    if (route.origin?.trim()) {
                        locations.add(route.origin.trim())
                    }

                    if (route.destination?.trim()) {
                        locations.add(route.destination.trim())
                    }
                })

                const all: StageOption[] = [...locations]
                    .sort((a, b) => a.localeCompare(b))
                    .map((name) => ({
                        id: name,
                        name,
                    }))

                const filtered = search
                    ? all.filter((stage) =>
                        stage.name
                            .toLowerCase()
                            .includes(search.toLowerCase())
                    )
                    : all

                const start = (page - 1) * limit
                const data = filtered.slice(start, start + limit)

                return {
                    data,
                    total: filtered.length,
                    page,
                    limit,
                    totalPages: Math.ceil(filtered.length / limit) || 1,
                }
            }}
            getId={(stage) => stage.id}
            getLabel={(stage) => stage.name}
        />
    )
}