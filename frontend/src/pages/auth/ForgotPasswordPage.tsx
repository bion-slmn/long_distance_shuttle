import AuthLayout from "@/layouts/AuthLayout"
import ForgotPasswordForm from "@/features/auth/ForgotPasswordForm"

export default function ForgotPasswordPage() {
    return (
        <AuthLayout
            title="Forgot your password?"
            subtitle="Enter your email and we'll send you a link to set a new one"
        >
            <ForgotPasswordForm />
        </AuthLayout>
    )
}
