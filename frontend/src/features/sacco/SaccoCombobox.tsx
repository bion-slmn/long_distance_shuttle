import { useState, useMemo, useRef, useEffect } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
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
import { getSaccosRequest } from "@/api/saccoApi"

const PAGE_SIZE = 20
const DEBOUNCE_MS = 300

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
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const loadMoreRef = useRef<HTMLDivElement>(null)

    // debounce search -> debouncedSearch, which drives the query key
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
        return () => clearTimeout(t)
    }, [search])

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isFetching,
    } = useInfiniteQuery({
        queryKey: ["saccos", "combobox", debouncedSearch],
        queryFn: ({ pageParam = 1 }) =>
            getSaccosRequest({
                includeInactive: false,
                page: pageParam,
                limit: PAGE_SIZE,
                minimalFields: true,
                search: debouncedSearch,
            }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) =>
            lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
        staleTime: 5 * 60 * 1000,
        enabled: open,
    })

    const saccos = useMemo(
        () => data?.pages.flatMap((page) => page.data) ?? [],
        [data],
    )

    // no client-side filtering — the server already filtered by debouncedSearch
    const selected = saccos.find((s) => s.id === value)

    useEffect(() => {
        if (!open || !hasNextPage) return
        const el = loadMoreRef.current
        if (!el) return

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !isFetchingNextPage) {
                    fetchNextPage()
                }
            },
            { threshold: 1 },
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [open, hasNextPage, isFetchingNextPage, fetchNextPage])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                disabled={disabled}
                className={cn(buttonVariants({ variant: "outline" }), "w-full justify-between font-normal")}
            >
                <span className={cn("truncate", !selected && "text-muted-foreground")}>
                    {selected ? selected.name : placeholder}
                </span>
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search saccos..."
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList className="max-h-64 overflow-y-auto">
                        {(isLoading || (isFetching && debouncedSearch !== search)) && (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            </div>
                        )}

                        {!isLoading && saccos.length === 0 && (
                            <CommandEmpty>No sacco found.</CommandEmpty>
                        )}

                        <CommandGroup>
                            {saccos.map((sacco) => (
                                <CommandItem
                                    key={sacco.id}
                                    value={sacco.id}
                                    onSelect={() => {
                                        onChange(sacco.id)
                                        setOpen(false)
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 size-4",
                                            value === sacco.id ? "opacity-100" : "opacity-0",
                                        )}
                                    />
                                    <span className="truncate">{sacco.name}</span>
                                </CommandItem>
                            ))}
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