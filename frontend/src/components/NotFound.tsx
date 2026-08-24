// src/components/NotFound.tsx
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Bus, Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
    return (
        <div className="mx-auto w-full max-w-md px-4 py-16 text-center flex flex-col items-center min-h-[70vh] justify-center">
            <p className="text-6xl font-bold tracking-tight text-primary/20">404</p>
            <h1 className="text-xl font-semibold mt-2">This route doesn't exist</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Looks like this shuttle took a wrong turn. The page you're
                looking for isn't here.
            </p>

            {/* ── Road + driving bus ─────────────────────────────── */}
            <div className="relative w-full h-28 mt-10 mb-2 overflow-hidden">
                {/* dashed road */}
                <div
                    className="absolute bottom-6 left-0 right-0 h-[3px] rounded-full"
                    style={{
                        backgroundImage:
                            "repeating-linear-gradient(90deg, var(--border) 0 16px, transparent 16px 32px)",
                    }}
                />
                {/* bus, driving left→right then looping */}
                <div className="absolute bottom-6 animate-drive">
                    <div className="relative -translate-y-full">
                        <div className="h-10 w-14 rounded-lg bg-primary/10 border-2 border-primary flex items-center justify-center shadow-sm animate-bounce-soft">
                            <Bus className="h-5 w-5 text-primary" />
                        </div>
                        {/* wheels */}
                        <span className="absolute -bottom-1.5 left-2 h-2 w-2 rounded-full bg-foreground/70" />
                        <span className="absolute -bottom-1.5 right-2 h-2 w-2 rounded-full bg-foreground/70" />
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
                <Button

                    variant="outline"
                    size="lg"
                    className="gap-2 h-11 px-5"
                >
                    <Link to="/" className="flex items-center gap-2">
                        <ArrowLeft className="h-4 w-4" />
                        Go back
                    </Link>
                </Button>
                <Button

                    size="lg"
                    className="gap-2 h-11 px-5"
                >
                    <Link to="/" className="flex items-center gap-2">
                        <Home className="h-4 w-4" />
                        Home
                    </Link>
                </Button>
            </div>

            {/* Scoped keyframes — no Tailwind config changes needed */}
            <style>{`
                @keyframes drive {
                    0%   { left: -4rem; }
                    100% { left: 100%; }
                }
                .animate-drive {
                    animation: drive 3.2s linear infinite;
                }
                @keyframes bounce-soft {
                    0%, 100% { transform: translateY(0); }
                    50%      { transform: translateY(-3px); }
                }
                .animate-bounce-soft {
                    animation: bounce-soft 0.5s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}