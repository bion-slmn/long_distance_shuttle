import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "./AuthContext"

interface ProtectedRouteProps {
    children: React.ReactNode
    allowedRoles?: string[]
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
    const { isAuthenticated, isLoading, user } = useAuth()
    const location = useLocation()

    if (isLoading) return <div>Loading...</div>
    if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />

    if (allowedRoles && user && !allowedRoles.includes(user.role)) {
        return <Navigate to="/dashboard" replace /> // or a dedicated "403 - not authorized" page
    }

    return <>{children}</>
}