import './App.css'

import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
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
import SaccoAdminDashboard from './features/dashboard/saccoAdmin'
import SuperAdminDashboard from './features/dashboard/superAdmin'
import { Dashboard } from './features/dashboard/dashboard'
import { SaccoUsersTable } from './features/sacco/SaccoUsersView'
import { Profile } from './features/auth/Profile'

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
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/users-saccos" element={<SaccoUsersTable />} />
          <Route path="/trips" element={<Trippage />} />
          <Route path="/profile" element={<Profile />} />


        </Route>
      </Routes>
      <Toaster />
    </div>
  );
}

export default App
