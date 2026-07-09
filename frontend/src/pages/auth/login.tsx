import AuthLayout from "@/layouts/AuthLayout"
import LoginForm from "@/features/auth/LoginForm"

export default function LoginPage() {
    return (
        <AuthLayout>
            <LoginForm />
        </AuthLayout>
    )
}