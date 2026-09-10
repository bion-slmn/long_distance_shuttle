// src/features/auth/AuthContext.tsx
import {
    createContext,
    useContext,
    type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { logoutRequest, refreshRequest, type AuthResponse } from "@/api/authApi"
import { setAccessToken, setRefreshToken, getRefreshToken, clearSession } from "@/api/axios"
import { useNavigate } from "react-router-dom"

type AuthUser = AuthResponse["user"]

// setSession now needs the refresh_token too, since it's our job to persist
// it — there's no cookie doing that for us anymore. change-password's response
// includes a fresh refresh_token as well (rotation), so this isn't optional.
type SessionData = { access_token: string; refresh_token: string; user: AuthUser }

interface AuthContextValue {
    user: AuthUser | null
    isAuthenticated: boolean
    isLoading: boolean
    setSession: (data: SessionData) => void
    logout: () => void
    assignedStage: string | null
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function useMeQuery() {
    const refreshToken = getRefreshToken()

    return useQuery({
        queryKey: ["me"],

        queryFn: async () => {
            console.log("🔥 REFRESH REQUEST RUNNING")

            const data = await refreshRequest()

            console.log("🔥 REFRESH RESPONSE:", data)

            setAccessToken(data.access_token)
            setRefreshToken(data.refresh_token)

            return data.user
        },

        enabled: !!refreshToken,
        retry: false,
        staleTime: 5 * 60 * 1000,
    })
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient()
    const {
        data: user,
        isPending,
        isError,
    } = useMeQuery()

    const navigate = useNavigate()

    const assignedStage = user?.assignedStage ?? null

    function setSession(data: SessionData) {
        setAccessToken(data.access_token)
        setRefreshToken(data.refresh_token)

        queryClient.setQueryData(["me"], data.user)

        queryClient.removeQueries({
            predicate: (query) => query.queryKey[0] !== "me",
        })
    }

    async function logout() {
        try {
            await logoutRequest()
        } catch {
            // ignore
        }

        clearSession()
        queryClient.clear()
        navigate("/login", { replace: true })
    }

    const value: AuthContextValue = {
        user: user ?? null,
        isAuthenticated: !!user,
        isLoading: isPending,
        assignedStage,
        setSession,
        logout,
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) {
        throw new Error("useAuth must be used within an AuthProvider")
    }
    return ctx
}