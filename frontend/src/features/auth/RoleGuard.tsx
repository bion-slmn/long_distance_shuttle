// src/components/auth/RoleGuard.tsx
import { type ReactNode } from "react"
import { useAuth } from "@/features/auth/AuthContext"

type Role = "SUPER_ADMIN" | "SACCO_ADMIN" | "CLERK"

export const ALL_ADMINS: Role[] = ["SUPER_ADMIN", "SACCO_ADMIN"]
export const SUPER_ADMIN: Role[] = ["SUPER_ADMIN"]

interface RoleGuardProps {
    allowed: Role[]
    children: ReactNode
    fallback?: ReactNode // optional: render something else instead of nothing
}

export function RoleGuard({ allowed, children, fallback = null }: RoleGuardProps) {
    const { user } = useAuth()

    if (!user?.role || !allowed.includes(user.role as Role)) {
        return <>{fallback}</>
    }

    return <>{children}</>
}