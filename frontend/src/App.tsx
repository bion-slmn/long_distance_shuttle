import './App.css'

import { Routes, Route, Navigate } from 'react-router-dom'
import RegisterForm from './features/auth/RegisterForm'
import LoginForm from './features/auth/LoginForm'
import { Toaster } from 'sonner'
import AdminCreateUser from './features/auth/AdmincreateUser'
import ProtectedRoute from './features/auth/ProtectedRoute'

function App() {
  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/register" element={
          <div className="flex min-h-screen items-center justify-center p-4">
            <RegisterForm />
          </div>
        } />
        <Route path="/login" element={
          <div className="flex min-h-screen items-center justify-center p-4">
            <LoginForm />
          </div>
        } />
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allowedRoles={["SUPER_ADMIN", "SACCO_ADMIN"]}>
              <AdminCreateUser />
            </ProtectedRoute>
          }
        />
      </Routes>
      <Toaster />
    </div>
  )
}

export default App