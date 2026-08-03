// src/pages/Dashboard.tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import SuperAdminDashboard from "./superAdmin";
import SaccoAdminDashboard from "./saccoAdmin";
import { ClerkDashboard } from "./ClerkDashboard";


export type UserRole = 'SUPER_ADMIN' | 'SACCO_ADMIN' | 'DRIVER' | 'CLERK' | string;

// Add a new role by adding one line here — no branching logic to touch.
const roleDashboards: Partial<Record<UserRole, React.ComponentType>> = {
    SUPER_ADMIN: () => (
        <SuperAdminDashboard
            onRefresh={() => {
                console.log('Refreshing...');
            }}
        />
    ),
    SACCO_ADMIN: SaccoAdminDashboard,
    CLERK: ClerkDashboard,
};

export const Dashboard = () => {
    const { user } = useAuth();
    console.log(user);
    console.log("Role:", user?.role);

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    const DashboardComponent = roleDashboards[user.role];

    if (!DashboardComponent) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                No dashboard configured for role "{user.role}".
            </div>
        );
    }

    return <DashboardComponent />;
};