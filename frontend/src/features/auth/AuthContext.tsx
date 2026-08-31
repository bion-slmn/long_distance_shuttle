// src/features/auth/AuthContext.tsx
import {
    createContext,
    useContext,
    type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { logoutRequest, refreshRequest, type AuthResponse } from "@/api/authApi"
import { setAccessToken } from "@/api/axios"
import { useNavigate } from "react-router-dom"

type AuthUser = AuthResponse["user"]

// Everything setSession actually needs. The refresh token never reaches JS —
// it's an httpOnly cookie — so responses that omit it (change-password) are
// perfectly good sessions too.
type SessionData = { access_token: string; user: AuthUser }

interface AuthContextValue {
    user: AuthUser | null
    isAuthenticated: boolean
    isLoading: boolean
    setSession: (data: SessionData) => void
    logout: () => void
    assignedStage: string | null

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
    const navigate = useNavigate()
    const assignedStage = user?.assignedStage ?? null
    // Called by LoginForm/RegisterForm directly on success — no need to
    // refetch, we already have the data from the login/register response.
    function setSession(data: SessionData) {
        setAccessToken(data.access_token)
        queryClient.setQueryData(["me"], data.user)
        // Clear all other leftover cache from a previous session,
        // but leave "me" alone since we just set it explicitly above
        queryClient.removeQueries({
            predicate: (query) => query.queryKey[0] !== "me",
        })
    }

    async function logout() {
        try {
            await logoutRequest()
        } catch {
            // even if this fails (e.g. token already expired), still clear local state
        }
        setAccessToken(null)
        queryClient.clear()
        navigate("/login", { replace: true })   // ← add this
    }

    const value: AuthContextValue = {
        user: user ?? null,
        isAuthenticated: !!user,
        isLoading,
        assignedStage,
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