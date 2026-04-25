import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Plug,
  LayoutDashboard,
  FolderOpen,
  CheckCircle2,
  Circle,
  ExternalLink,
  Home,
  ChevronRight,
  Ellipsis,
  SquareArrowOutUpRight
} from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import WorkspaceSidebar from "@/components/project-section/WorkspaceSidebar";
import HiddenDashboardCapturer from "@/components/workspace/HiddenDashboardCapturer";
import { useProjects } from "@/hooks/useProjects";
import { projectService, type ProjectRecord } from "@/services/projectService";
import { integrationService } from "@/services/integrationService";
import { CONNECTORS, CONNECTOR_CATEGORIES } from "@/constants/connectors";
import { useChatStore } from "@/chat/useChatStore";
import { SlackIntegrationCard } from "@/components/integrations/SlackIntegrationCard";
import { ScheduleManager } from "@/components/schedules/ScheduleManager";
import { toast as sonnerToast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ConnectorStatus {
  connected: boolean;
  info?: string;
}

// ─── Helper: source label ─────────────────────────────────────────────────────
function inferSource(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("ga4") || t.includes("google analytics") || t.includes("analytics")) return "GA4";
  if (t.includes("sheet") || t.includes("gsheet") || t.includes("spreadsheet")) return "Google Sheets";
  if (t.includes("meta") || t.includes("facebook") || t.includes("ads")) return "Meta Ads";
  if (t.includes("stripe")) return "Stripe";
  return "CSV";
}

const SOURCE_COLORS: Record<string, string> = {
  GA4: "bg-orange-500/20 text-orange-600 dark:text-orange-300",
  "Google Sheets": "bg-green-500/20 text-green-700 dark:text-green-300",
  "Meta Ads": "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  Stripe: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  CSV: "bg-foreground/10 text-foreground/60",
};

type Tab = "projects" | "connectors" | "dashboards" | "schedules";

// ─── Component ────────────────────────────────────────────────────────────────
export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;

  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam && ["projects", "connectors", "dashboards", "schedules"].includes(tabParam) ? tabParam : "projects"
  );
  const [collapsed, setCollapsed] = useState(false);

  const { toast } = useToast();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState({ open: false, mode: 'rename', itemId: '', itemTitle: '', value: '' });

  const navigate = useNavigate();
  const { user } = useUser();

  const {
    projects,
    isLoading: projectsLoading,
    createNewProject,
    renameProject,
    deleteProject,
    openProject,
  } = useProjects();

  // ── Sync active tab with URL ─────────────────────────────────────────────────
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab | null;
    if (tab && ["projects", "connectors", "dashboards", "schedules"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // ── Handle Slack OAuth return ────────────────────────────────────────────────
  useEffect(() => {
    const slackResult = searchParams.get("slack");
    if (!slackResult) return;
    const workspace = searchParams.get("workspace");
    const message = searchParams.get("message");
    if (slackResult === "success") {
      sonnerToast.success(`Connected to ${workspace || "your Slack workspace"}`);
    } else if (slackResult === "error") {
      sonnerToast.error(`Slack connection failed: ${message || "Unknown error"}`);
    }
    setSearchParams((prev) => {
      prev.delete("slack");
      prev.delete("workspace");
      prev.delete("message");
      return prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // ── Dashboard data ───────────────────────────────────────────────────────────
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const fetchAllProjects = useCallback(async () => {
    setDashboardsLoading(true);
    try {
      const res = await projectService.listProjects();
      if (res.success) {
        setAllProjects(res.projects);
        // Fetch presigned preview URLs for projects that have a preview
        const projectsWithPreview = res.projects.filter(
          (p) => p.latest_dashboard_id && p.dashboard_preview_key
        );
        // Fire URL fetches in parallel, non-blocking
        Promise.allSettled(
          projectsWithPreview.map(async (p) => {
            const result = await projectService.getDashboardPreviewUrl(p.id);
            if (result.url) {
              setPreviewUrls((prev) => ({ ...prev, [p.id]: result.url! }));
            }
          })
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDashboardsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "dashboards") fetchAllProjects();
  }, [activeTab, fetchAllProjects]);

  const dashboardProjects = allProjects.filter((p) => p.latest_dashboard_id);

  const handlePreviewGenerated = useCallback((projectId: string, url: string) => {
    setPreviewUrls((prev) => ({ ...prev, [projectId]: url }));
    // Update local state so we don't try to capture it again this session
    setAllProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, dashboard_preview_key: "generated_preview_in_session" } : p
      )
    );
  }, []);

  const projectsNeedingPreview = allProjects.filter(
    (p) => p.latest_dashboard_id && p.latest_conversation_id && !p.dashboard_preview_key
  );

  // ── Connector status ─────────────────────────────────────────────────────────
  const [connectorStatus, setConnectorStatus] = useState<Record<string, ConnectorStatus>>({});
  const [connectorsLoading, setConnectorsLoading] = useState(false);

  const {
    setGA4ModalOpen,
    setGoogleSheetsModalOpen,
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
    setStripeModalOpen,
    setGoogleAdsModalOpen,
    setFirebaseModalOpen,
  } = useChatStore();

  const handleIntegrationClick = (connectorName: string) => {
    if (connectorName === 'GA4') {
      setGA4ModalOpen(true);
    } else if (connectorName === 'Google Sheets') {
      setGoogleSheetsModalOpen(true);
    } else if (connectorName === 'Meta' || connectorName === 'Meta Ads') {
      setMetaAdsModalOpen(true);
    } else if (connectorName === 'TikTok' || connectorName === 'TikTok Ads') {
      setTikTokModalOpen(true);
    } else if (connectorName === 'AppsFlyer') {
      setAppsFlyerModalOpen(true);
    } else if (connectorName === 'Stripe') {
      setStripeModalOpen(true);
    } else if (connectorName === 'Google Ads') {
      setGoogleAdsModalOpen(true);
    } else if (connectorName === 'Firebase') {
      setFirebaseModalOpen(true);
    }
  };

  const fetchConnectorStatuses = useCallback(async () => {
    setConnectorsLoading(true);
    try {
      const results: Record<string, ConnectorStatus> = {};

      const metaStatus = await integrationService.getMetaConnectionStatus();
      if (metaStatus.connected) {
        try {
          const metaAccounts = await integrationService.fetchMetaAdAccounts();
          const firstMetaAccount = metaAccounts.ad_accounts?.[0];
          results["Meta"] = {
            connected: true,
            info: firstMetaAccount ? `Account: ${firstMetaAccount.name}` : "Account: Meta Ads",
          };
        } catch (_) {
          results["Meta"] = { connected: true, info: "Account: Meta Ads" };
        }
      } else {
        results["Meta"] = { connected: false };
      }

      const tiktokStatus = await integrationService.getTikTokConnectionStatus();
      if (tiktokStatus.connected) {
        try {
          const ttAccounts = await integrationService.fetchTikTokAdAccounts();
          const firstTTAccount = ttAccounts.ad_accounts?.[0];
          results["TikTok"] = {
            connected: true,
            info: firstTTAccount ? `Account: ${firstTTAccount.name}` : "Account: TikTok Ads",
          };
        } catch (_) {
          results["TikTok"] = { connected: true, info: "Account: TikTok Ads" };
        }
      } else {
        results["TikTok"] = { connected: false };
      }

      const googleToken = await integrationService.getGoogleOAuthToken();
      if (googleToken.success && googleToken.token) {
        // Use clerk's user external accounts to get the connected Google account email
        const googleEmail = user?.externalAccounts?.find((a) => (a.provider as string).includes("google"))?.emailAddress;
        
        let fallbackAccountInfo = "Account: Google Analytics";
        if (!googleEmail) {
          try {
            const ga4Res = await integrationService.fetchGoogleAnalyticsProperties();
            const firstAccount = ga4Res.accounts?.[0];
            if (firstAccount) {
              fallbackAccountInfo = `Account: ${firstAccount.account_name}`;
            }
          } catch (_) {}
        }
        
        const info = googleEmail ? `Account: ${googleEmail}` : fallbackAccountInfo;
        results["GA4"] = { connected: true, info };
        results["Google Sheets"] = { connected: true, info };
      } else {
        results["GA4"] = { connected: false };
        results["Google Sheets"] = { connected: false };
      }

      const appsflyerStatus = await integrationService.getAppsFlyerStatus();
      results["AppsFlyer"] = appsflyerStatus.connected
        ? { connected: true, info: "Account: AppsFlyer" }
        : { connected: false };

      const stripeStatus = await integrationService.getStripeStatus();
      results["Stripe"] = stripeStatus.connected
        ? { connected: true, info: "Account: Stripe" }
        : { connected: false };

      setConnectorStatus(results);
    } catch (e) {
      console.error("Failed to fetch connector statuses:", e);
    } finally {
      setConnectorsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "connectors") fetchConnectorStatuses();
  }, [activeTab, fetchConnectorStatuses]);

  const displayName = user?.fullName || user?.firstName || "My Workspace";

  // ── Post-redirect: auto-open connector modal after OAuth consent ────────────
  useEffect(() => {
    const connectorParam = searchParams.get('connector');
    if (!connectorParam) return;

    const CONNECTOR_MODAL_MAP: Record<string, (open: boolean) => void> = {
      'ga4': setGA4ModalOpen,
      'google-sheets': setGoogleSheetsModalOpen,
      'google-ads': setGoogleAdsModalOpen,
      'firebase': setFirebaseModalOpen,
    };

    const openModal = CONNECTOR_MODAL_MAP[connectorParam];
    if (openModal) {
      setTimeout(() => openModal(true), 500);
    }

    // Clean up the query param from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('connector');
    const remaining = newParams.toString();
    const newUrl = `${window.location.pathname}${remaining ? '?' + remaining : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [searchParams, setGA4ModalOpen, setGoogleSheetsModalOpen, setGoogleAdsModalOpen, setFirebaseModalOpen]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen h-[100dvh] overflow-hidden bg-muted flex">

      <div className="hidden md:flex">
        <WorkspaceSidebar
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          activeTab={activeTab}
          projects={projects}
          projectsLoading={projectsLoading}
          onOpenProject={openProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN CONTENT
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top breadcrumb bar */}
        <div className="px-6 py-3 border-b border-border/30 flex items-center justify-between h-14 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center p-1.5 -ml-1.5 rounded-md hover:bg-muted mr-1"
              aria-label="Back to homepage"
            >
              <Home className="w-4 h-4" />
            </button>
            <span className="hidden md:inline text-muted-foreground">{displayName}</span>
            <span className="hidden md:inline text-border">›</span>
            <span className="text-foreground font-medium">
              {activeTab === "dashboards" ? "My Dashboards" : activeTab === "connectors" ? "Connectors" : activeTab === "schedules" ? "Scheduled Syncs" : "Projects"}
            </span>
          </div>
          <button
            onClick={() => createNewProject()}
            className="button-gradient h-8 px-3 rounded-md text-sm text-white flex items-center gap-2"
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span>New Project</span>
          </button>
        </div>

        {/* Mobile Navigation Tabs */}
        <div className="md:hidden flex items-center justify-around border-b border-border/30 bg-muted/95 sticky top-0 z-40 backdrop-blur-sm">
          <button
            onClick={() => navigate('/workspace?tab=projects')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'projects' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Projects
          </button>
          <button
            onClick={() => navigate('/workspace?tab=connectors')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'connectors' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Connectors
          </button>
          <button
            onClick={() => navigate('/workspace?tab=dashboards')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'dashboards' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Dashboards
          </button>
          <button
            onClick={() => navigate('/workspace?tab=schedules')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'schedules' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Schedules
          </button>
        </div>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-6 md:p-6 p-4">

          {/* ════ PROJECTS TAB ════ */}
          {activeTab === "projects" && (
            <>
              {/* Desktop Grid View */}
              <div className="hidden md:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Create new card */}
              <Card
                onClick={() => createNewProject()}
                className="border-dashed border-2 border-border/40 hover:border-primary/50 cursor-pointer transition-all group"
                style={{ minHeight: "200px" }}
              >
                <CardContent className="flex flex-col items-center justify-center h-full gap-2 py-10">
                  <div className="w-10 h-10 rounded-full border-2 border-dashed border-border/50 group-hover:border-primary/50 flex items-center justify-center transition-colors">
                    <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-sm text-muted-foreground group-hover:text-foreground/70 transition-colors">New Project</p>
                </CardContent>
              </Card>

              {projectsLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="animate-pulse" style={{ minHeight: "200px" }}>
                    <div className="w-full aspect-video bg-muted/50 rounded-t-lg" />
                    <CardContent className="p-4">
                      <div className="h-4 bg-muted rounded mb-2 w-3/4" />
                      <div className="h-3 bg-muted/50 rounded w-1/2" />
                    </CardContent>
                  </Card>
                ))
                : projects.map((project) => (
                  <Card
                    key={project.id}
                    onClick={() => openProject(project.id)}
                    className="overflow-hidden hover:border-primary/40 cursor-pointer transition-all group"
                    style={{ minHeight: "200px" }}
                  >
                    <div className="w-full aspect-video overflow-hidden bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                      <FolderOpen className="w-10 h-10 text-primary/30 group-hover:text-primary/50 transition-colors" />
                    </div>
                    <CardContent className="p-4">
                      <h3 className="font-medium text-sm mb-1 truncate">{project.title}</h3>
                      {project.updated_at && (
                        <p className="text-xs text-muted-foreground">
                          {new Date(project.updated_at).toLocaleDateString()}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Mobile List View */}
              <div className="md:hidden flex flex-col gap-2">
                {projectsLoading ? (
                  <div className="text-center text-muted-foreground text-sm py-4">Loading your projects...</div>
                ) : projects.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-4 bg-muted/30 rounded-lg border border-border/40">No projects yet</div>
                ) : (
                  projects.map((item) => (
                    <div
                      key={item.id}
                      className="group relative flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30 hover:bg-muted transition-colors"
                      onClick={() => openProject(item.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-10">
                        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <FolderOpen className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-foreground truncate">{item.title}</span>
                          {item.updated_at && <span className="text-xs text-muted-foreground">{new Date(item.updated_at).toLocaleDateString()}</span>}
                        </div>
                      </div>

                      <button
                        className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId((prev) => (prev === item.id ? null : item.id));
                        }}
                      >
                        <Ellipsis className="w-5 h-5 text-muted-foreground" />
                      </button>

                      {openMenuId === item.id && (
                        <div className="absolute right-4 top-10 w-32 bg-popover border border-border rounded-md shadow-xl py-1 z-50">
                          <button
                            className="w-full text-left px-3 py-2 text-sm text-foreground/80 hover:bg-muted"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDialog({ open: true, mode: 'rename', itemId: item.id, itemTitle: item.title, value: item.title });
                              setOpenMenuId(null);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-muted"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDialog({ open: true, mode: 'delete', itemId: item.id, itemTitle: item.title, value: '' });
                              setOpenMenuId(null);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* ════ CONNECTORS TAB ════ */}
          {activeTab === "connectors" && (
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-foreground dark:text-white mb-1">Connectors</h2>
                <p className="text-sm text-muted-foreground">Connect your data sources to build dashboards faster.</p>
              </div>
              {/* ── Integrations (chat platforms) ── */}
              <div className="mb-8">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Integrations</h3>
                <SlackIntegrationCard />
              </div>

              {connectorsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} className="animate-pulse p-4 h-32" />
                  ))}
                </div>
              ) : (
                <div className="space-y-8">
                  {CONNECTOR_CATEGORIES.map((category) => {
                    const categoryConnectors = CONNECTORS.filter(c => c.category === category);
                    if (categoryConnectors.length === 0) return null;
                    return (
                      <div key={category}>
                        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{category}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {categoryConnectors.map((connector) => {
                            const status = connectorStatus[connector.name];
                            const isConnected = status?.connected ?? false;
                            const isSoon = !connector.isActive;

                            return (
                              <Card
                                key={connector.name}
                                onClick={() => !isSoon && handleIntegrationClick(connector.name)}
                                className={`p-4 transition-all ${isSoon ? "opacity-50" : "hover:border-primary/40 cursor-pointer"}`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 ${connector.iconBg ?? 'bg-muted dark:bg-white/5'}`}>
                                      <img
                                        src={connector.icon}
                                        alt={connector.name}
                                        className={`w-7 h-7 object-contain ${connector.name === 'TikTok Ads' ? 'scale-125' : ''}`}
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                      />
                                    </div>
                                    <div>
                                      <h3 className="font-medium text-sm text-foreground">{connector.name}</h3>
                                      {isSoon ? (
                                        <span className="text-xs text-muted-foreground">Coming soon</span>
                                      ) : isConnected ? (
                                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                          Connected account: {status?.info ? status.info.replace(/^Account:\s*/i, "").replace(" connected", "") : connector.name}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">Not connected</span>
                                      )}
                                    </div>
                                  </div>
                                  {!isSoon && (
                                    isConnected ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-2" />
                                    ) : (
                                      <button
                                        onClick={() => handleIntegrationClick(connector.name)}
                                        className="w-fit px-4 py-1.5 button-outline text-xs rounded-md inline-flex items-center justify-center mt-1"
                                      >
                                        Connect
                                      </button>
                                    )
                                  )}
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}


          {/* ════ SCHEDULES TAB ════ */}
          {activeTab === "schedules" && (
            <ScheduleManager projectId={projects[0]?.project_id ?? ""} />
          )}


          {/* ════ MY DASHBOARDS TAB ════ */}
          {activeTab === "dashboards" && (
            <div>
              <HiddenDashboardCapturer
                projectsNeedingPreview={projectsNeedingPreview}
                onPreviewGenerated={handlePreviewGenerated}
              />
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-foreground dark:text-white mb-1">My Dashboards</h2>
                <p className="text-sm text-muted-foreground">All dashboards you have created across your projects.</p>
              </div>
              {dashboardsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="animate-pulse overflow-hidden">
                      <div className="w-full aspect-video bg-muted/50" />
                      <CardContent className="p-4">
                        <div className="h-4 bg-muted rounded mb-2 w-3/4" />
                        <div className="h-3 bg-muted/50 rounded w-1/2" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : dashboardProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <LayoutDashboard className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <h3 className="text-muted-foreground font-medium mb-2">No dashboards yet</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                    Upload a CSV, connect a data source, and let Dreamify build your first dashboard.
                  </p>
                  <button
                    onClick={() => createNewProject()}
                    className="button-gradient h-9 px-4 rounded-md text-sm text-white flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    New Project
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {[...dashboardProjects]
                    .sort((a, b) => {
                      const tA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                      const tB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                      return tB - tA; // newest first
                    })
                    .map((project) => {
                    const title = project.dashboard_title || project.name || "Untitled Dashboard";
                    const source = inferSource(title);
                    const previewUrl = previewUrls[project.id];
                    const createdAt = project.updated_at
                      ? new Date(project.updated_at).toLocaleDateString(undefined, {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })
                      : null;

                    return (
                      <Card
                        key={project.id}
                        onClick={() => navigate(`/workspace/project?projectId=${project.id}`)}
                        className="overflow-hidden hover:border-primary/40 cursor-pointer transition-all group"
                      >
                        {/* 16:9 preview area */}
                        <div className="w-full aspect-video overflow-hidden relative bg-gradient-to-br from-violet-500/10 via-blue-500/8 to-cyan-500/5">
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={`${title} preview`}
                              className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                                const fallback = img.parentElement?.querySelector('[data-fallback]') as HTMLElement | null;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}

                          {/* SVG Fallback — fills the full 16:9 frame */}
                          <div
                            data-fallback
                            className="absolute inset-0 items-center justify-center"
                            style={{ display: previewUrl ? 'none' : 'flex' }}
                          >
                            <svg
                              viewBox="0 0 160 90"
                              className="w-full h-full"
                              preserveAspectRatio="xMidYMid meet"
                              aria-hidden="true"
                            >
                              <defs>
                                <linearGradient id={`dbG1-${project.id}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="hsl(221 83% 70%)" stopOpacity="0.9" />
                                  <stop offset="100%" stopColor="hsl(260 80% 60%)" stopOpacity="0.5" />
                                </linearGradient>
                                <linearGradient id={`dbG2-${project.id}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="hsl(175 80% 60%)" stopOpacity="0.8" />
                                  <stop offset="100%" stopColor="hsl(221 83% 60%)" stopOpacity="0.4" />
                                </linearGradient>
                              </defs>
                              {/* Trend line */}
                              <path d="M16 55 L38 42 L62 50 L84 28 L108 38 L140 18" stroke="hsl(142 76% 60%)" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
                              {/* Bars */}
                              <rect x="16"  y="62" width="16" height="20" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.5" />
                              <rect x="40"  y="54" width="16" height="28" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.75" />
                              <rect x="64"  y="66" width="16" height="16" rx="3" fill={`url(#dbG2-${project.id})`} opacity="0.55" />
                              <rect x="88"  y="58" width="16" height="24" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.85" />
                              <rect x="112" y="70" width="16" height="12" rx="3" fill={`url(#dbG2-${project.id})`} opacity="0.6" />
                              <rect x="136" y="50" width="14" height="32" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.7" />
                              {/* Peak dot */}
                              <circle cx="84" cy="28" r="4" fill="hsl(142 76% 60%)" opacity="0.9" />
                              <circle cx="84" cy="28" r="7" fill="hsl(142 76% 60%)" opacity="0.2" />
                            </svg>
                          </div>

                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors duration-300 pointer-events-none" />
                        </div>

                        {/* Card info */}
                        <CardContent className="p-4">
                          <h3 className="font-medium text-sm mb-1.5 truncate text-foreground">{title}</h3>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground truncate">Source: {source}</p>
                            {createdAt && (
                              <p className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">{createdAt}</p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Rename / Delete Dialog */}
      {dialog.open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDialog({ ...dialog, open: false })} />
          <div className="relative z-[201] w-11/12 max-w-[320px] rounded-xl border border-border bg-muted shadow-2xl p-4">
            {dialog.mode === 'rename' ? (
              <div>
                <div className="text-base font-medium text-foreground mb-3">Rename project</div>
                <input
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-md bg-background border border-border outline-none focus:border-primary/50 text-foreground"
                  autoFocus
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="px-4 py-2 text-sm rounded-md bg-transparent text-foreground/70 hover:bg-muted/80"
                    onClick={() => setDialog({ ...dialog, open: false })}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 text-sm rounded-md button-gradient text-white"
                    onClick={() => {
                      const v = dialog.value.trim();
                      if (v && dialog.itemId) {
                        renameProject(dialog.itemId, v);
                        toast({
                          title: "Project renamed",
                          description: `"${dialog.itemTitle}" → "${v}"`,
                        });
                      }
                      setDialog({ ...dialog, open: false });
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-base font-medium text-foreground mb-2">Delete Project</div>
                <div className="text-sm text-foreground/70 mb-4">Are you sure you want to delete "{dialog.itemTitle}"? This cannot be undone.</div>
                <div className="flex justify-end gap-2">
                  <button
                    className="px-4 py-2 text-sm rounded-md bg-transparent text-foreground/70 hover:bg-muted/80"
                    onClick={() => setDialog({ ...dialog, open: false })}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 text-sm rounded-md bg-red-600/80 hover:bg-red-600 text-white"
                    onClick={() => {
                      if (dialog.itemId) {
                        deleteProject(dialog.itemId);
                        toast({
                          title: "Project deleted",
                          description: `"${dialog.itemTitle}" was removed`,
                          variant: "destructive",
                        });
                      }
                      setDialog({ ...dialog, open: false });
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
