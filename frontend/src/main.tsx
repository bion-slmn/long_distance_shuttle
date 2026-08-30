import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './features/auth/AuthContext.tsx'

// Cache lives a full working day so a clerk reopening the app at the stage
// paints the last-known queue immediately instead of a skeleton, then
// revalidates in the background.
const CACHE_MAX_AGE = 1000 * 60 * 60 * 12

// Queries whose answers go stale the moment they're written — persisting
// them would show the clerk a payment state that is no longer true.
const NEVER_PERSIST = new Set(["payment-status", "mpesa-transactions"])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.response?.status === 401 || error?.response?.status === 403) return false
        return failureCount < 2
      },
      // Queue data no longer polls, so a tab regaining focus is the main
      // "the clerk is looking at this again" signal we have.
      refetchOnWindowFocus: true,
      staleTime: 1000 * 60 * 5,
      // Must outlive the persisted cache or restored entries are collected
      // on hydration before anything can read them.
      gcTime: CACHE_MAX_AGE,
    },
  },
})

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "mss-query-cache",
  throttleTime: 2000,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        // Bump when a cached response shape changes so old entries are dropped
        // rather than hydrated into a component that can't read them.
        buster: "v1",
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            if (query.state.status !== "success") return false
            return !NEVER_PERSIST.has(String(query.queryKey[0]))
          },
        },
      }}
    >
      <BrowserRouter>
        <AuthProvider>
          <App />
          <ReactQueryDevtools initialIsOpen={false} />
        </AuthProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
)
