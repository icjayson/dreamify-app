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
import { useProjects } from "@/hooks/useProjects";
import { projectService, type ProjectRecord } from "@/services/projectService";
import { integrationService } from "@/services/integrationService";
import { CONNECTORS } from "@/constants/connectors";
import { useChatStore } from "@/chat/useChatStore";

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
  GA4: "bg-orange-500/20 text-orange-300",
  "Google Sheets": "bg-green-500/20 text-green-300",
  "Meta Ads": "bg-blue-500/20 text-blue-300",
  Stripe: "bg-purple-500/20 text-purple-300",
  CSV: "bg-white/10 text-white/60",
};

type Tab = "projects" | "connectors" | "dashboards";

// ─── Component ────────────────────────────────────────────────────────────────
export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;

  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam && ["projects", "connectors", "dashboards"].includes(tabParam) ? tabParam : "projects"
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
    if (tab && ["projects", "connectors", "dashboards"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // ── Dashboard data ───────────────────────────────────────────────────────────
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);

  const fetchAllProjects = useCallback(async () => {
    setDashboardsLoading(true);
    try {
      const res = await projectService.listProjects();
      if (res.success) setAllProjects(res.projects);
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

  // ── Connector status ─────────────────────────────────────────────────────────
  const [connectorStatus, setConnectorStatus] = useState<Record<string, ConnectorStatus>>({});
  const [connectorsLoading, setConnectorsLoading] = useState(false);

  const {
    setGA4ModalOpen,
    setGoogleSheetsModalOpen,
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
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
              className="text-white/40 hover:text-white transition-colors flex items-center justify-center p-1.5 -ml-1.5 rounded-md hover:bg-white/10 mr-1"
              aria-label="Back to homepage"
            >
              <Home className="w-4 h-4" />
            </button>
            <span className="hidden md:inline text-white/40">{displayName}</span>
            <span className="hidden md:inline text-white/20">›</span>
            <span className="text-white font-medium">
              {activeTab === "dashboards" ? "My Dashboards" : activeTab === "connectors" ? "Connectors" : "Projects"}
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
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'projects' ? 'border-primary text-white' : 'border-transparent text-white/50'}`}
          >
            Projects
          </button>
          <button
            onClick={() => navigate('/workspace?tab=connectors')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'connectors' ? 'border-primary text-white' : 'border-transparent text-white/50'}`}
          >
            Connectors
          </button>
          <button
            onClick={() => navigate('/workspace?tab=dashboards')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'dashboards' ? 'border-primary text-white' : 'border-transparent text-white/50'}`}
          >
            Dashboards
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
                  <p className="text-sm text-muted-foreground group-hover:text-white/70 transition-colors">New Project</p>
                </CardContent>
              </Card>

              {projectsLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="animate-pulse" style={{ minHeight: "200px" }}>
                    <div className="w-full aspect-video bg-white/5 rounded-t-lg" />
                    <CardContent className="p-4">
                      <div className="h-4 bg-white/10 rounded mb-2 w-3/4" />
                      <div className="h-3 bg-white/5 rounded w-1/2" />
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
                  <div className="text-center text-white/50 text-sm py-4">Loading your projects...</div>
                ) : projects.length === 0 ? (
                  <div className="text-center text-white/50 text-sm py-4 bg-white/5 rounded-lg border border-white/10">No projects yet</div>
                ) : (
                  projects.map((item) => (
                    <div
                      key={item.id}
                      className="group relative flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/10 hover:bg-white/10 transition-colors"
                      onClick={() => openProject(item.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-10">
                        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <FolderOpen className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-white truncate">{item.title}</span>
                          {item.updated_at && <span className="text-xs text-white/40">{new Date(item.updated_at).toLocaleDateString()}</span>}
                        </div>
                      </div>

                      <button
                        className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId((prev) => (prev === item.id ? null : item.id));
                        }}
                      >
                        <Ellipsis className="w-5 h-5 text-white/60" />
                      </button>

                      {openMenuId === item.id && (
                        <div className="absolute right-4 top-10 w-32 bg-[#2a2a2a] border border-white/10 rounded-md shadow-xl py-1 z-50">
                          <button
                            className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDialog({ open: true, mode: 'rename', itemId: item.id, itemTitle: item.title, value: item.title });
                              setOpenMenuId(null);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/10"
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
                <h2 className="text-lg font-semibold text-white mb-1">Connectors</h2>
                <p className="text-sm text-muted-foreground">Connect your data sources to build dashboards faster.</p>
              </div>
              {connectorsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} className="animate-pulse p-4 h-32" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {CONNECTORS.map((connector) => {
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
                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center flex-shrink-0">
                              <img
                                src={connector.icon}
                                alt={connector.name}
                                className={`w-7 h-7 object-contain ${connector.name === 'TikTok' ? 'scale-125' : ''}`}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            </div>
                            <div>
                              <h3 className="font-medium text-sm text-white">{connector.name}</h3>
                              {isSoon ? (
                                <span className="text-xs text-white/30">Coming soon</span>
                              ) : isConnected ? (
                                <span className="text-xs text-emerald-400">
                                  Connected account: {status?.info ? status.info.replace(/^Account:\s*/i, "").replace(" connected", "") : connector.name}
                                </span>
                              ) : (
                                <span className="text-xs text-white/40">Not connected</span>
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
              )}
            </div>
          )}

          {/* ════ MY DASHBOARDS TAB ════ */}
          {activeTab === "dashboards" && (
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white mb-1">My Dashboards</h2>
                <p className="text-sm text-muted-foreground">All dashboards you have created across your projects.</p>
              </div>
              {dashboardsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="animate-pulse flex items-center gap-3 p-4 border border-white/10 rounded-xl bg-white/[0.03]">
                      <div className="w-10 h-10 bg-white/5 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-white/10 rounded w-1/2" />
                        <div className="h-3 bg-white/5 rounded w-1/4" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : dashboardProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <LayoutDashboard className="w-12 h-12 text-white/10 mb-4" />
                  <h3 className="text-white/60 font-medium mb-2">No dashboards yet</h3>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {dashboardProjects.map((project) => {
                    const title = project.dashboard_title || project.name || "Untitled Dashboard";
                    const source = inferSource(title);

                    return (
                      <div
                        key={project.id}
                        role="button"
                        tabIndex={0}
                        aria-label="Open dashboard"
                        onClick={() => navigate(`/workspace/project?projectId=${project.id}`)}
                        className="group relative flex w-full max-w-full cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4 shadow-sm outline-none transition-all select-none hover:border-white/20 hover:bg-white/[0.06]"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3.5">
                          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/25 via-blue-500/15 to-indigo-500/20 transition-all duration-300 group-hover:from-primary/35 group-hover:via-blue-500/25 group-hover:to-indigo-500/30">
                            <svg viewBox="0 0 40 40" className="h-full w-full" aria-hidden="true">
                              <path d="M5 14 L11 10 L17 16 L23 8 L29 12 L35 6" stroke="hsl(142 76% 56%)" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                              <rect x="5" y="24" width="4.5" height="12" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.5" />
                              <rect x="11.5" y="20" width="4.5" height="16" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.7" />
                              <rect x="18" y="26" width="4.5" height="10" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.45" />
                              <rect x="24.5" y="22" width="4.5" height="14" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.85" />
                              <rect x="31" y="28" width="4.5" height="8" rx="1.2" fill="hsl(221 83% 53%)" opacity="0.55" />
                              <circle cx="23" cy="8" r="1.8" fill="hsl(142 76% 56%)" opacity="0.8" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-md truncate font-medium text-white">
                              {title}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-2 truncate text-sm text-white/50">
                              <span className="truncate">Source: {source}</span>
                            </div>
                          </div>
                        </div>
                        <button type="button" className="button-gradient ml-4 flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium text-white transition-all opacity-0 group-hover:opacity-100 hidden sm:flex">
                          Open
                        </button>
                      </div>
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
          <div className="relative z-[201] w-11/12 max-w-[320px] rounded-xl border border-white/10 bg-muted shadow-2xl p-4">
            {dialog.mode === 'rename' ? (
              <div>
                <div className="text-base font-medium text-white mb-3">Rename project</div>
                <input
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-md bg-black/50 border border-white/10 outline-none focus:border-primary/50 text-white"
                  autoFocus
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="px-4 py-2 text-sm rounded-md bg-transparent text-white/70 hover:bg-white/5"
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
                <div className="text-base font-medium text-white mb-2">Delete Project</div>
                <div className="text-sm text-white/70 mb-4">Are you sure you want to delete "{dialog.itemTitle}"? This cannot be undone.</div>
                <div className="flex justify-end gap-2">
                  <button
                    className="px-4 py-2 text-sm rounded-md bg-transparent text-white/70 hover:bg-white/5"
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
