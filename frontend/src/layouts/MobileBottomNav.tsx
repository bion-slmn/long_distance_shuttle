// src/components/layout/MobileBottomNav.tsx
import { Link, useLocation } from "react-router-dom"
import { Building2, Route as RouteIcon, Car, Road, LayoutDashboard, MoreHorizontal } from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"

const MOBILE_TABS = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Saccos", href: "/sacco", icon: Building2 },
    { label: "Routes", href: "/routes", icon: RouteIcon },
    { label: "Fleet", href: "/vehicles", icon: Car },
    { label: "Trips", href: "/trips", icon: Road },
]

export function MobileBottomNav() {
    const { pathname } = useLocation()
    const { setOpenMobile } = useSidebar()

    return (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t safe-area-pb">
            <div className="flex items-center justify-around h-14">
                {MOBILE_TABS.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                    return (
                        <Link
                            key={item.href}
                            to={item.href}
                            className={`flex flex-col items-center justify-center gap-0.5 w-full h-full ${active ? "text-primary" : "text-muted-foreground"
                                }`}
                        >
                            <item.icon className="size-5" strokeWidth={active ? 2.5 : 2} />
                            <span className="text-[10px] font-medium">{item.label}</span>
                        </Link>
                    )
                })}

                {/* Opens the full sidebar drawer for "More" (Settings, Payments, Profile, Logout) */}
                <button
                    onClick={() => setOpenMobile(true)}
                    className="flex flex-col items-center justify-center gap-0.5 w-full h-full text-muted-foreground"
                >
                    <MoreHorizontal className="size-5" />
                    <span className="text-[10px] font-medium">More</span>
                </button>
            </div>
        </nav>
    )
}