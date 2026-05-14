import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import VideoBackground from '@/components/homepage-section/VideoBackground';
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Plus,
  Home,
  Plug,
  LayoutDashboard,
  FolderOpen,
  CheckCircle2,
  Ellipsis,
  SquareArrowOutUpRight,
  Sparkles,
  User as UserIcon,
  Settings,
  RefreshCw,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLayoutStyle } from "@/hooks/useLayoutStyle";
import { useTheme } from "@/hooks/useTheme";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import WorkspaceSidebar from "@/components/project-section/WorkspaceSidebar";
import CsvPreviewPanel from "@/components/project-section/CsvPreviewPanel";
import WorkspaceNewChat from "@/components/workspace/WorkspaceNewChat";
import AccountSettings from "@/components/homepage-section/AccountSettings";
import { PlansCreditsContent, PreferencesContent } from "@/components/homepage-section/AccountCenterModal";
import { PrivacyContent, PRIVACY_METADATA, PRIVACY_TOC } from "@/pages/Privacy";
import { TermsContent, TERMS_METADATA, TERMS_TOC } from "@/pages/Terms";
import HiddenDashboardCapturer from "@/components/workspace/HiddenDashboardCapturer";
import WorkspaceFiles from "@/components/workspace/WorkspaceFiles";
import ConnectorEntityDetailView from "@/components/workspace/ConnectorEntityDetailView";
import ProductNewsModal, {
  WORKSPACE_NEWS_ITEMS,
  type WorkspaceNewsItem,
} from "@/components/workspace/ProductNewsModal";
import OnboardingModal from "@/components/workspace/OnboardingModal";
import { useProjects } from "@/hooks/useProjects";
import { projectService, type ProjectRecord } from "@/services/projectService";
import {
  integrationService,
  type ConnectorOverviewItem,
  type ConnectorEntityDetailResponse,
  type ConnectorEntityRunItem,
} from "@/services/integrationService";
import { CONNECTORS } from "@/constants/connectors";
import { useChatStore } from "@/chat/useChatStore";
import { SlackIntegrationCard } from "@/components/integrations/SlackIntegrationCard";
import { TelegramIntegrationCard } from "@/components/integrations/TelegramIntegrationCard";
import { ZaloIntegrationCard } from "@/components/integrations/ZaloIntegrationCard";
import { ScheduleManager } from "@/components/schedules/ScheduleManager";
import { toast as sonnerToast } from "sonner";
import { formatToDisplay } from "@/utils/timestamp";
import { useSubscription } from "@/hooks/useSubscription";
import HeaderCreditBadge from "@/components/ui/HeaderCreditBadge";
import { NotificationBell } from "@/components/notifications/NotificationBell";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ConnectorStatus {
  connected: boolean;
  info?: string;
}

// ─── Helper: source label ─────────────────────────────────────────────────────
function inferSourceFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("ga4") || t.includes("google analytics")) return "GA4";
  if (t.includes("google sheet") || t.includes("gsheet") || t.includes("spreadsheet")) return "Google Sheets";
  if (t.includes("google ads")) return "Google Ads";
  if (t.includes("meta ads") || t.includes("facebook ads")) return "Meta Ads";
  if (t.includes("tiktok")) return "TikTok Ads";
  if (t.includes("appsflyer")) return "AppsFlyer";
  if (t.includes("firebase")) return "Firebase";
  if (t.includes("stripe")) return "Stripe";
  return "CSV";
}

function getSource(project: { source_type?: string | null; dashboard_title?: string | null; name?: string }): string {
  if (project.source_type) return project.source_type;
  const title = project.dashboard_title || project.name || "";
  return inferSourceFromTitle(title);
}

const SOURCE_COLORS: Record<string, string> = {
  GA4: "bg-orange-500/20 text-orange-600 dark:text-orange-300",
  "Google Sheets": "bg-green-500/20 text-green-700 dark:text-green-300",
  "Google Ads": "bg-blue-400/20 text-blue-600 dark:text-blue-300",
  "Meta Ads": "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  "TikTok Ads": "bg-pink-500/20 text-pink-700 dark:text-pink-300",
  AppsFlyer: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300",
  Firebase: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  Stripe: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  CSV: "bg-foreground/10 text-foreground/60",
};

const CONNECTOR_CARD_DESCRIPTIONS: Record<string, string> = {
  "Meta Ads": "Sync ad campaign, ad set, and performance metrics.",
  "TikTok Ads": "Sync ad campaign, ad set, and performance metrics.",
  "Google Ads": "Sync ad campaign, ad set, and performance metrics.",
  "GA4": "Sync website and app behavior events.",
  "Google Sheets": "Use spreadsheet data as a live source for dashboards.",
  "AppsFlyer": "Sync mobile attribution and install metrics.",
  "Stripe": "Sync subscription and payment metrics.",
  "Firebase": "Sync app analytics and product signals.",
};

type Tab = "new-chat" | "projects" | "connectors" | "dashboards" | "schedules" | "files" | "settings" | "privacy" | "terms";
type SettingsSection = "plans" | "account" | "preferences";
const NEWS_MODAL_COOLDOWN_MS = 3 * 60 * 60 * 1000;

// ─── WorkspaceDocsView ────────────────────────────────────────────────────────
// Mirrors DocsLayout visually but tracks scroll on the workspace <main> element
// rather than window, so the active-section TOC highlight works correctly.
function WorkspaceDocsView({
  children,
  metadata,
  toc,
  containerRef,
  currentTab,
  onSwitch,
}: {
  children: React.ReactNode;
  metadata: { title: string; effectiveDate: string; description: string };
  toc: { id: string; title: string }[];
  containerRef: React.RefObject<HTMLElement | null>;
  currentTab: "privacy" | "terms";
  onSwitch: (tab: "privacy" | "terms") => void;
}) {
  const [activeSection, setActiveSection] = useState("");
  const isClickScrolling = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isClickScrolling.current) return;
      const containerRect = container.getBoundingClientRect();
      const threshold = containerRect.top + 130;
      let current = "";
      for (let i = toc.length - 1; i >= 0; i--) {
        const el = document.getElementById(toc[i].id);
        if (el && el.getBoundingClientRect().top <= threshold) {
          current = toc[i].id;
          break;
        }
      }
      setActiveSection(current);
    };

    container.addEventListener("scroll", handleScroll);
    setTimeout(handleScroll, 100);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [toc, containerRef]);

  const scrollToSection = (id: string) => {
    const container = containerRef.current;
    const el = document.getElementById(id);
    if (!container || !el) return;
    isClickScrolling.current = true;
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 80;
    container.scrollTo({ top, behavior: "smooth" });
    setActiveSection(id);
    setTimeout(() => { isClickScrolling.current = false; }, 800);
  };

  return (
    <div className="grid grid-cols-4 min-h-full">
      {/* Main content — 3 cols */}
      <div className="col-span-4 lg:col-span-3 px-6 py-4 md:py-8 lg:pr-12 md:pl-12 lg:pl-16">
        {/* Tab switcher — sticky within the scrollable main container */}
        <div className="sticky top-0 z-10 flex justify-center py-3 mb-6 -mx-6 px-6">
          <div className="inline-flex items-center gap-1 bg-foreground/5 rounded-full p-1">
            {(
              [
                { key: "privacy" as const, label: "Privacy Policy" },
                { key: "terms"   as const, label: "Terms of Service" },
              ]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onSwitch(key)}
                className={cn(
                  "px-5 py-2 rounded-full text-sm font-medium transition-all duration-200",
                  currentTab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden md:block mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">{metadata.title}</h1>
          <p className="mt-3 text-sm font-medium text-muted-foreground">Effective Date: {metadata.effectiveDate}</p>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">{metadata.description}</p>
        </div>
        {/* Mobile header */}
        <div className="md:hidden mb-8">
          <h1 className="text-2xl font-bold text-foreground">{metadata.title}</h1>
          <p className="mt-2 text-xs text-muted-foreground">Effective Date: {metadata.effectiveDate}</p>
          <p className="mt-3 text-sm text-muted-foreground">{metadata.description}</p>
        </div>
        <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 space-y-10">
          {children}
        </div>
      </div>

      {/* Right TOC — 1 col */}
      <div className="hidden lg:block col-span-1 border-l border-border/50">
        <div className="sticky top-0 py-14 px-8 max-h-screen overflow-y-auto">
          <h4 className="text-sm font-semibold tracking-wider text-foreground mb-4 uppercase">On this page</h4>
          <nav className="flex flex-col space-y-2">
            {toc.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  "text-sm transition-colors hover:text-foreground py-1 text-left",
                  activeSection === item.id ? "font-medium text-primary" : "text-muted-foreground"
                )}
              >
                {item.title}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function WorkspacePage() {
  type MarketplaceTab = "all" | "analytics" | "advertising" | "operations" | "finance" | "e-commerce";
  const routeParams = useParams<{ connectorKey?: string; entityId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;

  const [activeTab, setActiveTab] = useState<Tab>(
    routeParams.connectorKey && routeParams.entityId
      ? "connectors"
      : tabParam && ["new-chat", "projects", "connectors", "dashboards", "schedules", "files", "settings", "privacy", "terms"].includes(tabParam)
        ? tabParam
        : "new-chat"
  );
  const [collapsed, setCollapsed] = useState(false);

  const mainRef = useRef<HTMLElement>(null);

  const sectionParam = searchParams.get("section") as SettingsSection | null;
  const detailTabParam = searchParams.get("detailTab");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    sectionParam && ["plans", "account", "preferences"].includes(sectionParam) ? sectionParam : "account"
  );

  const { toast } = useToast();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState({ open: false, mode: 'rename', itemId: '', itemTitle: '', value: '' });
  const [newsModalOpen, setNewsModalOpen] = useState(false);
  const [activeNewsItem, setActiveNewsItem] = useState<WorkspaceNewsItem | null>(null);
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);

  const navigate = useNavigate();
  const { user } = useUser();
  const { creditsRemaining, creditUsage } = useSubscription();
  const [layoutStyle] = useLayoutStyle();
  const { resolvedTheme } = useTheme();

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
    if (routeParams.connectorKey && routeParams.entityId) {
      setActiveTab("connectors");
    } else if (tab && ["new-chat", "projects", "connectors", "dashboards", "schedules", "files", "settings", "privacy", "terms"].includes(tab)) {
      setActiveTab(tab);
    }
    const section = searchParams.get("section") as SettingsSection | null;
    if (section && ["plans", "account", "preferences"].includes(section)) {
      setSettingsSection(section);
    }
  }, [searchParams, routeParams.connectorKey, routeParams.entityId]);

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

  const handleNewsExplore = (feature: WorkspaceNewsItem) => {
    setNewsModalOpen(false);
    if (feature.id === "templates") {
      setSearchParams({ tab: "new-chat", openTemplate: "1" });
      return;
    }
    handleTabChange(feature.targetTab as Tab);
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
    setRelatedProjectPreviewUrls((prev) => ({ ...prev, [projectId]: url }));
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
  const [connectorOverview, setConnectorOverview] = useState<ConnectorOverviewItem[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [marketplaceTab, setMarketplaceTab] = useState<MarketplaceTab>("all");
  const [selectedConnectorCard, setSelectedConnectorCard] = useState<{
    connectorKey: string;
    connectorName: string;
    entityId: string;
    entityName: string;
  } | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "data-table">(
    detailTabParam === "data-table" ? "data-table" : "overview"
  );
  const [connectorDetail, setConnectorDetail] = useState<ConnectorEntityDetailResponse | null>(null);
  const [connectorHistory, setConnectorHistory] = useState<ConnectorEntityRunItem[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<string | null>(null);
  const [relatedProjectPreviewUrls, setRelatedProjectPreviewUrls] = useState<Record<string, string>>({});
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [refreshDatePreset, setRefreshDatePreset] = useState("last_30d");
  const [refreshStartDate, setRefreshStartDate] = useState("");
  const [refreshEndDate, setRefreshEndDate] = useState("");
  const [refreshCampaignIds, setRefreshCampaignIds] = useState("");
  const [refreshAdsetIds, setRefreshAdsetIds] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshingData, setRefreshingData] = useState(false);
  const connectorKey = selectedConnectorCard?.connectorKey || "";
  const isGoogleSheetsConnector = connectorKey === "google_sheets";
  const isMetaAdsConnector = connectorKey === "meta_ads";
  const relatedProjectIds = useMemo(
    () => new Set((connectorDetail?.related_projects || []).map((project) => project.project_id)),
    [connectorDetail?.related_projects]
  );
  const relatedProjectsNeedingPreview = useMemo(
    () =>
      allProjects.filter(
        (p) =>
          relatedProjectIds.has(p.id) &&
          p.latest_dashboard_id &&
          p.latest_conversation_id &&
          !p.dashboard_preview_key
      ),
    [allProjects, relatedProjectIds]
  );

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
          results["Meta Ads"] = {
            connected: true,
            info: firstMetaAccount ? `Account: ${firstMetaAccount.name}` : "Account: Meta Ads",
          };
        } catch (_) {
          results["Meta Ads"] = { connected: true, info: "Account: Meta Ads" };
        }
      } else {
        results["Meta Ads"] = { connected: false };
      }

      const tiktokStatus = await integrationService.getTikTokConnectionStatus();
      if (tiktokStatus.connected) {
        try {
          const ttAccounts = await integrationService.fetchTikTokAdAccounts();
          const firstTTAccount = ttAccounts.ad_accounts?.[0];
          results["TikTok Ads"] = {
            connected: true,
            info: firstTTAccount ? `Account: ${firstTTAccount.name}` : "Account: TikTok Ads",
          };
        } catch (_) {
          results["TikTok Ads"] = { connected: true, info: "Account: TikTok Ads" };
        }
      } else {
        results["TikTok Ads"] = { connected: false };
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
          } catch {
            // Keep the generic fallback when GA properties cannot be loaded.
          }
        }

        const info = googleEmail ? `Account: ${googleEmail}` : fallbackAccountInfo;
        results["GA4"] = { connected: true, info };
        results["Google Sheets"] = { connected: true, info };
        results["Google Ads"] = { connected: true, info };
        results["Firebase"] = { connected: true, info };
      } else {
        results["GA4"] = { connected: false };
        results["Google Sheets"] = { connected: false };
        results["Google Ads"] = { connected: false };
        results["Firebase"] = { connected: false };
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

      const overview = await integrationService.fetchConnectorsOverview();
      setConnectorOverview(overview.success ? overview.connectors : []);
    } catch (e) {
      console.error("Failed to fetch connector statuses:", e);
      setConnectorOverview([]);
    } finally {
      setConnectorsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "connectors") fetchConnectorStatuses();
  }, [activeTab, fetchConnectorStatuses]);

  useEffect(() => {
    const handleConnectorSynced = () => {
      if (activeTab !== "connectors") return;
      fetchConnectorStatuses();
    };
    window.addEventListener("dreamify:connector-synced", handleConnectorSynced);
    return () => window.removeEventListener("dreamify:connector-synced", handleConnectorSynced);
  }, [activeTab, fetchConnectorStatuses]);

  useEffect(() => {
    if (!user?.id) return;

    const onboardingStorageKey = `dreamify:workspace:onboarding:seen:${user.id}`;
    const hasSeenOnboarding = localStorage.getItem(onboardingStorageKey) === "true";
    if (!hasSeenOnboarding) {
      setOnboardingModalOpen(true);
      return;
    }

    const storageKey = `dreamify:workspace:news:last-shown:${user.id}`;
    const lastShownAtRaw = localStorage.getItem(storageKey);
    const lastShownAt = Number(lastShownAtRaw ?? "0");
    if (Number.isFinite(lastShownAt) && Date.now() - lastShownAt < NEWS_MODAL_COOLDOWN_MS) {
      return;
    }

    const randomItem = WORKSPACE_NEWS_ITEMS[Math.floor(Math.random() * WORKSPACE_NEWS_ITEMS.length)];
    setActiveNewsItem(randomItem);
    setNewsModalOpen(true);
    localStorage.setItem(storageKey, String(Date.now()));
  }, [user?.id]);

  const handleDismissOnboarding = useCallback(() => {
    if (!user?.id) return;
    const onboardingStorageKey = `dreamify:workspace:onboarding:seen:${user.id}`;
    localStorage.setItem(onboardingStorageKey, "true");
    setOnboardingModalOpen(false);
  }, [user?.id]);

  const displayName = user?.fullName || user?.firstName || "My Workspace";
  const myConnectedCards = useMemo(
    () =>
      connectorOverview
        .filter((item) => item.connected)
        .flatMap((item) =>
          (item.selected_entities ?? []).map((entity) => ({
            connectorKey: item.connector_key,
            connectorName: item.display_name,
            entityId: entity.id,
            entityName: entity.name,
          }))
        ),
    [connectorOverview]
  );
  const marketplaceConnectors = useMemo(() => {
    if (marketplaceTab === "all") {
      return [...CONNECTORS].sort((a, b) => {
        const aAvailable = Boolean(a.isActive);
        const bAvailable = Boolean(b.isActive);
        if (aAvailable === bAvailable) return a.name.localeCompare(b.name);
        return aAvailable ? -1 : 1;
      });
    }
    const tabCategoryMap: Record<Exclude<MarketplaceTab, "all">, string> = {
      analytics: "Analytics Platform",
      advertising: "Advertising Platform",
      operations: "Operations & Database",
      finance: "Payment & Finance",
      "e-commerce": "E-commerce",
    };
    return CONNECTORS.filter((connector) => connector.category === tabCategoryMap[marketplaceTab as Exclude<MarketplaceTab, "all">]);
  }, [marketplaceTab]);

  const updateWorkspaceParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([key, value]) => {
          if (value == null || value === "") {
            next.delete(key);
            return;
          }
          next.set(key, value);
        });
        return next;
      });
    },
    [setSearchParams]
  );

  const loadConnectorDetail = useCallback(async (connectorKey: string, entityId: string) => {
    setDetailLoading(true);
    try {
      const [detailRes, historyRes] = await Promise.all([
        integrationService.fetchConnectorEntityDetail(connectorKey, entityId),
        integrationService.fetchConnectorEntityHistory(connectorKey, entityId, 30),
      ]);
      setConnectorDetail(detailRes.success ? detailRes : null);
      const normalizedRuns = historyRes.success ? [...(historyRes.runs || [])] : [];
      if (normalizedRuns.length === 0 && detailRes.success && detailRes.latest_asset?.asset_id) {
        normalizedRuns.push({
          run_id: `asset-${detailRes.latest_asset.asset_id}`,
          status: "success",
          completed_at: detailRes.latest_asset.created_at,
          rows_fetched: detailRes.latest_asset.row_count,
          columns_fetched: detailRes.latest_asset.column_count,
          asset_id: detailRes.latest_asset.asset_id,
          asset_filename: detailRes.latest_asset.filename,
          config_snapshot: {
            entity_id: entityId,
            entity_name: detailRes.entity?.name || entityId,
            rows: detailRes.latest_asset.row_count,
            columns: detailRes.latest_asset.column_count,
            size_bytes: detailRes.latest_asset.size_bytes,
          },
        });
      }
      setConnectorHistory(normalizedRuns);
      const latestAssetId = detailRes.latest_asset?.asset_id || normalizedRuns.find((run) => !!run.asset_id)?.asset_id || null;
      setActiveAssetId(latestAssetId || null);
      const selectedRun = historyRes.success
        ? normalizedRuns.find((run) => run.asset_id === latestAssetId) || normalizedRuns[0]
        : null;
      setSelectedHistoryRunId(selectedRun?.run_id || null);
      setRelatedProjectPreviewUrls({});
    } catch (error) {
      console.error("Failed to load connector detail:", error);
      setConnectorDetail(null);
      setConnectorHistory([]);
      setActiveAssetId(null);
      setSelectedHistoryRunId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSelectConnectorCard = useCallback(
    async (
      card: { connectorKey: string; connectorName: string; entityId: string; entityName: string },
      options?: { syncRoute?: boolean; tab?: "overview" | "data-table" }
    ) => {
      const detailTabToUse = options?.tab ?? "overview";
      setSelectedConnectorCard(card);
      setDetailTab(detailTabToUse);
      if (options?.syncRoute !== false) {
        const encodedConnectorKey = encodeURIComponent(card.connectorKey);
        const encodedEntityId = encodeURIComponent(card.entityId);
        navigate(`/workspace/connectors/${encodedConnectorKey}/${encodedEntityId}?detailTab=${detailTabToUse}`);
      }
      await loadConnectorDetail(card.connectorKey, card.entityId);
    },
    [loadConnectorDetail, navigate]
  );

  const handleDetailTabChange = useCallback(
    (tab: "overview" | "data-table") => {
      setDetailTab(tab);
      if (!selectedConnectorCard) return;
      updateWorkspaceParams({ detailTab: tab });
    },
    [selectedConnectorCard, updateWorkspaceParams]
  );

  useEffect(() => {
    if (!connectorDetail?.related_projects?.length) return;
    const withDashboard = connectorDetail.related_projects.filter((project) => project.latest_dashboard_id);
    if (withDashboard.length === 0) return;
    let cancelled = false;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    void fetchAllProjects();
    Promise.allSettled(
      withDashboard.map(async (project) => {
        const maxAttempts = 4;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (cancelled) return;
          const result = await projectService.getDashboardPreviewUrl(project.project_id);
          if (!cancelled && result.url) {
            setPreviewUrls((prev) => ({ ...prev, [project.project_id]: result.url! }));
            setRelatedProjectPreviewUrls((prev) => ({ ...prev, [project.project_id]: result.url! }));
            return;
          }
          if (attempt < maxAttempts - 1) {
            await sleep(1200 * (attempt + 1));
          }
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [connectorDetail?.related_projects, fetchAllProjects]);

  useEffect(() => {
    const schedule = connectorDetail?.latest_schedule as Record<string, unknown> | undefined;
    if (!schedule) return;
    setRefreshDatePreset(String(schedule.date_range_preset || "last_30d"));
    const cfg = (schedule.connector_config || {}) as Record<string, unknown>;
    const campaignIds = Array.isArray(cfg.campaign_ids) ? cfg.campaign_ids.join(",") : "";
    const adsetIds = Array.isArray(cfg.adset_ids) ? cfg.adset_ids.join(",") : "";
    setRefreshCampaignIds(campaignIds);
    setRefreshAdsetIds(adsetIds);
    setRefreshStartDate("");
    setRefreshEndDate("");
  }, [connectorDetail?.latest_schedule]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    const connectorKeyParam = routeParams.connectorKey ?? searchParams.get("connectorKey");
    const entityIdParam = routeParams.entityId ?? searchParams.get("entityId");
    const detailTabQuery = searchParams.get("detailTab");
    const initialDetailTab = detailTabQuery === "data-table" ? "data-table" : "overview";
    const isConnectorRoute = Boolean(routeParams.connectorKey && routeParams.entityId);
    if (!isConnectorRoute && tab !== "connectors") return;
    if (!connectorKeyParam || !entityIdParam) return;
    const matchedCard = myConnectedCards.find(
      (card) => card.connectorKey === connectorKeyParam && card.entityId === entityIdParam
    );
    if (!matchedCard) return;
    if (
      selectedConnectorCard?.connectorKey === matchedCard.connectorKey &&
      selectedConnectorCard?.entityId === matchedCard.entityId
    ) {
      return;
    }
    handleSelectConnectorCard(matchedCard, { syncRoute: false, tab: initialDetailTab });
  }, [
    searchParams,
    routeParams.connectorKey,
    routeParams.entityId,
    myConnectedCards,
    selectedConnectorCard,
    handleSelectConnectorCard,
  ]);

  const handleRefreshConnectorData = useCallback(async (payload?: {
    date_preset?: string;
    start_date?: string;
    end_date?: string;
    campaign_ids?: string[];
    adset_ids?: string[];
  }) => {
    if (!selectedConnectorCard) return;
    setRefreshingData(true);
    try {
      const result = await integrationService.refreshConnectorEntity(
        selectedConnectorCard.connectorKey,
        selectedConnectorCard.entityId,
        payload
      );
      if (!result.success) {
        throw new Error(result.error || "Failed to refresh data");
      }
      await loadConnectorDetail(selectedConnectorCard.connectorKey, selectedConnectorCard.entityId);
      await fetchConnectorStatuses();
      setRefreshModalOpen(false);
    } catch (error) {
      sonnerToast.error(error instanceof Error ? error.message : "Failed to refresh connector data");
    } finally {
      setRefreshingData(false);
    }
  }, [selectedConnectorCard, loadConnectorDetail, fetchConnectorStatuses]);

  const handleSubmitRefreshModal = useCallback(async () => {
    const payload: {
      date_preset?: string;
      start_date?: string;
      end_date?: string;
      campaign_ids?: string[];
      adset_ids?: string[];
    } = {};
    if (!isGoogleSheetsConnector) {
      if (refreshDatePreset === "custom") {
        if (refreshStartDate) payload.start_date = refreshStartDate;
        if (refreshEndDate) payload.end_date = refreshEndDate;
      } else {
        payload.date_preset = refreshDatePreset;
      }
    }
    if (isMetaAdsConnector && refreshCampaignIds.trim()) {
      payload.campaign_ids = refreshCampaignIds.split(",").map((v) => v.trim()).filter(Boolean);
    }
    if (isMetaAdsConnector && refreshAdsetIds.trim()) {
      payload.adset_ids = refreshAdsetIds.split(",").map((v) => v.trim()).filter(Boolean);
    }
    await handleRefreshConnectorData(payload);
  }, [
    refreshDatePreset,
    refreshStartDate,
    refreshEndDate,
    refreshCampaignIds,
    refreshAdsetIds,
    isGoogleSheetsConnector,
    isMetaAdsConnector,
    handleRefreshConnectorData,
  ]);

  const handleAddToNewProject = useCallback(async (assetId?: string, syncVersionName?: string) => {
    if (!selectedConnectorCard) return;
    try {
      const projectName = `${selectedConnectorCard.entityName} Project`;
      const defaultPrompt = "Analyze this data and build a dashboard.";
      const result = await integrationService.addConnectorEntityToNewProject(
        selectedConnectorCard.connectorKey,
        selectedConnectorCard.entityId,
        { project_name: projectName, prompt: defaultPrompt, asset_id: assetId }
      );
      if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
        throw new Error(result.error || "Failed to create project from connector");
      }
      const pendingFile = {
        fileID: result.asset.asset_id,
        filename: result.asset.filename,
        size: result.asset.size_bytes || 0,
        ext: result.asset.extension || "csv",
        status: "uploaded" as const,
        projectId: result.project.project_id,
        sourceType: selectedConnectorCard.connectorName,
        accountName: selectedConnectorCard.connectorName,
        propertyName: selectedConnectorCard.entityName,
        syncVersionName,
        rowCount: result.asset.row_count,
        columnCount: result.asset.column_count,
      };
      useChatStore.getState().setPendingFilesForNewChat([pendingFile]);
      navigate("/workspace?tab=new-chat");
    } catch (error) {
      sonnerToast.error(error instanceof Error ? error.message : "Failed to add data to new project");
    }
  }, [selectedConnectorCard, navigate]);

  const handleDeleteConnectorEntity = useCallback(async () => {
    if (!selectedConnectorCard) return;
    try {
      const result = await integrationService.deleteConnectorEntity(
        selectedConnectorCard.connectorKey,
        selectedConnectorCard.entityId
      );
      if (!result.success) throw new Error(result.error || "Failed to delete connector entity");
      sonnerToast.success("Connector entity deleted");
      setSelectedConnectorCard(null);
      navigate("/workspace?tab=connectors");
      await fetchConnectorStatuses();
    } catch (error) {
      sonnerToast.error(error instanceof Error ? error.message : "Failed to delete connector entity");
    }
  }, [selectedConnectorCard, fetchConnectorStatuses, navigate]);

  const selectedHistoryRun =
    connectorHistory.find((run) => run.run_id === selectedHistoryRunId) ||
    connectorHistory.find((run) => run.asset_id === activeAssetId) ||
    null;

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

  const isAesthetic = layoutStyle === "aesthetic" && activeTab === "new-chat";
  const showWorkspaceHeaderActions = activeTab !== "files" && activeTab !== "schedules";

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className={cn("h-screen h-[100dvh] overflow-hidden flex relative", isAesthetic ? "bg-transparent" : "bg-muted")}>

      {/* ── Aesthetic background (root level, behind everything) ── */}
      {isAesthetic && (
        <>
          {resolvedTheme === "dark" ? (
            <WaveBackground className="absolute inset-0 z-0" backdropBlurAmount="none" />
          ) : (
            <VideoBackground className="absolute inset-0 z-0" />
          )}
          <div className={`absolute inset-0 z-[1] ${resolvedTheme === "dark" ? "bg-black/60" : "bg-white/20"}`} />
        </>
      )}

      <div className="hidden md:flex relative z-[10]">
        <WorkspaceSidebar
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          activeTab={activeTab}
          projects={projects}
          projectsLoading={projectsLoading}
          onOpenProject={openProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          aesthetic={isAesthetic}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN CONTENT
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0 relative z-[2]">
        {showWorkspaceHeaderActions && (
          <div className="hidden md:flex items-center absolute top-4 right-6 z-50">
            <HeaderCreditBadge
              creditsRemaining={creditsRemaining}
              monthlyCreditsUsed={creditUsage?.monthly_credits_used}
            />
            <NotificationBell />
          </div>
        )}

        {/* Mobile Navigation Tabs */}
        <div className="md:hidden flex items-center justify-around border-b border-border/30 bg-muted/95 sticky top-0 z-40 backdrop-blur-sm">
          <button
            onClick={() => navigate('/workspace?tab=new-chat')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'new-chat' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            New Project
          </button>
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
            onClick={() => navigate('/workspace?tab=files')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'files' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Files
          </button>
          <button
            onClick={() => navigate('/workspace?tab=schedules')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'schedules' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Schedules
          </button>
        </div>

        {/* Scrollable content */}
        <main
          ref={mainRef}
          className={cn(
            "flex-1 overflow-y-auto",
            (activeTab === "privacy" || activeTab === "terms" || isAesthetic) ? "" : "p-6"
          )}
        >

          {/* ════ NEW CHAT TAB ════ */}
          {activeTab === "new-chat" && (
            <WorkspaceNewChat />
          )}

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
                          {formatToDisplay(project.updated_at, { format: "date" })}
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
                        {item.updated_at && <span className="text-xs text-muted-foreground">{formatToDisplay(item.updated_at, { format: "date" })}</span>}
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
            {selectedConnectorCard ? (
              <>
                {detailTab === "overview" && (
                  <HiddenDashboardCapturer
                    projectsNeedingPreview={relatedProjectsNeedingPreview}
                    onPreviewGenerated={handlePreviewGenerated}
                  />
                )}
                <ConnectorEntityDetailView
                  selectedConnectorCard={selectedConnectorCard}
                  detailTab={detailTab}
                  setDetailTab={handleDetailTabChange}
                  onBack={() => {
                    setSelectedConnectorCard(null);
                    navigate("/workspace?tab=connectors");
                  }}
                  onAddToNewProject={handleAddToNewProject}
                  onAddSelectedHistoryToNewProject={(assetId, syncVersionName) => handleAddToNewProject(assetId, syncVersionName)}
                  onDeleteEntity={handleDeleteConnectorEntity}
                  detailLoading={detailLoading}
                  connectorDetail={connectorDetail}
                  relatedProjectPreviewUrls={relatedProjectPreviewUrls}
                  activeAssetId={activeAssetId}
                  refreshingData={refreshingData}
                  onOpenRefreshModal={() => setRefreshModalOpen(true)}
                  selectedHistoryRun={selectedHistoryRun}
                  connectorHistory={connectorHistory}
                  selectedHistoryRunId={selectedHistoryRunId}
                  setSelectedHistoryRunId={setSelectedHistoryRunId}
                  setActiveAssetId={setActiveAssetId}
                  isHistoryExpanded={isHistoryExpanded}
                  setIsHistoryExpanded={setIsHistoryExpanded}
                  refreshModalOpen={refreshModalOpen}
                  setRefreshModalOpen={setRefreshModalOpen}
                  refreshDatePreset={refreshDatePreset}
                  setRefreshDatePreset={setRefreshDatePreset}
                  refreshStartDate={refreshStartDate}
                  setRefreshStartDate={setRefreshStartDate}
                  refreshEndDate={refreshEndDate}
                  setRefreshEndDate={setRefreshEndDate}
                  refreshCampaignIds={refreshCampaignIds}
                  setRefreshCampaignIds={setRefreshCampaignIds}
                  refreshAdsetIds={refreshAdsetIds}
                  setRefreshAdsetIds={setRefreshAdsetIds}
                  onSubmitRefreshModal={handleSubmitRefreshModal}
                  onOpenRelatedProject={(projectId, dashboardId) => {
                    const dashboardQuery = dashboardId ? `&dashboardId=${encodeURIComponent(dashboardId)}` : "";
                    navigate(`/workspace/project?projectId=${projectId}${dashboardQuery}`);
                  }}
                />
              </>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-foreground dark:text-white mb-1">Connectors</h2>
                  <p className="text-sm text-muted-foreground">Connect your data sources to build dashboards faster.</p>
                </div>
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Active Data Connectors</h3>
                  <p className="text-sm text-muted-foreground mb-3">Connected sources powering your dashboards</p>
                  {myConnectedCards.length === 0 ? (
                    <Card className="p-4 border-dashed border-border/60 bg-muted/20">
                      <p className="text-sm text-muted-foreground">Connect a source and select data to see it here.</p>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {myConnectedCards.map((card) => {
                        const connectorMeta = CONNECTORS.find((connector) => connector.name === card.connectorName);
                        return (
                          <Card
                            key={`${card.connectorKey}-${card.entityId}`}
                            onClick={() => handleSelectConnectorCard(card)}
                            className="p-4 hover:border-primary/40 cursor-pointer transition-all"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 ${connectorMeta?.iconBg ?? 'bg-muted dark:bg-white/5'}`}>
                                  {connectorMeta?.icon ? (
                                    <img
                                      src={connectorMeta.icon}
                                      alt={card.connectorName}
                                      className={`w-7 h-7 object-contain ${card.connectorName === "TikTok Ads" ? "scale-125" : ""}`}
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                  ) : (
                                    <Plug className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <h3 className="font-medium text-sm text-foreground truncate">{card.entityName}</h3>
                                  <span className="text-xs text-muted-foreground">{card.connectorName}</span>
                                </div>
                              </div>
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-1" />
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* ── Integrations (chat platforms) ── */}
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Integrations</h3>
                  <div className="flex flex-col gap-3">
                    <SlackIntegrationCard />
                    <TelegramIntegrationCard />
                    <ZaloIntegrationCard />
                  </div>
                </div>
                <Separator className="mb-6" />

                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Add a Connector</h3>
                  <p className="text-sm text-muted-foreground mb-3">Browse and connect data sources</p>
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {[
                      { key: "all", label: "All" },
                      { key: "analytics", label: "Analytics" },
                      { key: "advertising", label: "Advertising" },
                      { key: "operations", label: "Operations" },
                      { key: "finance", label: "Finance" },
                      { key: "e-commerce", label: "E-Commerce" },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setMarketplaceTab(tab.key as MarketplaceTab)}
                        className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                          marketplaceTab === tab.key
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {connectorsLoading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: CONNECTORS.length }).map((_, i) => (
                      <Card key={i} className="animate-pulse p-4 h-[80px]" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {marketplaceConnectors.map((connector) => {
                      const status = connectorStatus[connector.name];
                      const overviewMatch = connectorOverview.find(
                        (item) => item.display_name === connector.name
                      );
                      const isConnected = Boolean(status?.connected || overviewMatch?.connected);
                      const isSoon = !connector.isActive;
                      const connectorDescription =
                        CONNECTOR_CARD_DESCRIPTIONS[connector.name] || "Connect this data source to build dashboards faster.";

                      return (
                        <Card
                          key={connector.name}
                          onClick={() => !isSoon && handleIntegrationClick(connector.name)}
                          className={`p-4 h-[92px] transition-all ${isSoon ? "opacity-55" : "hover:border-primary/40 cursor-pointer"}`}
                        >
                          <div className="flex items-center justify-between h-full">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 ${connector.iconBg ?? 'bg-muted dark:bg-white/5'} ${isSoon ? "grayscale" : ""}`}>
                                <img
                                  src={connector.icon}
                                  alt={connector.name}
                                  className={`w-7 h-7 object-contain ${connector.name === 'TikTok Ads' ? 'scale-125' : ''}`}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-medium text-sm text-foreground">{connector.name}</h3>
                                <span className="text-xs text-muted-foreground block truncate">{connectorDescription}</span>
                              </div>
                            </div>
                            {isSoon ? (
                              <Badge variant="secondary" className="text-xs font-normal">Coming soon</Badge>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleIntegrationClick(connector.name); }}
                                className="w-fit px-4 py-1.5 button-outline text-xs rounded-md inline-flex items-center justify-center mt-1"
                              >
                                Connect
                              </button>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}


          {/* ════ FILES TAB ════ */}
          {activeTab === "files" && (
            <WorkspaceFiles />
          )}

          {/* ════ SETTINGS TAB ════ */}
          {activeTab === "settings" && (
            <div className="flex gap-0 min-h-full">
              {/* Settings sidebar */}
              <aside className="w-52 flex-shrink-0 border-r border-border/40 pr-4 self-start sticky top-0">
                <nav className="space-y-0.5">
                  {(
                    [
                      { key: "plans"       as SettingsSection, label: "Plans & credits", Icon: Sparkles  },
                      { key: "account"     as SettingsSection, label: "Manage Account",  Icon: UserIcon  },
                      { key: "preferences" as SettingsSection, label: "Preferences",     Icon: Settings  },
                    ] as { key: SettingsSection; label: string; Icon: React.ElementType }[]
                  ).map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => { setSettingsSection(key); setSearchParams({ tab: "settings", section: key }); }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
                        settingsSection === key
                          ? "bg-foreground/10 text-foreground"
                          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                      )}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${settingsSection === key ? "text-primary" : "text-muted-foreground"}`} />
                      <span>{label}</span>
                    </button>
                  ))}
                </nav>
              </aside>

              {/* Settings content — fills remaining width */}
              <div className="flex-1 min-w-0 pl-6">
                {settingsSection === "plans"       && <PlansCreditsContent />}
                {settingsSection === "account"     && <AccountSettings />}
                {settingsSection === "preferences" && <PreferencesContent />}
              </div>
            </div>
          )}

          {/* ════ PRIVACY POLICY TAB ════ */}
          {activeTab === "privacy" && (
            <WorkspaceDocsView
              metadata={PRIVACY_METADATA}
              toc={PRIVACY_TOC}
              containerRef={mainRef}
              currentTab="privacy"
              onSwitch={(tab) => { setActiveTab(tab); setSearchParams({ tab }); }}
            >
              <PrivacyContent />
            </WorkspaceDocsView>
          )}

          {/* ════ TERMS OF SERVICE TAB ════ */}
          {activeTab === "terms" && (
            <WorkspaceDocsView
              metadata={TERMS_METADATA}
              toc={TERMS_TOC}
              containerRef={mainRef}
              currentTab="terms"
              onSwitch={(tab) => { setActiveTab(tab); setSearchParams({ tab }); }}
            >
              <TermsContent />
            </WorkspaceDocsView>
          )}

          {/* ════ SCHEDULES TAB ════ */}
          {activeTab === "schedules" && (
            <ScheduleManager projectId={projects[0]?.id ?? ""} />
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
                      <div className="w-full aspect-[4/5] bg-muted/50" />
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
                      const tA = a.updated_at ? Date.parse(a.updated_at) : 0;
                      const tB = b.updated_at ? Date.parse(b.updated_at) : 0;
                      return tB - tA; // newest first
                    })
                    .map((project) => {
                    const title = project.dashboard_title || project.name || "Untitled Dashboard";
                    const source = getSource(project);
                    const previewUrl = previewUrls[project.id];
                    const createdAt = project.updated_at
                      ? formatToDisplay(project.updated_at, { format: "full" })
                      : null;

                    return (
                      <Card
                        key={project.id}
                        onClick={() => navigate(`/workspace/project?projectId=${project.id}`)}
                        className="overflow-hidden hover:border-primary/40 cursor-pointer transition-all group"
                      >
                        {/* 16:9 preview area */}
                        <div className="w-full aspect-[4/5] overflow-hidden relative bg-gradient-to-br from-violet-500/10 via-blue-500/8 to-cyan-500/5">
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
                          <rect x="16" y="62" width="16" height="20" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.5" />
                          <rect x="40" y="54" width="16" height="28" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.75" />
                          <rect x="64" y="66" width="16" height="16" rx="3" fill={`url(#dbG2-${project.id})`} opacity="0.55" />
                          <rect x="88" y="58" width="16" height="24" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.85" />
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
    )
  }
        </main >
      </div >

    {/* Rename / Delete Dialog */ }
  {
    dialog.open && (
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
    )
  }
    <ProductNewsModal
      open={newsModalOpen}
      feature={activeNewsItem}
      onClose={() => setNewsModalOpen(false)}
      onExplore={handleNewsExplore}
    />
    <OnboardingModal
      open={onboardingModalOpen}
      onDismiss={handleDismissOnboarding}
    />
    </div >
  );
}
