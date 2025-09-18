import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import DashboardPreview from "@/components/DashboardPreview";

export default function PreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { processedData?: any } | null;
  let processedData = state?.processedData;

  // Fallback: read from sessionStorage when opened in a new tab
  if (!processedData) {
    try {
      const cached = sessionStorage.getItem('project_preview_data');
      if (cached) {
        processedData = JSON.parse(cached);
      }
    } catch (_e) {
      // ignore
    }
  }

  return (
    <div className="min-h-screen bg-muted">
      {/* Content */}
      <div>
        <DashboardPreview processedData={processedData} />
      </div>
    </div>
  );
}


