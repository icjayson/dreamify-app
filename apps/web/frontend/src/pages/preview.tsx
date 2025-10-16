import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AmazonDashboard from "@/components/project-section/Amazon_Dashboard";
import AmazonDashboardDark from "@/components/project-section/Amazon_Dashboard_Dark";
import DashboardLoading from "@/components/project-section/DashboardLoading";
import { useChatStore } from "@/chat/useChatStore";
import DashboardPreview from "@/components/project-section/DashboardPreview";

export default function PreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const dashboardTheme = useChatStore((s) => s.dashboardTheme);
  const isThemeChanging = useChatStore((s) => s.isThemeChanging);
  const isInitialLoading = useChatStore((s) => s.isInitialLoading);
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
        {isInitialLoading ? (
          <DashboardLoading title="Generating Dashboard" description="Please wait while we build your dashboard..." durationSec={10} />
        ) : isThemeChanging ? (
          <DashboardLoading />
        ) : dashboardTheme === 'dark' ? (
          <DashboardPreview processedData={processedData}/>
        ) : (
          <DashboardPreview processedData={processedData}/>
        )}
      </div>
    </div>
  );
}


