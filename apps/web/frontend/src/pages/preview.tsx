import { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Shield, Lock, ArrowLeft } from "lucide-react";
import DashboardLoading from "@/components/project-section/DashboardLoading";
import { useChatStore } from "@/chat/useChatStore";
import DashboardPreview from "@/components/project-section/DashboardPreview";
import { projectService } from "@/services/projectService";
import { conversationService } from "@/services/conversationService";
import { publicProjectService } from "@/services/publicProjectService";

export default function PreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const { isSignedIn } = useAuth();
  const dashboardTheme = useChatStore((s) => s.dashboardTheme);
  const isThemeChanging = useChatStore((s) => s.isThemeChanging);
  const isInitialLoading = useChatStore((s) => s.isInitialLoading);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const state = location.state as { processedData?: any } | null;
  const [processedData, setProcessedData] = useState<any>(state?.processedData);
  const [dashboardIdFromSession, setDashboardIdFromSession] = useState<string | undefined>(undefined);

  // Fallback: read from sessionStorage when opened in a new tab
  useEffect(() => {
    try {
      const cachedId = sessionStorage.getItem('project_preview_dashboard_id');
      if (cachedId) {
        setDashboardIdFromSession(cachedId);
      }
    } catch (_e) {
      // ignore
    }

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
        // Use authenticated or public service based on auth status
        let response;
        if (isSignedIn) {
          response = await projectService.getProject(projectId);
        } else {
          response = await publicProjectService.getPublicProject(projectId);
        }
        
        if (cancelled) return;

        if (response.success && response.project) {
          const latestConversationId = response.project.latest_conversation_id;
          if (latestConversationId) {
            let dashboardResponse;
            if (isSignedIn) {
              dashboardResponse = await conversationService.getDashboardData(latestConversationId, projectId);
            } else {
              dashboardResponse = await publicProjectService.getPublicDashboardData(latestConversationId, projectId);
            }
            
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
  }, [projectId, isSignedIn]);

  return (
    <div className="min-h-screen bg-muted">
      {/* Content */}
      <div>
        {isLoadingProject ? (
          <DashboardLoading title="Loading Project" description="Please wait while we load your dashboard..." durationSec={10} />
        ) : loadError ? (
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="w-full max-w-md">
              <div className="glass-panel rounded-2xl p-4 text-center space-y-6 border border-white/10">
                {loadError.includes('not public') || loadError.includes('not publicly') ? (
                  <>
                    <div className="flex justify-center">
                      <div className="p-4 rounded-full bg-orange-500/20 border border-orange-500/30">
                        <Shield className="w-12 h-12 text-orange-400" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-semibold text-white">Private Preview</h2>
                      <p className="text-muted-foreground">
                        This dashboard preview is set to private. Only the project owner can view it.
                      </p>
                    </div>
                    {!isSignedIn && (
                      <div className="pt-4 space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Sign in to access your private dashboards
                        </p>
                        <button
                          onClick={() => navigate('/login')}
                          className="button-outline w-full py-2.5 flex items-center justify-center gap-2"
                        >
                          Sign In
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => navigate('/')}
                      className="text-sm text-muted-foreground hover:text-white transition-colors flex items-center justify-center gap-2 mx-auto"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to Home
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex justify-center">
                      <div className="p-4 rounded-full bg-red-500/20 border border-red-500/30">
                        <Lock className="w-12 h-12 text-red-400" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-semibold text-white">Unable to Load Project</h2>
                      <p className="text-muted-foreground text-sm">{loadError}</p>
                    </div>
                    <button
                      onClick={() => navigate('/')}
                      className="button-outline w-full py-2.5 flex items-center justify-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to Home
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : isInitialLoading ? (
          <DashboardLoading title="Generating Dashboard" description="Please wait while we build your dashboard..." durationSec={10} />
        ) : isThemeChanging ? (
          <DashboardLoading />
        ) : dashboardTheme === 'dark' ? (
          <DashboardPreview dashboardId={dashboardIdFromSession || projectId || undefined} processedData={processedData}/>
        ) : (
          <DashboardPreview dashboardId={dashboardIdFromSession || projectId || undefined} processedData={processedData}/>
        )}
      </div>
    </div>
  );
}


