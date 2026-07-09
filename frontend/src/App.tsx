import './App.css'

import { Routes, Route, Navigate } from 'react-router-dom'
import RegisterForm from './features/auth/RegisterForm'
import LoginForm from './features/auth/LoginForm'
import { Toaster } from 'sonner'
import AdminCreateUser from './features/auth/AdmincreateUser'
import ProtectedRoute from './features/auth/ProtectedRoute'
import CreateSaccoForm from './features/sacco/CreateSaccoForm'
import SaccoListView from './features/sacco/SaccoListView'
import { FleetListView } from './features/fleet/FleetListView'
import { RouteListView } from './features/routes/RouteListView'
import { RouteQueueView } from './features/queue/RouteQueueView'
import LoginPage from './pages/auth/login'
import RegisterPage from './pages/auth/RegisterPage'
import HomePage from './components/page'
import SaccoPage from './pages/dashboard/saccoPage'
import RoutePage from './pages/dashboard/routePage'
import FleetPage from './pages/dashboard/FleetPage'
import { DashboardLayout } from './layouts/DashboardLayout'

function App() {
  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<HomePage />} />
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
        </Route>
      </Routes>
      <Toaster />
    </div>
  )
}

export default App
