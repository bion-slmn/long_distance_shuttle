// src/features/auth/AuthContext.tsx
import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react"

import { refreshRequest, type AuthResponse } from "@/api/authApi"
import { setAccessToken } from "@/api/axios"

// ─── Types ───────────────────────────────────────────────────────────────────

type AuthUser = AuthResponse["user"]

interface AuthContextValue {
    user: AuthUser | null
    isAuthenticated: boolean
    isLoading: boolean
    setSession: (data: AuthResponse) => void
    logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Called by LoginForm/RegisterForm on success, and internally after a
    // successful silent refresh — keeps the in-memory token + user in sync.
    function setSession(data: AuthResponse) {
        setAccessToken(data.access_token)
        setUser(data.user)
    }

    function logout() {
        setAccessToken(null)
        setUser(null)
        // refresh_token cookie is httpOnly — clearing it server-side requires
        // hitting a /auth/logout endpoint that clears the cookie; wire that
        // in here once it exists, e.g.:
        // api.post("/auth/logout").catch(() => {})
    }

    // Silent refresh on boot: the in-memory access_token is gone after any
    // page reload, but the httpOnly refresh_token cookie survives. Fire one
    // refresh call before rendering anything that depends on auth state.
    useEffect(() => {
        let cancelled = false

        refreshRequest()
            .then((data) => {
                if (!cancelled) setSession(data)
            })
            .catch(() => {
                if (!cancelled) {
                    setAccessToken(null)
                    setUser(null)
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [])

    const value: AuthContextValue = {
        user,
        isAuthenticated: !!user,
        isLoading,
        setSession,
        logout,
    }

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) {
        throw new Error("useAuth must be used within an AuthProvider")
    }
    return ctx
}