import SaccoListView from "@/features/sacco/SaccoListView";
import { SaccoSettingsPanel } from "@/features/sacco/SaccoSettingsPanel";

export default function SaccoPage() {
    return (
        <div className="container py-6">
            <SaccoListView />
        </div>
    );
}


export function SaccoPageSettings() {
    return (
        <div className="container py-6">
            <SaccoSettingsPanel />
        </div>
    );
}