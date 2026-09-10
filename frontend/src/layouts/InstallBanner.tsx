// src/components/layout/InstallBanner.tsx
import { useEffect, useState } from "react"
import { X, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useInstallPrompt } from "@/pwa/InstallPromptContext"

const DISMISS_KEY = "mss-install-dismissed-at"
const DISMISS_COOLDOWN = 1000 * 60 * 60 * 24 * 7 // don't re-nag for a week
const SHOW_DELAY = 4000 // let the clerk see their queue load first

export function InstallBanner() {
    const { canInstall, isIOS, isStandalone, promptInstall } = useInstallPrompt()
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (isStandalone) return
        if (!canInstall && !isIOS) return

        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
        if (Date.now() - dismissedAt < DISMISS_COOLDOWN) return

        const timer = setTimeout(() => setVisible(true), SHOW_DELAY)
        return () => clearTimeout(timer)
    }, [canInstall, isIOS, isStandalone])

    function dismiss() {
        localStorage.setItem(DISMISS_KEY, String(Date.now()))
        setVisible(false)
    }

    async function handleInstall() {
        const outcome = await promptInstall()
        if (outcome !== "unavailable") dismiss()
    }

    if (!visible) return null

    return (
        <div className="flex items-center justify-between gap-2 border-b bg-primary/5 px-3 py-2 text-xs sm:hidden">
            <span className="flex-1 min-w-0">
                {isIOS
                    ? <>Install ShuttleHub: tap <strong>Share</strong> → <strong>Add to Home Screen</strong></>
                    : "Install ShuttleHub for faster, full-screen access."}
            </span>
            <div className="flex shrink-0 items-center gap-1">
                {!isIOS && (
                    <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={handleInstall}>
                        <Download className="mr-1 size-3" />
                        Install
                    </Button>
                )}
                <Button size="icon" variant="ghost" className="size-7" onClick={dismiss}>
                    <X className="size-3.5" />
                </Button>
            </div>
        </div>
    )
}