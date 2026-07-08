// src/features/auth/AuthContext.tsx
import {
    createContext,
    useContext,
    type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { refreshRequest, type AuthResponse } from "@/api/authApi"
import { setAccessToken } from "@/api/axios"

type AuthUser = AuthResponse["user"]

interface AuthContextValue {
    user: AuthUser | null
    isAuthenticated: boolean
    isLoading: boolean
    setSession: (data: AuthResponse) => void
    logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ─── The query itself ─────────────────────────────────────────────────────

function useMeQuery() {
    return useQuery({
        queryKey: ["me"],
        queryFn: async () => {
            const data = await refreshRequest()
            setAccessToken(data.access_token)
            return data.user
        },
        retry: false,
        staleTime: 5 * 60 * 1000,
    })
}

// ─── Provider ────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient()
    const { data: user, isLoading } = useMeQuery()

    // Called by LoginForm/RegisterForm directly on success — no need to
    // refetch, we already have the data from the login/register response.
    function setSession(data: AuthResponse) {
        setAccessToken(data.access_token)
        queryClient.setQueryData(["me"], data.user)
    }

    function logout() {
        setAccessToken(null)
        queryClient.setQueryData(["me"], null)
        // api.post("/auth/logout").catch(() => {})
    }

    const value: AuthContextValue = {
        user: user ?? null,
        isAuthenticated: !!user,
        isLoading,
        setSession,
        logout,
    }

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) {
        throw new Error("useAuth must be used within an AuthProvider")
    }
    return ctx
}