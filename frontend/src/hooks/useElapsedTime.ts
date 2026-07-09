import { useEffect, useState } from "react"

export function useElapsedTime(since: string | Date, intervalMs = 30_000) {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(id)
    }, [intervalMs])

    const sinceMs = new Date(since).getTime()
    const diffMinutes = Math.max(0, Math.floor((now - sinceMs) / 60_000))

    if (diffMinutes < 1) return "just now"
    if (diffMinutes < 60) return `${diffMinutes}m`
    const hours = Math.floor(diffMinutes / 60)
    const mins = diffMinutes % 60
    return `${hours}h ${mins}m`
}