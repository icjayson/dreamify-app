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
  ShoppingBag,
  Smartphone,
  Table2,
  Users,
} from "lucide-react";
import { CONNECTORS, type ConnectorItem, type ConnectorModalTarget, type ProductConnectorCategory } from "@/constants/connectors";
import { useChatStore } from "@/chat/useChatStore";
import Seo from "@/components/seo/Seo";
import { INTEGRATIONS } from "@/content/integrations";
import { slugify } from "@/utils/slugify";
import { Button } from "@/components/ui/button";
import FeedbackModal from "@/components/ui/FeedbackModal";
import { FeedbackFloatingButton } from "@/components/ui/feedback-button";
import { FooterSection } from "@/components/homepage-section/footer-section";
import { ProductFaqAccordion } from "@/components/seo/ProductFaqAccordion";
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
  { label: "Sales & CRM", Icon: Users },
  { label: "Ecommerce", Icon: ShoppingBag },
  { label: "Finance", Icon: CreditCard },
  { label: "Mobile & Attribution", Icon: Smartphone },
];

const WORKFLOW_STEPS = [
  { title: "Connect", description: "Securely connect the tools your team already uses.", Icon: PlugZap },
  { title: "Sync", description: "Bring fresh metrics into one reliable workspace.", Icon: RefreshCw },
  { title: "Ask", description: "Use natural language to explore the data behind the numbers.", Icon: MessageCircle },
  { title: "Dashboard", description: "Turn answers into shareable AI dashboards.", Icon: LayoutDashboard },
];

// Shared between visible FAQ section and FAQPage JSON-LD — keeping a single source
// of truth ensures Google can validate the rich-result eligibility.
const DATA_CONNECTORS_FAQ: { question: string; answer: string }[] = [
  {
    question: "What are data connectors?",
    answer:
      "A data connector is a live, authenticated link between Dreamify and one of your business systems — your ad accounts, analytics, payment processor, ecommerce store, spreadsheets, or warehouse. Once connected, Dreamify reads the source on a schedule, joins the data with everything else you've connected, and uses it to generate AI dashboards on demand. No SQL, no data modeling, no manual exports.\n\nDreamify ships native connectors for the platforms marketers, founders, and operators actually use: Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Shopify, HubSpot, Salesforce, Pipedrive, Google Sheets, PostgreSQL, BigQuery, Snowflake, Databricks, and Supabase. Each connector is read-only by default and uses OAuth or scoped credentials for security.",
  },
  {
    question: "Which data sources does Dreamify connect to?",
    answer:
      "Native connectors today include Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Shopify, HubSpot, Salesforce, Pipedrive, Google Sheets, PostgreSQL, BigQuery, Snowflake, Databricks, and Supabase. More are added on a rolling basis based on the connector requests teams submit.",
  },
  {
    question: "Do I need to write SQL or build a data model?",
    answer:
      "No. Connect a source, describe the dashboard you want in plain language, and Dreamify generates the metrics, chart types, and breakdowns automatically. SQL is available if you want to override or extend the generated queries.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Yes. Dreamify uses OAuth read-only scopes for SaaS sources and read-only roles for databases. All credentials are encrypted at rest and never exposed in the UI. Connections support SSL and SSH tunneling for databases.",
  },
  {
    question: "Can I combine multiple data sources in one dashboard?",
    answer:
      "Yes. Dreamify joins ad spend from Meta, Google, and TikTok with conversion data from GA4 or your database automatically using UTM and campaign identifiers.",
  },
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const {
    setGA4ModalOpen,
    setGoogleSheetsModalOpen,
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
    setStripeModalOpen,
    setHubSpotModalOpen,
    setSalesforceModalOpen,
    setPipedriveModalOpen,
    setSupabaseModalOpen,
    setShopifyModalOpen,
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
      hubspot: () => setHubSpotModalOpen(true),
      salesforce: () => setSalesforceModalOpen(true),
      pipedrive: () => setPipedriveModalOpen(true),
      supabase: () => setSupabaseModalOpen(true),
      shopify: () => setShopifyModalOpen(true),
      google_ads: () => setGoogleAdsModalOpen(true),
      firebase: () => setFirebaseModalOpen(true),
      postgres: () => setWarehouseModalOpen(true, "postgres"),
      bigquery: () => setWarehouseModalOpen(true, "bigquery"),
      snowflake: () => setWarehouseModalOpen(true, "snowflake"),
      databricks: () => setWarehouseModalOpen(true, "databricks"),
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

  // Map a connector to its SEO deep-page slug, if one exists in the content modules.
  const slugForConnector = (connector: ConnectorItem): string | null => {
    const candidate = slugify(connector.name);
    return INTEGRATIONS.some((i) => i.slug === candidate) ? candidate : null;
  };

  const scrollToConnectors = () => {
    connectorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <Seo
        title="Data Connectors — Dreamify | Live Connectors for AI Dashboards"
        description="Connect Meta Ads, Google Ads, GA4, TikTok Ads, AppsFlyer, Firebase, Stripe, Shopify, HubSpot, Salesforce, Pipedrive, Google Sheets, PostgreSQL, BigQuery, Snowflake, Databricks, and Supabase to Dreamify. Live data into AI dashboards in minutes."
        canonical="https://app.dreamify.dev/product/data-connectors"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": "https://app.dreamify.dev/product/data-connectors#webpage",
            name: "Dreamify Data Connectors",
            url: "https://app.dreamify.dev/product/data-connectors",
            description:
              "Native data connectors that power AI dashboards in Dreamify. Connect ads, analytics, finance, ecommerce, spreadsheets, and warehouses.",
            isPartOf: { "@id": "https://app.dreamify.dev/#website" },
            about: { "@id": "https://app.dreamify.dev/#organization" },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Dreamify", item: "https://app.dreamify.dev/" },
              { "@type": "ListItem", position: 2, name: "Product", item: "https://app.dreamify.dev/landingpage" },
              { "@type": "ListItem", position: 3, name: "Data Connectors", item: "https://app.dreamify.dev/product/data-connectors" },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Dreamify Data Connectors",
            itemListElement: LIVE_PRODUCT_CONNECTORS.map((c, i) => {
              const slug = slugify(c.name);
              const hasSeoPage = INTEGRATIONS.some((x) => x.slug === slug);
              return {
                "@type": "ListItem",
                position: i + 1,
                name: c.name,
                url: hasSeoPage
                  ? `https://app.dreamify.dev/product/data-connectors/${slug}`
                  : "https://app.dreamify.dev/product/data-connectors",
              };
            }),
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: DATA_CONNECTORS_FAQ.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
        ]}
      />
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
                aria-label="Data Connectors — connect live data and build AI dashboards in Dreamify"
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
              {filteredConnectors.map((connector) => {
                const slug = slugForConnector(connector);
                const cardClassName = "group flex min-h-[92px] w-full items-center gap-4 rounded-lg border border-border bg-background/75 p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:border-primary/45 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";
                const inner = (
                  <>
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
                  </>
                );

                if (slug) {
                  return (
                    <Link
                      key={connector.name}
                      to={`/product/data-connectors/${slug}`}
                      className={cardClassName}
                      aria-label={`Learn about the ${connector.name} connector`}
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button
                    key={connector.name}
                    type="button"
                    onClick={() => handleConnectorClick(connector)}
                    className={cardClassName}
                    aria-label={`${isSignedIn ? "Connect" : "Log in to connect"} ${connector.name}`}
                  >
                    {inner}
                  </button>
                );
              })}
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
              <Button
                variant="outline"
                onClick={() => setFeedbackOpen(true)}
                className="h-10 rounded-md px-4"
              >
                Request a connector
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        <section className="relative px-5 pb-16 pt-5 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  How it works
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Connect once, keep the sync fresh, ask questions in plain language, and turn the answer into a dashboard.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Read-only by default
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/75 bg-white/70 p-5 shadow-[0_18px_54px_rgba(15,23,42,0.10)] backdrop-blur-2xl dark:border-white/12 dark:bg-zinc-950/56 sm:p-7">
              <div className="grid gap-8 md:grid-cols-4 md:gap-5">
                {WORKFLOW_STEPS.map(({ title, description }, index) => (
                  <div key={title} className="relative text-center">
                    {index < WORKFLOW_STEPS.length - 1 && (
                      <div
                        className="pointer-events-none absolute left-[calc(50%+1.75rem)] right-[calc(-50%+1.75rem)] top-5 hidden border-t border-dashed border-primary/22 md:block"
                        aria-hidden="true"
                      />
                    )}
                    <div className="relative z-10 mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-primary/20 bg-primary/10 p-1 shadow-[0_0_0_6px_rgba(37,99,235,0.06)] dark:bg-primary/15">
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-[0_8px_22px_rgba(37,99,235,0.28)]">
                        {index + 1}
                      </span>
                    </div>
                    <h3 className="mt-4 text-sm font-bold text-slate-950 dark:text-white">
                      {title}
                    </h3>
                    <p className="mx-auto mt-2 max-w-[12rem] text-xs leading-5 text-slate-600 dark:text-slate-300">
                      {description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <ProductFaqAccordion
          headingId="data-connectors-faq"
          title="Frequently asked questions"
          description="The most common questions teams ask about Dreamify data connectors."
          items={DATA_CONNECTORS_FAQ}
        />

        <FooterSection />
      </main>
      <FeedbackFloatingButton />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        category="Request Connector & Workspace"
        placeholder="What connector would you like to see? (e.g. specific platform, database, API...)"
      />
    </div>
    </>
  );
}
