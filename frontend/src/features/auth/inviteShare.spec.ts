import { afterEach, describe, expect, it, vi } from "vitest";
import { shortenLink, toWhatsAppNumber, whatsAppShareUrl } from "./inviteShare";

describe("toWhatsAppNumber", () => {
    it.each([
        ["0712345678", "254712345678"],
        ["+254 712 345 678", "254712345678"],
        ["254712345678", "254712345678"],
        ["0112345678", "254112345678"],
    ])("turns %s into %s", (input, expected) => {
        expect(toWhatsAppNumber(input)).toBe(expected);
    });

    it("returns null for an empty value", () => {
        expect(toWhatsAppNumber("")).toBeNull();
        expect(toWhatsAppNumber("   ")).toBeNull();
    });
});

describe("whatsAppShareUrl", () => {
    it("targets the number and URL-encodes the message", () => {
        const url = whatsAppShareUrl("0712345678", "Hi Jane, open https://x.test/set?token=a&b");

        expect(url).toBe(
            "https://wa.me/254712345678?text=Hi%20Jane%2C%20open%20https%3A%2F%2Fx.test%2Fset%3Ftoken%3Da%26b",
        );
    });

    it("falls back to the contact picker when there is no phone number", () => {
        expect(whatsAppShareUrl(null, "hello")).toBe("https://wa.me/?text=hello");
        expect(whatsAppShareUrl(undefined, "hello")).toBe("https://wa.me/?text=hello");
    });
});

describe("nativeShare", () => {
    const originalShare = navigator.share

    afterEach(() => {
        Object.defineProperty(navigator, "share", { value: originalShare, configurable: true, writable: true })
    });

    it("reports unsupported browsers as unable to share", async () => {
        Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true })
        const { canNativeShare } = await import("./inviteShare")

        expect(canNativeShare()).toBe(false)
    });

    it("passes the message to the share sheet and reports success", async () => {
        const share = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true })
        const { canNativeShare, nativeShare } = await import("./inviteShare")

        expect(canNativeShare()).toBe(true)
        await expect(nativeShare("Hi Jane, link", "ShuttleHub sign-in link")).resolves.toBe("shared")
        expect(share).toHaveBeenCalledWith({ title: "ShuttleHub sign-in link", text: "Hi Jane, link" })
    });

    it("treats the user closing the sheet as a cancel, not a failure", async () => {
        const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"))
        Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true })
        const { nativeShare } = await import("./inviteShare")

        await expect(nativeShare("x", "t")).resolves.toBe("cancelled")
    });

    it("reports any other rejection as a failure", async () => {
        const share = vi.fn().mockRejectedValue(new Error("boom"))
        Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true })
        const { nativeShare } = await import("./inviteShare")

        await expect(nativeShare("x", "t")).resolves.toBe("failed")
    });
});

describe("shortenLink", () => {
    it("keeps the host and the start of the token", () => {
        const link = "https://shuttlehub.co.ke/set-password?token=abcdef0123456789abcdef0123456789&purpose=invite"

        expect(shortenLink(link)).toBe("shuttlehub.co.ke/…?token=abcd…")
    });

    it("shows host and path when there is no token", () => {
        expect(shortenLink("https://shuttlehub.co.ke/set-password")).toBe("shuttlehub.co.ke/set-password")
    });

    it("falls back to a plain cut for something that is not a URL", () => {
        expect(shortenLink("x".repeat(60))).toBe(`${"x".repeat(30)}…`)
        expect(shortenLink("short")).toBe("short")
    });
});
