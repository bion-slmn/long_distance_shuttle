// src/features/auth/inviteShare.ts
//
// The ways an admin can get a sign-in link to a new user: copy it, open a
// WhatsApp chat with it, or hand it to the OS share sheet an installed PWA
// gets. Kept apart from the panel component so fast refresh and tests can
// treat them as plain functions.

/** wa.me wants the number as bare digits with the country code, no plus. */
export function toWhatsAppNumber(phone: string): string | null {
    const digits = phone.replace(/\D/g, "")
    if (!digits) return null
    if (/^254[17]\d{8}$/.test(digits)) return digits
    if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`
    if (/^[17]\d{8}$/.test(digits)) return `254${digits}`
    return digits
}

export function whatsAppShareUrl(phone: string | null | undefined, text: string): string | null {
    const number = phone ? toWhatsAppNumber(phone) : null
    const encoded = encodeURIComponent(text)
    // Without a number WhatsApp still opens a contact picker with the text prefilled.
    return number ? `https://wa.me/${number}?text=${encoded}` : `https://wa.me/?text=${encoded}`
}

/**
 * The OS share sheet, which an installed PWA gets on Android and iOS. It is
 * the channel that works no matter how the admin actually reaches the user —
 * SMS, Telegram, email, a saved contact — so it's offered whenever the
 * browser has it, and is the main option when there's no phone number to
 * point WhatsApp at.
 */
export function canNativeShare(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.share === "function"
}

export async function nativeShare(text: string, title: string): Promise<"shared" | "cancelled" | "failed"> {
    try {
        // Text only: some share targets drop `text` when a separate `url` is
        // given, and the link is already inside the message.
        await navigator.share({ title, text })
        return "shared"
    } catch (err) {
        return err instanceof DOMException && err.name === "AbortError" ? "cancelled" : "failed"
    }
}

export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        // Older WebViews and non-secure contexts: fall back to a hidden textarea.
        try {
            const el = document.createElement("textarea")
            el.value = text
            el.setAttribute("readonly", "")
            el.style.position = "fixed"
            el.style.opacity = "0"
            document.body.appendChild(el)
            el.select()
            const ok = document.execCommand("copy")
            document.body.removeChild(el)
            return ok
        } catch {
            return false
        }
    }
}

/**
 * A link is ~120 characters of mostly token. The admin never types it, so
 * the panel shows just enough to recognise it — the host and the start of
 * the token — and the buttons carry the real thing.
 */
export function shortenLink(link: string, tokenChars = 4): string {
    try {
        const url = new URL(link)
        const token = url.searchParams.get("token")
        return token
            ? `${url.host}/…?token=${token.slice(0, tokenChars)}…`
            : `${url.host}${url.pathname}`
    } catch {
        return link.length > 30 ? `${link.slice(0, 30)}…` : link
    }
}
