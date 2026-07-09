import { useState, type ReactNode } from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useEntityCombobox } from "@/hooks/useEntityCombobox"
import type { Paginated } from "@/lib/types"

interface EntityComboboxProps<T> {
    value?: string
    onChange: (id: string) => void
    disabled?: boolean
    placeholder?: string
    searchPlaceholder?: string
    emptyText?: string
    queryKey: string[]
    fetchFn: (options: {
        page: number
        limit: number
        search: string
    }) => Promise<Paginated<T>>
    getId: (item: T) => string
    getLabel: (item: T) => string
    renderItem?: (item: T) => ReactNode
    pageSize?: number
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

export function EntityCombobox<T>({
    value,
    onChange,
    disabled,
    placeholder = "Select...",
    searchPlaceholder = "Search...",
    emptyText = "No results found.",
    queryKey,
    fetchFn,
    getId,
    getLabel,
    renderItem,
    pageSize,
    open: openProp,
    onOpenChange: onOpenChangeProp,
}: EntityComboboxProps<T>) {
    const [internalOpen, setInternalOpen] = useControllableOpen(openProp, onOpenChangeProp)

    const {
        items,
        search,
        setSearch,
        isLoading,
        isFetching,
        debouncedSearch,
        hasNextPage,
        isFetchingNextPage,
        loadMoreRef,
    } = useEntityCombobox<T>({
        queryKey,
        fetchFn,
        enabled: internalOpen,
        pageSize,
    })

    const selected = items.find((item) => getId(item) === value)

    return (
        <Popover open={internalOpen} onOpenChange={setInternalOpen}>
            <PopoverTrigger
                disabled={disabled}
                className={cn(buttonVariants({ variant: "outline" }), "w-full justify-between font-normal")}
            >
                <span className={cn("truncate", !selected && "text-muted-foreground")}>
                    {selected ? getLabel(selected) : placeholder}
                </span>
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={searchPlaceholder}
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList className="max-h-64 overflow-y-auto">
                        {(isLoading || (isFetching && debouncedSearch !== search)) && (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            </div>
                        )}

                        {!isLoading && items.length === 0 && (
                            <CommandEmpty>{emptyText}</CommandEmpty>
                        )}

                        <CommandGroup>
                            {items.map((item) => {
                                const id = getId(item)
                                return (
                                    <CommandItem
                                        key={id}
                                        value={id}
                                        onSelect={() => {
                                            onChange(id)
                                            setInternalOpen(false)
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 size-4",
                                                value === id ? "opacity-100" : "opacity-0",
                                            )}
                                        />
                                        {renderItem ? (
                                            renderItem(item)
                                        ) : (
                                            <span className="truncate">{getLabel(item)}</span>
                                        )}
                                    </CommandItem>
                                )
                            })}
                        </CommandGroup>

                        {hasNextPage && (
                            <div ref={loadMoreRef} className="flex items-center justify-center py-2">
                                {isFetchingNextPage && (
                                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                                )}
                            </div>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

// Small helper so the component works both controlled (parent passes open/onOpenChange)
// and uncontrolled (component manages its own open state) — mirrors your original's implicit uncontrolled usage.
function useControllableOpen(
    openProp: boolean | undefined,
    onOpenChangeProp: ((open: boolean) => void) | undefined,
) {
    const [internalOpen, setInternalOpen] = useState(false)
    const isControlled = openProp !== undefined

    const open = isControlled ? openProp : internalOpen
    const setOpen = (next: boolean) => {
        if (!isControlled) setInternalOpen(next)
        onOpenChangeProp?.(next)
    }

    return [open, setOpen] as const
}