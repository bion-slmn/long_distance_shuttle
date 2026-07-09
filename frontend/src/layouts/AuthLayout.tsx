// src/components/layouts/AuthLayout.tsx
import { type ReactNode, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
    Bus,
    Route,
    Users,
    CalendarCheck,
    ChartBar,
    Shield,
    ArrowRight,
    Sparkles
} from "lucide-react"

interface AuthLayoutProps {
    children: ReactNode
    title?: string
    subtitle?: string
}

export default function AuthLayout({
    children,
    title = "Welcome back",
    subtitle = "Sign in to your account to continue"
}: AuthLayoutProps) {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const features = [
        { icon: Bus, label: "Fleet Management" },
        { icon: Route, label: "Route Optimization" },
        { icon: Users, label: "Member Management" },
        { icon: CalendarCheck, label: "Trip Scheduling" },
        { icon: ChartBar, label: "Analytics & Reports" },
        { icon: Shield, label: "Secure Operations" },
    ]

    return (
        <div className="min-h-screen grid lg:grid-cols-2 bg-background">
            {/* Left Panel - Branding & Features */}
            <div className="hidden lg:flex relative flex-col justify-center bg-gradient-to-br from-primary via-primary/90 to-primary/80 text-primary-foreground p-12 xl:p-16 overflow-hidden">
                {/* Background Pattern */}
                <div className="absolute inset-0 bg-[url('/patterns/grid.svg')] opacity-10" />
                <div className="absolute -top-40 -right-40 size-80 rounded-full bg-primary-foreground/5 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 size-80 rounded-full bg-primary-foreground/5 blur-3xl" />

                <div className={cn(
                    "relative z-10 max-w-md space-y-8 transition-all duration-700",
                    mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                )}>
                    {/* Logo/Brand */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-primary-foreground/10 p-2 backdrop-blur-sm">
                                <Bus className="size-8" />
                            </div>
                            <h1 className="text-4xl xl:text-5xl font-bold tracking-tight">
                                ShuttleOps
                            </h1>
                        </div>
                        <p className="text-lg text-primary-foreground/80 font-light leading-relaxed max-w-sm">
                            Modern SACCO Operations Management Platform
                        </p>
                    </div>

                    {/* Features Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        {features.map(({ icon: Icon, label }, index) => (
                            <div
                                key={index}
                                className={cn(
                                    "flex items-center gap-2.5 rounded-lg bg-primary-foreground/10 p-3 backdrop-blur-sm transition-all hover:bg-primary-foreground/20",
                                    "border border-primary-foreground/5"
                                )}
                                style={{
                                    transitionDelay: `${index * 50}ms`
                                }}
                            >
                                <Icon className="size-4 shrink-0" />
                                <span className="text-sm font-medium">{label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Trust Badge */}
                    <div className="flex items-center gap-4 pt-2 border-t border-primary-foreground/10">
                        <div className="flex -space-x-2">
                            {[1, 2, 3, 4].map((i) => (
                                <div
                                    key={i}
                                    className="size-8 rounded-full bg-primary-foreground/20 border-2 border-primary ring-2 ring-primary/20"
                                />
                            ))}
                        </div>
                        <div>
                            <p className="text-sm font-medium">Trusted by 100+ SACCOS</p>
                            <p className="text-xs text-primary-foreground/60">Managing 10,000+ vehicles</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Panel - Auth Form */}
            <div className="flex items-center justify-center p-6 sm:p-8 lg:p-12">
                <div className={cn(
                    "w-full max-w-md space-y-6 transition-all duration-700 delay-100",
                    mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                )}>
                    {/* Mobile Header */}
                    <div className="lg:hidden text-center space-y-2">
                        <div className="flex items-center justify-center gap-2">
                            <Bus className="size-6 text-primary" />
                            <h1 className="text-2xl font-bold">ShuttleOps</h1>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Modern SACCO Operations Management
                        </p>
                    </div>

                    {/* Form Header */}
                    <div className="space-y-1.5">
                        <h2 className="text-2xl font-semibold tracking-tight">
                            {title}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {subtitle}
                        </p>
                    </div>

                    {/* Form Content */}
                    <div className="relative">
                        {children}
                    </div>

                    {/* Footer Links */}
                    <div className="text-center text-sm text-muted-foreground">
                        <p>
                            By continuing, you agree to our{" "}
                            <a href="/terms" className="text-primary hover:underline font-medium">
                                Terms of Service
                            </a>
                            {" "}and{" "}
                            <a href="/privacy" className="text-primary hover:underline font-medium">
                                Privacy Policy
                            </a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}