import { type ElementType, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  CreditCard,
  Database,
  Grid2X2,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  MessageSquarePlus,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Table2,
} from "lucide-react";
import { CONNECTORS, type ConnectorItem, type ConnectorModalTarget, type ProductConnectorCategory } from "@/constants/connectors";
import { useChatStore } from "@/chat/useChatStore";
import { Button } from "@/components/ui/button";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";
import { FooterSection } from "@/components/homepage-section/footer-section";
import VideoBackground from "@/components/homepage-section/VideoBackground";
import WaveBackground from "../../../src/ui/lightswind/wave-background";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

type ConnectorFilter = "All Connectors" | ProductConnectorCategory;

const CONNECTOR_FILTERS: { label: ConnectorFilter; Icon: ElementType }[] = [
  { label: "All Connectors", Icon: Grid2X2 },
  { label: "Advertising", Icon: Megaphone },
  { label: "Analytics", Icon: BarChart3 },
  { label: "Spreadsheets", Icon: Table2 },
  { label: "Databases", Icon: Database },
  { label: "Finance", Icon: CreditCard },
  { label: "Mobile & Attribution", Icon: Smartphone },
];

const WORKFLOW_STEPS = [
  { title: "Connect", description: "Securely connect the tools your team already uses.", Icon: PlugZap },
  { title: "Sync", description: "Bring fresh metrics into one reliable workspace.", Icon: RefreshCw },
  { title: "Ask", description: "Use natural language to explore the data behind the numbers.", Icon: MessageCircle },
  { title: "Dashboard", description: "Turn answers into shareable AI dashboards.", Icon: LayoutDashboard },
];

const LIVE_PRODUCT_CONNECTORS = CONNECTORS.filter(
  (connector) => connector.isActive && connector.showOnProductPage === true,
);
const LOGO_WALL_CONNECTORS = CONNECTORS.filter((connector) => connector.name !== "Amazon Seller");

export default function ProductDataConnectorsPage() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const { resolvedTheme } = useTheme();
  const connectorsRef = useRef<HTMLElement>(null);
  const [activeFilter, setActiveFilter] = useState<ConnectorFilter>("All Connectors");
  const [searchQuery, setSearchQuery] = useState("");
  const {
    setGA4ModalOpen,
    setGoogleSheetsModalOpen,
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
    setStripeModalOpen,
    setGoogleAdsModalOpen,
    setFirebaseModalOpen,
    setWarehouseModalOpen,
  } = useChatStore();

  const filteredConnectors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return LIVE_PRODUCT_CONNECTORS.filter((connector) => {
      const matchesFilter =
        activeFilter === "All Connectors" || connector.productCategory === activeFilter;
      const searchableText = [
        connector.name,
        connector.productDescription,
        connector.productCategory,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesFilter && (!query || searchableText.includes(query));
    });
  }, [activeFilter, searchQuery]);

  const openConnectorModal = (target?: ConnectorModalTarget) => {
    const modalOpeners: Record<ConnectorModalTarget, () => void> = {
      ga4: () => setGA4ModalOpen(true),
      google_sheets: () => setGoogleSheetsModalOpen(true),
      meta_ads: () => setMetaAdsModalOpen(true),
      tiktok_ads: () => setTikTokModalOpen(true),
      appsflyer: () => setAppsFlyerModalOpen(true),
      stripe: () => setStripeModalOpen(true),
      google_ads: () => setGoogleAdsModalOpen(true),
      firebase: () => setFirebaseModalOpen(true),
      postgres: () => setWarehouseModalOpen(true),
    };

    if (!target) {
      navigate("/workspace?tab=connectors");
      return;
    }

    modalOpeners[target]();
  };

  const handleConnectorClick = (connector: ConnectorItem) => {
    if (!isSignedIn) {
      navigate("/login");
      return;
    }

    openConnectorModal(connector.modalTarget);
  };

  const scrollToConnectors = () => {
    connectorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen overflow-y-auto homepage-scrollbar bg-background text-foreground">
      {resolvedTheme === "dark" ? (
        <WaveBackground className="fixed inset-0 z-0" />
      ) : (
        <VideoBackground className="fixed inset-0 z-0" />
      )}
      <div className={cn("fixed inset-0 z-[1]", resolvedTheme === "dark" ? "bg-black/70" : "bg-white/35")} />

      <main className="relative z-10">
        <section className="relative flex min-h-[78vh] items-center px-5 pb-16 pt-44 sm:px-8 lg:pt-36">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="text-center lg:text-left">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                100+ data connectors
              </div>
              <h1
                className="font-instrument-serif text-5xl font-semibold italic leading-[0.95] tracking-normal text-foreground dark:text-white sm:text-6xl lg:text-7xl"
                aria-label="Connect live data. Build AI dashboards."
              >
                Connect live data.
                <span className="block text-primary">Build AI dashboards.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg lg:mx-0">
                Bring ads, analytics, spreadsheets, databases, finance, ecommerce, and operations data into Dreamify. Start with live connectors today, and request any source your team needs next.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <Button
                  onClick={scrollToConnectors}
                  className="button-gradient h-11 rounded-md px-6 text-sm text-white"
                >
                  Explore connectors
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate(isSignedIn ? "/workspace?tab=connectors" : "/login")}
                  className="h-11 rounded-md px-6 text-sm"
                >
                  {isSignedIn ? "Go to workspace" : "Log in"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="glass-panel rounded-lg border border-border/60 bg-background/55 p-4 shadow-2xl shadow-primary/10 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Connector universe</p>
                  <p className="mt-1 text-sm text-foreground/80">Ads, analytics, commerce, finance, databases, and team tools</p>
                </div>
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-5">
                {LOGO_WALL_CONNECTORS.map((connector) => (
                  <div
                    key={connector.name}
                    aria-label={connector.name}
                    title={connector.name}
                    className="flex aspect-square items-center justify-center rounded-md border border-border/60 bg-background/70 p-2"
                  >
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-md sm:h-11 sm:w-11", connector.iconBg ?? "bg-muted dark:bg-white/5")}>
                      <img
                        src={connector.icon}
                        alt=""
                        className={cn("h-7 w-7 object-contain sm:h-8 sm:w-8", connector.name === "TikTok Ads" && "scale-125")}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1">Advertising</span>
                <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1">Analytics</span>
                <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1">Ecommerce</span>
                <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1">Databases</span>
              </div>
            </div>
          </div>
        </section>

        <section ref={connectorsRef} className="relative px-5 py-12 sm:px-8" id="connectors">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Live connectors you can use today</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Connect in minutes. Your data stays private, and every source can become part of a dashboard workflow.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Enterprise-grade security
              </div>
            </div>

            <div className="mb-6 flex flex-col gap-3">
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search connectors"
                  className="h-10 w-full rounded-md border border-border bg-background/80 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                  type="search"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {CONNECTOR_FILTERS.map(({ label, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setActiveFilter(label)}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                      activeFilter === label
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredConnectors.map((connector) => (
                <button
                  key={connector.name}
                  type="button"
                  onClick={() => handleConnectorClick(connector)}
                  className="group flex min-h-[92px] w-full items-center gap-4 rounded-lg border border-border bg-background/75 p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:border-primary/45 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`${isSignedIn ? "Connect" : "Log in to connect"} ${connector.name}`}
                >
                  <span className={cn("flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md", connector.iconBg ?? "bg-muted dark:bg-white/5")}>
                    <img
                      src={connector.icon}
                      alt=""
                      className={cn("h-8 w-8 object-contain", connector.name === "TikTok Ads" && "scale-125")}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{connector.name}</span>
                    <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted-foreground">
                      {connector.productDescription}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </button>
              ))}
            </div>

            {filteredConnectors.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-background/65 p-8 text-center">
                <p className="text-sm font-medium text-foreground">No live connector matches that search.</p>
                <p className="mt-1 text-sm text-muted-foreground">Try another category or request the connector your team needs.</p>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-4 rounded-lg border border-primary/15 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <MessageSquarePlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Need another connector?</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tell us what you need next. Dreamify uses connector requests to prioritize the sources teams ask for most.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="h-10 rounded-md px-4">
                <Link to="/feedback" target="_blank" rel="noopener noreferrer">
                  Request a connector
                  <MessageSquarePlus className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="relative px-5 pb-16 pt-3 sm:px-8">
          <div className="mx-auto grid max-w-6xl gap-3 rounded-lg border border-border bg-background/70 p-4 backdrop-blur-md md:grid-cols-[1.1fr_repeat(4,1fr)] md:items-center">
            <h2 className="font-instrument-serif text-3xl italic text-primary">How it works</h2>
            {WORKFLOW_STEPS.map(({ title, description, Icon }, index) => (
              <div key={title} className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{title}</span>
                    {index < WORKFLOW_STEPS.length - 1 && (
                      <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground xl:block" />
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <FooterSection />
      </main>
      <FeedbackFloatingButton />
    </div>
  );
}
