// src/features/auth/InviteLinkPanel.tsx
//
// Shown to an admin right after a set-password link is minted. Email is the
// courtesy channel; this panel is the reliable one — a clerk with no inbox
// (or a Resend hiccup) still gets their link because the admin can copy it
// or open it straight into a WhatsApp chat with them.
import { useState } from "react"
import { Check, Copy, MessageCircle, MailCheck, Link2, Share2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { canNativeShare, copyToClipboard, nativeShare, shortenLink, whatsAppShareUrl } from "./inviteShare"

export function InviteLinkPanel({
    link,
    fullName,
    phoneNumber,
    email,
    sent,
    purpose = "invite",
    className,
}: {
    link: string
    fullName: string
    phoneNumber?: string | null
    email?: string | null
    /** Whether the link also went out by email. */
    sent: boolean
    purpose?: "invite" | "reset"
    className?: string
}) {
    const [copied, setCopied] = useState(false)

    const firstName = fullName.trim().split(/\s+/)[0] || fullName
    const message =
        purpose === "invite"
            ? `Hi ${firstName}, your ShuttleHub account is ready. Open this link to set your password (it works once and expires in 3 days): ${link}`
            : `Hi ${firstName}, here is your ShuttleHub password reset link (it works once and expires in 1 hour): ${link}`

    async function handleCopy() {
        const ok = await copyToClipboard(link)
        if (ok) {
            setCopied(true)
            toast.success("Link copied")
            setTimeout(() => setCopied(false), 2000)
        } else {
            toast.error("Couldn't copy — select the link and copy it manually.")
        }
    }

    async function handleShare() {
        const outcome = await nativeShare(message, "ShuttleHub sign-in link")
        if (outcome === "failed") toast.error("Couldn't open the share sheet — copy the link instead.")
    }

    const shareSheet = canNativeShare()
    const heading = sent
        ? `Emailed to ${email}`
        : email
            ? "The email didn't send — share the link directly"
            : `${firstName} has no email — share the link directly`

    return (
        <div className={cn("w-full min-w-0 max-w-full space-y-3 overflow-hidden rounded-lg border bg-muted/30 p-3", className)}>
            <div className="flex min-w-0 items-start gap-2">
                {sent ? (
                    <MailCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : (
                    <Link2 className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1 space-y-0.5">
                    {/* An email address has no break points, so let it wrap
                        anywhere rather than run past the card. */}
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">{heading}</p>
                    <p className="text-xs text-muted-foreground">
                        {purpose === "invite"
                            ? "The link works once and expires in 3 days. Only the person who opens it chooses the password."
                            : "The link works once and expires in 1 hour."}
                    </p>
                </div>
            </div>

            {/* Only a recognisable stub of the link is shown: the full one is
                ~120 characters of token and would push the card open. */}
            <div className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-2 py-1">
                <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={link}>
                    {shortenLink(link)}
                </code>
                <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleCopy} aria-label="Copy link">
                    {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                </Button>
            </div>

            {/* Copy always; WhatsApp when there's a number to send to; the OS
                share sheet whenever the browser offers one. With neither a
                number nor a share sheet, WhatsApp's own contact picker is the
                fallback so there is always a second way out besides copying. */}
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="flex-1" onClick={handleCopy}>
                    <Copy className="mr-1.5 size-3.5" />
                    Copy link
                </Button>
                {(phoneNumber || !shareSheet) && (
                    <Button
                        type="button"
                        variant={phoneNumber ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        onClick={() => window.open(whatsAppShareUrl(phoneNumber, message) ?? "", "_blank", "noopener,noreferrer")}
                    >
                        <MessageCircle className="mr-1.5 size-3.5" />
                        {phoneNumber ? "Send on WhatsApp" : "Share on WhatsApp"}
                    </Button>
                )}
                {shareSheet && (
                    <Button
                        type="button"
                        variant={phoneNumber ? "outline" : "default"}
                        size="sm"
                        className="flex-1"
                        onClick={handleShare}
                    >
                        <Share2 className="mr-1.5 size-3.5" />
                        Share…
                    </Button>
                )}
            </div>
        </div>
    )
}
