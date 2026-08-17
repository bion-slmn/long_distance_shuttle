// src/components/layout/DashboardLayout.tsx
import { Link, useLocation, Outlet } from "react-router-dom"
import {
    Building2,
    Route as RouteIcon,
    Car,
    Users,
    LogOut,
    ListOrdered,
    Road,
    Book,
    LayoutDashboard,
    Gauge,
    Settings,
    Wallet,
    ClipboardList,
} from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/features/auth/AuthContext"
import { useSaccoName } from "@/hooks/useSaccoName"

interface NavItem {
    label: string
    href: string
    icon: React.ComponentType<{ className?: string }>
    roles: string[]
}

const NAV_ITEMS: NavItem[] = [
    {
        label: "Saccos",
        href: "/sacco",
        icon: Building2,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"],
    },
    {
        label: "Routes",
        href: "/routes",
        icon: RouteIcon,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"],
    },
    {
        label: "Fleet",
        href: "/vehicles",
        icon: Car,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"],
    },
    {
        label: "Trips",
        href: "/trips",
        icon: Road,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"],
    },

    {
        label: "Users",
        href: "/users-saccos",
        icon: LayoutDashboard,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN",],
    },
    {
        label: "Route Queue",
        href: "/routeQueue",
        icon: Gauge,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN"],
    },

    {
        label: "Dashboard",
        href: "/dashboard",
        icon: ListOrdered,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"],
    },
    {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        roles: ["SACCO_ADMIN"],
    },
    {
        label: "Payments",
        href: "/payments",
        icon: Wallet,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"],
    },
    {
        label: "Bookings Report",
        href: "/bookings-report",
        icon: ClipboardList,
        roles: ["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"],
    },

];

function getInitials(name?: string, email?: string) {
    if (name) {
        const parts = name.trim().split(" ")
        return parts.length > 1
            ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
            : parts[0].slice(0, 2).toUpperCase()
    }
    return email?.slice(0, 2).toUpperCase() ?? "?"
}

export function DashboardLayout() {
    const location = useLocation()
    const { user, logout } = useAuth()
    const saccoName = useSaccoName(user?.saccoId!) // adjust field name if it differs on your user object
    const brandLabel = saccoName ?? "Fleet Admin"


    const visibleItems = NAV_ITEMS
        .filter((item) => !user?.role || item.roles.includes(user.role))
        .sort((a, b) => {
            if (a.href === "/dashboard") return -1
            if (b.href === "/dashboard") return 1
            return a.label.localeCompare(b.label)
        })

    return (
        <SidebarProvider>
            <Sidebar collapsible="icon">
                <SidebarHeader>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                            <Building2 className="size-4 text-primary" />
                        </div>
                        <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                            <span className="font-semibold text-sm block truncate">
                                {brandLabel}
                            </span>
                            {user?.role && (
                                <span className="text-[10px] text-muted-foreground block truncate">
                                    {user.role}
                                </span>
                            )}
                        </div>
                    </div>
                </SidebarHeader>

                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {visibleItems.map((item) => {
                                    const active = location.pathname.startsWith(item.href)
                                    return (
                                        <SidebarMenuItem key={item.href}>
                                            <SidebarMenuButton isActive={active} tooltip={item.label}>
                                                <Link to={item.href} className="flex w-full items-center gap-2">
                                                    <item.icon className="size-4 shrink-0" />
                                                    <span>{item.label}</span>
                                                </Link>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    )
                                })}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>

                <SidebarFooter>
                    {user && (
                        <SidebarMenu>
                            <SidebarMenuItem>
                                {/*
                                    Profile lives at its own route rather than in NAV_ITEMS —
                                    it's account-level, not role-gated content, so this footer
                                    block doubles as the entry point instead of a nav row.
                                */}
                                <SidebarMenuButton tooltip="Profile">
                                    <Link
                                        to="/profile"
                                        className="flex w-full items-center gap-2"
                                    >
                                        <Avatar className="size-8 shrink-0">
                                            <AvatarFallback className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 text-xs font-medium">
                                                {getInitials(user.fullName, user.email!)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                                            <p className="truncate text-xs font-medium">
                                                {user.fullName ?? user.email}
                                            </p>
                                            <p className="truncate text-[10px] text-muted-foreground">
                                                {user.role}
                                            </p>
                                        </div>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    )}
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                onClick={logout}
                                tooltip="Log out"
                                className="flex w-full items-center gap-2"
                            >
                                <LogOut className="size-4 shrink-0" />
                                <span>Log out</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
            </Sidebar>

            <SidebarInset>
                <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                    <SidebarTrigger />
                    <Separator orientation="vertical" className="h-4" />
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{brandLabel}</span>
                        {user?.role && (
                            <span className="text-xs text-muted-foreground shrink-0">
                                · {user.role}
                            </span>
                        )}
                    </div>
                </header>

                <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
                    <Outlet />
                </main>
            </SidebarInset>
        </SidebarProvider>
    )
}