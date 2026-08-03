import { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "@/lib/navigation";
import { useAuth } from "@/lib/clerk";
import { SignIn } from "@/lib/clerk";
import { Shield, Lock, ArrowLeft } from "lucide-react";
import DashboardLoading from "@/components/project-section/DashboardLoading";
import { useChatStore } from "@/chat/useChatStore";
import DashboardPreview from "@/components/project-section/DashboardPreview";
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
  const [processedData, setProcessedData] = useState<any>(projectId ? undefined : state?.processedData);
  const [dashboardIdFromSession, setDashboardIdFromSession] = useState<string | undefined>(undefined);

  // Fallback: read from sessionStorage when opened in a new tab
  useEffect(() => {
    if (projectId) return;
    try {
      const cachedId = sessionStorage.getItem('project_preview_dashboard_id');
      if (cachedId) {
        setDashboardIdFromSession(cachedId);
        // Restore the template associated with this dashboard from localStorage map
        useChatStore.getState().setSelectedDashboardId(cachedId);
      }
    } catch (_e) {
      // ignore
    }

    try {
      const cached = sessionStorage.getItem('project_preview_data');
      if (cached) {
        setProcessedData((current: any) => current ?? JSON.parse(cached));
      }
    } catch (_e) {
      // ignore
    }
  }, [projectId]);

  // Load project data using projectId from URL
  // Always uses the public endpoint — api.get attaches the Bearer token
  // automatically when signed in, so the backend optional_user dependency
  // can grant access to private projects for owners and allowed users.
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const loadProjectData = async () => {
      setIsLoadingProject(true);
      setLoadError(null);

      try {
        const response = await publicProjectService.getPublicProject(projectId);

        if (cancelled) return;

        if (response.success && response.project) {
          const dashboardResponse = await publicProjectService.getPublicDashboardData(projectId);

          if (cancelled) return;

          if (dashboardResponse?.dashboard_data) {
            setProcessedData(dashboardResponse.dashboard_data);
            // Restore the template associated with this dashboard from localStorage map
            if (dashboardResponse.dashboard_id) {
              useChatStore.getState().setSelectedDashboardId(dashboardResponse.dashboard_id);
            }
          } else {
            setLoadError('This project does not have a saved dashboard preview yet.');
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
              <div className="glass-panel rounded-2xl p-4 text-center space-y-6 border border-border">
                {loadError.includes('not public') || loadError.includes('not publicly') ? (
                  <>
                    <div className="flex justify-center">
                      <div className="p-4 rounded-full bg-orange-500/20 border border-orange-500/30">
                        <Shield className="w-12 h-12 text-orange-400" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-semibold text-foreground">Private Preview</h2>
                      <p className="text-muted-foreground">
                        This dashboard preview is private. Only the owner and people they've shared it with can view it.
                      </p>
                    </div>
                    {!isSignedIn && (
                      <div className="pt-2">
                        <p className="text-sm text-muted-foreground mb-4">
                          Sign in to check if you have access to this dashboard.
                        </p>
                        <SignIn
                          appearance={{
                            elements: {
                              formButtonPrimary: "w-full button-gradient",
                              card: "!bg-transparent shadow-none border-none",
                              headerTitle: "hidden",
                              headerSubtitle: "hidden",
                              socialButtonsBlockButton: "w-full button-gradient mb-4",
                              dividerLine: "bg-border",
                              dividerText: "text-xs text-muted-foreground",
                              formFieldInput: "bg-input border-border text-foreground",
                              formFieldLabel: "text-sm font-medium text-foreground",
                              footer: "!bg-transparent",
                              footerActionLink: "text-foreground hover:text-accent hover:underline",
                            },
                            variables: {
                              colorText: "#ffffff",
                              colorBackground: "rgba(0,0,0,0)",
                            },
                            layout: {
                              unsafe_disableDevelopmentModeWarnings: true,
                              animations: true,
                            },
                          }}
                          forceRedirectUrl={`${window.location.pathname}${window.location.search}`}
                          signUpForceRedirectUrl={`${window.location.pathname}${window.location.search}`}
                        />
                      </div>
                    )}
                    {isSignedIn && (
                      <div className="pt-2">
                        <p className="text-sm text-muted-foreground">
                          You don't have access to this dashboard. Ask the owner to share it with you.
                        </p>
                      </div>
                    )}
                    <button
                      onClick={() => navigate('/')}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-2 mx-auto"
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
                      <h2 className="text-2xl font-semibold text-foreground">Unable to Load Project</h2>
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
          <DashboardPreview dashboardId={dashboardIdFromSession || projectId || undefined} processedData={processedData} readOnly />
        ) : (
          <DashboardPreview dashboardId={dashboardIdFromSession || projectId || undefined} processedData={processedData} readOnly />
        )}
      </div>
    </div>
  );
}


