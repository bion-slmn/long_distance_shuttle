// src/hooks/useConnectionQuality.ts
import { useState, useEffect } from "react"

export function useConnectionQuality() {
    const [quality, setQuality] = useState<"fast" | "slow">("fast")

    useEffect(() => {
        const conn = (navigator as any).connection
        if (!conn) return

        const update = () => {
            const saveData = conn.saveData === true
            const slowType = ["slow-2g", "2g", "3g"].includes(conn.effectiveType)
            setQuality(saveData || slowType ? "slow" : "fast")
        }

        update()
        conn.addEventListener("change", update)
        return () => conn.removeEventListener("change", update)
    }, [])

    return quality
}