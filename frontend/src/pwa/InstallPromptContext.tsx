import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface InstallPromptContextValue {
    canInstall: boolean;        // true when the native Chrome/Edge/Android prompt is available
    isIOS: boolean;              // true on iOS Safari, where no native prompt exists
    isStandalone: boolean;       // true if already installed / running as an app
    promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

const InstallPromptContext = createContext<InstallPromptContextValue | null>(null);

function detectIOS(): boolean {
    const ua = window.navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
    // iPadOS 13+ reports as Mac, so also check for touch support
    const isIPadOS = ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
    return isIOSDevice || isIPadOS;
}

function detectStandalone(): boolean {
    const isDisplayModeStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (window.navigator as any).standalone === true;
    return isDisplayModeStandalone || isIOSStandalone;
}

export function InstallPromptProvider({ children }: { children: ReactNode }) {
    const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [isStandalone, setIsStandalone] = useState(false);
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        setIsStandalone(detectStandalone());
        setIsIOS(detectIOS());

        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault(); // suppress the browser's own mini-infobar
            setDeferredEvent(e as BeforeInstallPromptEvent);
        };

        const handleAppInstalled = () => {
            setDeferredEvent(null);
            setIsStandalone(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
        if (!deferredEvent) return 'unavailable';
        await deferredEvent.prompt();
        const choice = await deferredEvent.userChoice;
        setDeferredEvent(null); // event can only be used once
        return choice.outcome;
    }, [deferredEvent]);

    const value: InstallPromptContextValue = {
        canInstall: deferredEvent !== null,
        isIOS,
        isStandalone,
        promptInstall,
    };

    return (
        <InstallPromptContext.Provider value={value}>
            {children}
        </InstallPromptContext.Provider>
    );
}

export function useInstallPrompt() {
    const ctx = useContext(InstallPromptContext);
    if (!ctx) {
        throw new Error('useInstallPrompt must be used within an InstallPromptProvider');
    }
    return ctx;
}