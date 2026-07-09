import AuthLayout from "@/layouts/AuthLayout"
import RegisterForm from "@/features/auth/RegisterForm"

export default function RegisterPage() {
    return (
        <AuthLayout>
            <RegisterForm />
        </AuthLayout>
    )
}