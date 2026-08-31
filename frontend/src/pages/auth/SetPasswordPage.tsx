import AuthLayout from "@/layouts/AuthLayout"
import SetPasswordForm from "@/features/auth/SetPasswordForm"

export default function SetPasswordPage() {
    return (
        <AuthLayout
            title="Choose your password"
            subtitle="Pick something only you know — nobody else, admins included, can see it"
        >
            <SetPasswordForm />
        </AuthLayout>
    )
}
