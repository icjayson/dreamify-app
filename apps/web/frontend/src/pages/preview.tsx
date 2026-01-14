import { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AmazonDashboard from "@/components/project-section/Amazon_Dashboard";
import AmazonDashboardDark from "@/components/project-section/Amazon_Dashboard_Dark";
import DashboardLoading from "@/components/project-section/DashboardLoading";
import { useChatStore } from "@/chat/useChatStore";
import DashboardPreview from "@/components/project-section/DashboardPreview";
import { projectService } from "@/services/projectService";
import { conversationService } from "@/services/conversationService";

export default function PreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const dashboardTheme = useChatStore((s) => s.dashboardTheme);
  const isThemeChanging = useChatStore((s) => s.isThemeChanging);
  const isInitialLoading = useChatStore((s) => s.isInitialLoading);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const state = location.state as { processedData?: any } | null;
  const [processedData, setProcessedData] = useState<any>(state?.processedData);

  // Fallback: read from sessionStorage when opened in a new tab
  useEffect(() => {
    if (!processedData) {
      try {
        const cached = sessionStorage.getItem('project_preview_data');
        if (cached) {
          setProcessedData(JSON.parse(cached));
        }
      } catch (_e) {
        // ignore
      }
    }
  }, []);

  // Load project data using projectId from URL
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const loadProjectData = async () => {
      setIsLoadingProject(true);
      setLoadError(null);

      try {
        const response = await projectService.getProject(projectId);
        if (cancelled) return;

        if (response.success && response.project) {
          const latestConversationId = response.project.latest_conversation_id;
          if (latestConversationId) {
            const dashboardResponse = await conversationService.getDashboardData(latestConversationId, projectId);
            if (cancelled) return;

            if (dashboardResponse?.dashboard_data) {
              setProcessedData(dashboardResponse.dashboard_data);
            }
          }
        } else {
          setLoadError(response.error || 'Failed to load project');
        }
      } catch (error) {
        if (!cancelled) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load project data';
          setLoadError(errorMessage);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProject(false);
        }
      }
    };

    loadProjectData();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="min-h-screen bg-muted">
      {/* Content */}
      <div>
        {isLoadingProject ? (
          <DashboardLoading title="Loading Project" description="Please wait while we load your dashboard..." durationSec={10} />
        ) : loadError ? (
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <p className="text-red-400 mb-2">Error loading project</p>
              <p className="text-muted-foreground text-sm">{loadError}</p>
            </div>
          </div>
        ) : isInitialLoading ? (
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


