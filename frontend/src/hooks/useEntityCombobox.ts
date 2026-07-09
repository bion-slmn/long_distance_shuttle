import { useState, useEffect, useMemo, useRef } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { Paginated } from "@/lib/types"

const DEBOUNCE_MS = 300

interface UseEntityComboboxOptions<T> {
    queryKey: string[]
    fetchFn: (options: {
        page: number
        limit: number
        search: string
    }) => Promise<Paginated<T>>
    enabled: boolean
    pageSize?: number
}

export function useEntityCombobox<T>({
    queryKey,
    fetchFn,
    enabled,
    pageSize = 20,
}: UseEntityComboboxOptions<T>) {
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const loadMoreRef = useRef<HTMLDivElement>(null)

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
        queryKey: [...queryKey, debouncedSearch],
        queryFn: ({ pageParam = 1 }) =>
            fetchFn({ page: pageParam, limit: pageSize, search: debouncedSearch }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) =>
            lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
        staleTime: 5 * 60 * 1000,
        enabled,
    })

    const items = useMemo(
        () => data?.pages.flatMap((page) => page.data) ?? [],
        [data],
    )

    useEffect(() => {
        if (!enabled || !hasNextPage) return
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
    }, [enabled, hasNextPage, isFetchingNextPage, fetchNextPage])

    return {
        items,
        search,
        setSearch,
        debouncedSearch,
        isLoading,
        isFetching,
        hasNextPage,
        isFetchingNextPage,
        loadMoreRef,
    }
}