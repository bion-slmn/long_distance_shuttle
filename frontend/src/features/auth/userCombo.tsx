import { EntityCombobox } from "@/components/EntityCombobox"
import { getUsersRequest, type User } from "@/api/authApi"

interface UserComboboxProps {
    value?: string
    onChange: (id: string) => void
    disabled?: boolean
    placeholder?: string
    saccoId?: string
}

export function UserCombobox({
    value,
    onChange,
    disabled,
    placeholder = "Select a user...",
    saccoId,
}: UserComboboxProps) {
    return (
        <EntityCombobox<User>
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            searchPlaceholder="Search by full name..."
            emptyText="No user found."
            queryKey={["users", "combobox", ...(saccoId ? [saccoId] : [])]}
            fetchFn={({ page, limit, search }) =>
                getUsersRequest({ page, limit, search, saccoId }).then((res) => ({
                    data: res.data,
                    total: res.meta.total,
                    page: res.meta.page,
                    limit: res.meta.limit,
                    totalPages: res.meta.totalPages,
                }))
            }
            getId={(user) => user.id}
            getLabel={(user) => user.fullName}
            renderItem={(user) => (
                <div className="flex items-center justify-between w-full gap-2 min-w-0">
                    <span className="truncate">{user.fullName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                        {user.role}
                    </span>
                </div>
            )}
        />
    )
}