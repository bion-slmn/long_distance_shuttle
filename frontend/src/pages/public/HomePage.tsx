// src/app/page.tsx

import HomePage from "@/components/page";
import { useAuth } from "@/features/auth/AuthContext";
import { Navigate } from "react-router-dom";

export default function Page() {
    const { isAuthenticated, isLoading } = useAuth()

    if (isLoading) {
        return null // or a small spinner — avoid flashing the public page before auth resolves
    }

    if (isAuthenticated) {
        return <Navigate to="/dashboard" replace />
    }

    return <HomePage />
}