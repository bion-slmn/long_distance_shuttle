// App.tsx
import './App.css'

import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import ProtectedRoute from './features/auth/ProtectedRoute'
import { DashboardLayout } from './layouts/DashboardLayout'
import { PublicLayout } from './layouts/PublicLayout'
import MyTickets from './components/MyTickets'
import VerifyReceipt from './features/booking/VerifyReceipt'
import NotFound from './components/NotFound'

// Public pages
const HomePage = lazy(() => import('./components/page'))
const LoginPage = lazy(() => import('./pages/auth/login'))
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'))
const BookTicket = lazy(() => import('./features/booking/BookTicket'))

// Dashboard pages
const SaccoPage = lazy(() => import('./pages/dashboard/saccoPage'))
const SaccoPageSettings = lazy(() =>
  import('./pages/dashboard/saccoPage').then((m) => ({ default: m.SaccoPageSettings }))
)
const RoutePage = lazy(() => import('./pages/dashboard/routePage'))
const FleetPage = lazy(() => import('./pages/dashboard/FleetPage'))
const Trippage = lazy(() => import('./pages/dashboard/tripPage'))
const RouteQueueView = lazy(() =>
  import('./features/queue/RouteQueueView').then((m) => ({ default: m.RouteQueueView }))
)
const Dashboard = lazy(() =>
  import('./features/dashboard/dashboard').then((m) => ({ default: m.Dashboard }))
)
const SaccoUsersTable = lazy(() =>
  import('./features/sacco/SaccoUsersView').then((m) => ({ default: m.SaccoUsersTable }))
)
const Profile = lazy(() =>
  import('./features/auth/Profile').then((m) => ({ default: m.Profile }))
)
const PaymentsList = lazy(() => import('./features/payments/PaymentsList'))
const BookingsList = lazy(() => import('./features/booking/BookingsList'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
    </div>
  )
}

function App() {
  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Public routes with navbar + footer */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/book" element={<BookTicket />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path='/ticket' element={<MyTickets />} />
            <Route path="/verify/:bookingId" element={<VerifyReceipt />} />
          </Route>

          {/* Protected routes with dashboard layout */}
          <Route
            element={
              <ProtectedRoute allowedRoles={["SUPER_ADMIN", "SACCO_ADMIN", "CLERK"]}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/sacco" element={<SaccoPage />} />
            <Route path="/routes" element={<RoutePage />} />
            <Route path="/vehicles" element={<FleetPage />} />
            <Route path="/routeQueue" element={<RouteQueueView />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/users-saccos" element={<SaccoUsersTable />} />
            <Route path="/trips" element={<Trippage />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<SaccoPageSettings />} />
            <Route path="/payments" element={<PaymentsList />} />
            <Route path="/bookings-report" element={<BookingsList />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
    </div>
  );
}

export default App