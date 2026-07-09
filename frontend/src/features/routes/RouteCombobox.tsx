import { EntityCombobox } from "@/components/EntityCombobox"
import { getRoutesRequest, type Route } from "@/api/routeApi"

interface RouteComboboxProps {
    value?: string
    onChange: (id: string) => void
    disabled?: boolean
    placeholder?: string
}

export function RouteCombobox({
    value,
    onChange,
    disabled,
    placeholder = "Select a route...",
}: RouteComboboxProps) {
    return (
        <EntityCombobox<Route>
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            searchPlaceholder="Search routes..."
            emptyText="No route found."
            queryKey={["routes", "combobox"]}
            fetchFn={async ({ page, limit, search }) => {
                // getRoutesRequest currently returns a flat Route[], not paginated —
                // wrap it to match EntityCombobox's expected Paginated<T> shape.
                const all = await getRoutesRequest()
                const filtered = search
                    ? all.filter(
                        (r) =>
                            r.origin.toLowerCase().includes(search.toLowerCase()) ||
                            r.destination.toLowerCase().includes(search.toLowerCase())
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
            getId={(route) => route.id}
            getLabel={(route) => `${route.origin} → ${route.destination}`}
        />
    )
}