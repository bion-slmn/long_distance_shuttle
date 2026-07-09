import SaccoListView from "@/features/sacco/SaccoListView";
import { SaccoUsersTable } from "@/hooks/SaccoUsersView";

export default function SaccoPage() {
    return (
        <div className="container py-6">
            <SaccoListView />
            <SaccoUsersTable />
        </div>
    );
}