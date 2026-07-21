import './App.css'

import { Routes, Route, Navigate } from 'react-router-dom'
import RegisterForm from './features/auth/RegisterForm'
import LoginForm from './features/auth/LoginForm'
import { Toaster } from 'sonner'
import AdminCreateUser from './features/auth/AdmincreateUser'
import ProtectedRoute from './features/auth/ProtectedRoute'

import { RouteQueueView } from './features/queue/RouteQueueView'
import LoginPage from './pages/auth/login'
import RegisterPage from './pages/auth/RegisterPage'
import HomePage from './components/page'
import SaccoPage from './pages/dashboard/saccoPage'
import RoutePage from './pages/dashboard/routePage'
import FleetPage from './pages/dashboard/FleetPage'
import { DashboardLayout } from './layouts/DashboardLayout'
import Trippage from './pages/dashboard/tripPage'
import BookTicket from './features/booking/BookTicket'
import { ClerkDashboard } from './pages/dashboard/ClerkDashboard'

function App() {
  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/book" element={<BookTicket />} />
        <Route
          element={
            <ProtectedRoute allowedRoles={["SUPER_ADMIN", "SACCO_ADMIN"]}>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/sacco" element={<SaccoPage />} />
          <Route path="/routes" element={<RoutePage />} />
          <Route path="/vehicles" element={<FleetPage />} />
          <Route path="/routeQueue" element={<RouteQueueView />} />
          <Route path="dashboard-clerk" element={<ClerkDashboard />} />
          <Route path="/trips" element={<Trippage />} />
        </Route>
      </Routes>
      <Toaster />
    </div>
  )
}

export default App
