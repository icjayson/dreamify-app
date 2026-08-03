import React, { useEffect, useState, useRef } from 'react';
import { Link } from '@/lib/navigation';
import {
  BookOpen, Zap, FolderOpen, Upload, Bot, BarChart3,
  Plug, Bell, Calendar, CreditCard, HelpCircle,
  ArrowRight, Menu, ExternalLink, Info, Lightbulb,
  AlertTriangle, Hash, Globe, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Seo from '@/components/seo/Seo';

/* ─── Navigation items ───────────────────────────────── */

const NAV_ITEMS = [
  { id: 'overview',         label: 'Overview',          icon: BookOpen   },
  { id: 'getting-started',  label: 'Getting Started',   icon: Zap        },
  { id: 'projects',         label: 'Projects',          icon: FolderOpen },
  { id: 'file-upload',      label: 'File Upload',       icon: Upload     },
  { id: 'ai-chat',          label: 'AI Chat',           icon: Bot        },
  { id: 'dashboards',       label: 'Dashboards',        icon: BarChart3  },
  { id: 'integrations',     label: 'Connector Catalog', icon: Plug       },
  { id: 'workspace-agents', label: 'Agent Catalog',     icon: Bell       },
  { id: 'schedules',        label: 'Scheduling',        icon: Calendar   },
  { id: 'billing',          label: 'Free Preview Limits', icon: CreditCard },
  { id: 'faq',              label: 'FAQ',               icon: HelpCircle },
];

/* ─── Guide card data ────────────────────────────────── */

const GUIDE_CARDS = [
  { id: 'getting-started',  title: 'Getting Started',   desc: 'Sign up, create a project, and run your first AI query.',              icon: Zap        },
  { id: 'projects',         title: 'Projects',          desc: 'Isolated workspaces for files, dashboards, and chat history.',          icon: FolderOpen },
  { id: 'file-upload',      title: 'File Upload',       desc: 'Upload CSV, Excel, JSON — single or multi-file in one message.',        icon: Upload     },
  { id: 'ai-chat',          title: 'AI Chat',           desc: 'Chat with Morpheus using @chart and @dataset mentions.',                icon: Bot        },
  { id: 'dashboards',       title: 'Dashboards',        desc: 'Chart types, templates, layout editing, version history, and export.', icon: BarChart3  },
  { id: 'integrations',     title: 'Connector Catalog', desc: 'Review optional sources; every external connector is disabled by default.', icon: Plug       },
  { id: 'workspace-agents', title: 'Agent Catalog',     desc: 'Preview chat-platform concepts that are unavailable by default.',     icon: Bell       },
  { id: 'schedules',        title: 'Scheduling',        desc: 'Understand why recurring schedules are disabled in this profile.',    icon: Calendar   },
  { id: 'billing',          title: 'Free Preview Limits', desc: 'Daily technical run and storage limits for the Hobby demo.',          icon: CreditCard },
];

/* ─── Primitive components ────────────────────────────── */

type CalloutType = 'info' | 'tip' | 'warning' | 'note';

const CALLOUT_MAP: Record<CalloutType, { cls: string; Icon: React.ComponentType<{ className?: string }>; ic: string }> = {
  info:    { cls: 'border-primary/20 bg-primary/5',         Icon: Info,          ic: 'text-primary'          },
  tip:     { cls: 'border-border    bg-muted',              Icon: Lightbulb,     ic: 'text-foreground/60'    },
  warning: { cls: 'border-amber-500/30 bg-amber-500/8',     Icon: AlertTriangle, ic: 'text-amber-500'        },
  note:    { cls: 'border-border    bg-muted',              Icon: Info,          ic: 'text-muted-foreground' },
};

const Callout = ({
  type = 'info',
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}) => {
  const { cls, Icon, ic } = CALLOUT_MAP[type];
  return (
    <div className={cn('flex gap-3 p-4 rounded-xl border my-5', cls)}>
      <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', ic)} />
      <div className="text-sm leading-relaxed text-foreground/80 min-w-0">
        {title && <p className="font-semibold text-foreground mb-1">{title}</p>}
        {children}
      </div>
    </div>
  );
};

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="flex gap-4">
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div className="button-gradient w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold">
        {n}
      </div>
      <div className="w-px flex-1 bg-border min-h-[1.5rem]" />
    </div>
    <div className="flex-1 pb-6">
      <p className="font-semibold text-foreground text-sm mb-1 leading-6">{title}</p>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  </div>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="inline-flex items-center bg-muted border border-border text-foreground rounded-md px-1.5 py-0.5 text-[0.76rem] font-mono">
    {children}
  </code>
);

const SectionHeader = ({
  icon: Icon,
  title,
  id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  id: string;
}) => (
  <div id={id} className="flex items-center gap-3 mb-6 scroll-mt-6">
    <div className="icon-panel w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-primary" />
    </div>
    <h2 className="text-xl font-bold text-foreground">{title}</h2>
  </div>
);

const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mt-7 mb-3">
    {children}
  </h3>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>
);

const UL = ({ children }: { children: React.ReactNode }) => (
  <ul className="space-y-2 text-sm text-muted-foreground mb-4">{children}</ul>
);

const LI = ({ children }: { children: React.ReactNode }) => (
  <li className="flex items-start gap-2">
    <ChevronRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary/50" />
    <span>{children}</span>
  </li>
);

/* ─── Sidebar component ───────────────────────────────── */

const Sidebar = ({
  active,
  onNav,
}: {
  active: string;
  onNav: (id: string) => void;
}) => (
  <div className="flex flex-col h-full">
    {/* Brand */}
    <div className="flex items-center gap-2.5 px-5 h-14 border-b border-border flex-shrink-0">
      <Link
        to="/"
        className="flex items-center gap-2 text-foreground/70 hover:text-foreground transition-colors"
      >
        <BookOpen className="w-4 h-4" />
        <span className="text-sm font-semibold">Dreamify Docs</span>
      </Link>
    </div>

    {/* Nav */}
    <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
      <p className="px-3 mb-3 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">
        Contents
      </p>
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onNav(id)}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150',
            active === id
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/5'
          )}
        >
          <Icon className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{label}</span>
          {active === id && (
            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
          )}
        </button>
      ))}
    </nav>

    {/* Footer */}
    <div className="px-4 py-3 border-t border-border flex-shrink-0">
      <Link
        to="/"
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowRight className="w-3 h-3 rotate-180" />
        Back to app
      </Link>
    </div>
  </div>
);

/* ─── Main page ───────────────────────────────────────── */

const Docs = () => {
  const [active, setActive] = useState('overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const clicking = useRef(false);

  /* Scroll spy */
  useEffect(() => {
    const onScroll = () => {
      if (clicking.current) return;
      const offset = window.scrollY + 140;
      let cur = 'overview';
      for (const { id } of NAV_ITEMS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= offset) cur = id;
      }
      setActive(cur);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 120);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    clicking.current = true;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: 'smooth' });
    setActive(id);
    setMobileOpen(false);
    setTimeout(() => { clicking.current = false; }, 900);
  };

  return (
    <>
      <Seo
        title="Dreamify Docs — How to Build AI Dashboards"
        description="Dreamify Hobby demo documentation: file upload, AI chat, dashboards, BYOK, technical limits, and capability-gated features."
        canonical="https://dreamify-web.vercel.app/docs"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          "@id": "https://dreamify-web.vercel.app/docs#webpage",
          url: "https://dreamify-web.vercel.app/docs",
          name: "Dreamify Documentation",
          isPartOf: { "@id": "https://dreamify-web.vercel.app/#website" },
          inLanguage: "en",
        }}
      />
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Fixed sidebar (desktop) ── */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 border-r border-border bg-background z-30">
        <Sidebar active={active} onNav={scrollTo} />
      </aside>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 flex flex-col w-60 bg-background border-r border-border h-full">
            <Sidebar active={active} onNav={scrollTo} />
          </aside>
        </div>
      )}

      {/* ── Mobile top bar ── */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-12 border-b border-border bg-background/95 backdrop-blur flex items-center gap-3 px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 rounded-lg hover:bg-foreground/10 dark:hover:bg-white/10 transition-colors"
          aria-label="Open navigation"
        >
          <Menu className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold">Dreamify Docs</span>
      </header>

      {/* ── Main ── */}
      <main className="lg:ml-60">

        {/* Hero */}
        <section
          id="overview"
          className="relative overflow-hidden border-b border-border pt-20 pb-14 lg:pt-16 px-6 lg:px-10"
        >
          {/* Subtle gradient backdrop */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/4 via-transparent to-transparent pointer-events-none" />

          <div className="relative max-w-2xl">
            {/* Eyebrow badge */}
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary border border-primary/25 bg-primary/8 rounded-full px-3 py-1 mb-5">
              <BookOpen className="w-3 h-3" />
              Documentation
            </div>

            <h1 className="text-3xl lg:text-[2.5rem] font-extrabold tracking-tight text-foreground mb-3 leading-tight">
              Build AI-powered dashboards<br className="hidden sm:block" />
              with your own data
            </h1>

            <p className="text-base text-muted-foreground mb-8 max-w-lg leading-relaxed">
              Upload a supported data file, ask questions in plain language, and build editable visualizations in an invitation-only Hobby demo.
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => scrollTo('getting-started')}
                className="button-gradient px-5 py-2.5 font-medium text-sm transition-all duration-200 flex items-center gap-2 rounded-xl"
              >
                Quick Start <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <a
                href="https://discord.gg/GhFjdbgdxd"
                target="_blank"
                rel="noopener noreferrer"
                className="button-outline px-5 py-2.5 font-medium text-sm transition-all duration-200 flex items-center gap-2 rounded-xl"
              >
                Discord <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </section>

        {/* Guide card grid */}
        <section className="border-b border-border px-6 lg:px-10 py-10">
          <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-5">
            Guides
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-4xl">
            {GUIDE_CARDS.map(({ id, title, desc, icon: Icon }) => (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className="group text-left p-4 rounded-xl border border-border/70 bg-card hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5 transition-all duration-200"
              >
                <div className="icon-panel w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform duration-200 group-hover:scale-105">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1 group-hover:text-primary transition-colors duration-150">
                  {title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Content sections */}
        <div className="px-6 lg:px-10 py-12 pb-28 space-y-16 max-w-3xl">

          {/* ── Getting Started ── */}
          <section>
            <SectionHeader icon={Zap} title="Getting Started" id="getting-started" />
            <P>
              Dreamify is an invitation-only analytics demo. Upload supported files, ask questions in
              plain language, and build editable dashboards without a billing or credit-debit flow.
            </P>
            <div className="mt-6">
              <Step n={1} title="Create a project">
                Sign in and click <strong>New Project</strong> from the workspace sidebar. Each
                project is an isolated workspace for your data and dashboards.
              </Step>
              <Step n={2} title="Upload a data file">
                Upload a CSV, XLSX, XLS, or flat JSON file through the chat attach button. File
                upload is the only guaranteed data source in this release.
              </Step>
              <Step n={3} title="Ask Morpheus">
                Type a question in the chat —{' '}
                <em>"Build a dashboard of monthly revenue by channel"</em> — and Morpheus generates
                charts or a text answer through the bounded workflow.
              </Step>
            </div>
            <Callout type="tip" title="Best results">
              Dreamify works best with clean, structured data. Put headers in the first row and
              one record on each subsequent row; always verify generated analysis before using it.
            </Callout>
          </section>

          {/* ── Projects ── */}
          <section>
            <SectionHeader icon={FolderOpen} title="Projects" id="projects" />
            <H3>What is a Project?</H3>
            <P>
              A project is an isolated container. Each project holds its own uploaded files,
              conversation history, dashboards, and connector data. Nothing leaks between projects.
            </P>
            <H3>Creating a Project</H3>
            <P>
              Click <Code>New Project</Code> from the workspace sidebar and give it a name. The
              new project appears immediately in the left sidebar.
            </P>
            <H3>Renaming and Deleting</H3>
            <P>
              Open the project card menu (three-dot icon) to rename or delete. Deletion is
              permanent — all associated files, dashboards, and chat history are removed and
              cannot be recovered.
            </P>
            <H3>Switching Projects</H3>
            <P>
              Click any project in the left sidebar. The active project determines which files
              and dashboards appear in the chat and workspace views.
            </P>
          </section>

          {/* ── File Upload ── */}
          <section>
            <SectionHeader icon={Upload} title="File Upload" id="file-upload" />
            <H3>Supported Formats</H3>
            <UL>
              <LI><strong>CSV</strong> — comma-separated; UTF-8 or common encodings auto-detected</LI>
              <LI><strong>Excel</strong> — .xlsx and .xls; first sheet used by default</LI>
              <LI><strong>JSON</strong> — flat objects or array-of-objects structure</LI>
            </UL>
            <H3>Single File</H3>
            <P>
              Click the paperclip / attach button in the chat input, select a file, and it uploads
              to the current project. The file appears as a chip in your message before sending.
            </P>
            <H3>Multi-File</H3>
            <P>
              Attach <strong>multiple files to one message</strong> by clicking the attach button
              multiple times, up to three files and 25 MiB total per run. Morpheus reads all attached files together — enabling cross-file
              analysis like joining a sales CSV with an ad spend CSV in a single query.
            </P>
            <H3>Asset Management</H3>
            <P>
              All uploads are listed in the <strong>Files</strong> tab of the workspace. From there,
              preview inline (paginated CSV view) or delete. Deleting a file does not remove
              dashboards previously generated from it.
            </P>
            <Callout type="info">
              Each file must be 10 MiB or smaller, with at most 100,000 rows and 200 columns.
              Larger files are rejected in the Hobby demo; an optional connector is not a bypass unless it is explicitly certified and enabled.
            </Callout>
          </section>

          {/* ── AI Chat ── */}
          <section>
            <SectionHeader icon={Bot} title="AI Chat (Morpheus)" id="ai-chat" />
            <P>
              Morpheus is the Dreamify analysis workflow. Interact with it in plain language — it reads
              your uploaded data and either answers your question or generates a rendered
              dashboard.
            </P>
            <H3>Chat Modes</H3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
              {[
                {
                  label: 'Q&A Mode',
                  desc: 'Ask questions and get text answers, summaries, and data insights.',
                  eg: '"What was the top-selling product last month?"',
                },
                {
                  label: 'Dashboard Mode',
                  desc: 'Ask Morpheus to build charts. It selects types and lays out panels automatically.',
                  eg: '"Build a sales dashboard grouped by region."',
                },
              ].map((m) => (
                <div key={m.label} className="p-4 border border-border rounded-xl bg-card">
                  <p className="text-sm font-semibold text-foreground mb-1">{m.label}</p>
                  <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{m.desc}</p>
                  <p className="text-[11px] italic text-muted-foreground/60">{m.eg}</p>
                </div>
              ))}
            </div>
            <H3>@ Mentions — Reference Charts & Datasets</H3>
            <P>
              Type <Code>@</Code> anywhere in the chat input to open the context picker:
            </P>
            <UL>
              <LI>
                <strong>Charts</strong> — from the current dashboard, searchable by title or type
              </LI>
              <LI>
                <strong>Datasets</strong> — uploaded files, plus connector data only when a connector is explicitly enabled
              </LI>
            </UL>
            <P>
              Type <Code>@chart</Code> to filter to charts only. Continue typing to search —{' '}
              <Code>@chart revenue</Code> surfaces charts with "revenue" in the title. Selecting
              an item attaches it as a chip; Morpheus uses those chips as focused context. Chips
              can be removed individually before sending.
            </P>
            <H3>Model Selection</H3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
              {[
                { name: 'Thorough', badge: 'Demo mode', desc: 'Deeper analysis and multi-step planning for complex datasets.' },
                { name: 'Fast', badge: 'Demo mode', desc: 'Low latency for quick lookups and simple questions.' },
              ].map((m) => (
                <div key={m.name} className="p-4 border border-border rounded-xl bg-card">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-bold text-foreground">{m.name}</p>
                    <span className="text-[10px] text-muted-foreground bg-muted border border-border rounded-full px-2 py-0.5">
                      {m.badge}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
                </div>
              ))}
            </div>
            <Callout type="info" title="Technical run quotas">
              Billing and credit debits are disabled. Data analysis uses a daily technical run
              allowance; pure text questions have a separate daily allowance. The deterministic
              demo provider requires no LLM key, while OpenAI or Gemini requires encrypted BYOK.
            </Callout>
          </section>

          {/* ── Dashboards ── */}
          <section>
            <SectionHeader icon={BarChart3} title="Dashboards" id="dashboards" />
            <P>
              When you ask Morpheus to build a dashboard, it analyzes your data, selects
              appropriate chart types, and lays out panels automatically.
            </P>
            <H3>Supported Chart Types</H3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-4">
              {[
                'Bar Chart', 'Line Chart', 'Area Chart', 'Pie / Donut',
                'Scatter', 'Radar', 'Radial Bar', 'Funnel', 'Composed',
                'Treemap', 'Sankey', 'Metric Card',
              ].map((c) => (
                <div
                  key={c}
                  className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2 border border-border/60 rounded-lg bg-muted/30"
                >
                  <BarChart3 className="w-3 h-3 flex-shrink-0 text-primary/50" />
                  {c}
                </div>
              ))}
            </div>
            <H3>Templates</H3>
            <P>
              Dreamify includes pre-built dashboard templates for common use cases (e-commerce,
              marketing analytics, finance). Browse the Template Gallery to apply one —
              it pre-configures chart layout and styling. Upload a supported file after applying;
              use an external source only when the capability response marks it available.
            </P>
            <H3>Versioning & Export</H3>
            <P>
              Dashboard revisions are versioned so you can edit, compare, and restore an earlier
              result. Use the supported export controls when you need a local artifact.
            </P>
            <Callout type="warning" title="Public links disabled">
              Public dashboard publishing and anonymous preview links are not deployed in the
              Hobby release. A visible legacy mock is not an active sharing feature.
            </Callout>
          </section>

          {/* ── Integrations ── */}
          <section>
            <SectionHeader icon={Plug} title="Connector Catalog" id="integrations" />
            <P>
              Connector cards remain visible for UI parity, but every external connector fails
              closed. A connector becomes available only after server-side credentials, security
              checks, and a provider-specific smoke test succeed and the capabilities API enables it.
            </P>
            <H3>Planned OAuth Connector Coverage</H3>
            <div className="space-y-2 my-4">
              {[
                { name: 'Google Analytics 4', desc: 'Sessions, events, conversions, and traffic by dimension.' },
                { name: 'Google Sheets',       desc: 'Reads a sheet as a flat table. Paste a URL or pick from Drive.' },
                { name: 'Google Ads',          desc: 'Campaign performance, impressions, clicks, and spend.' },
                { name: 'Meta Ads',            desc: 'Ad account performance across campaigns and ad sets.' },
                { name: 'TikTok Ads',          desc: 'Campaign reach, video views, cost per result, and ROAS.' },
              ].map((c) => (
                <div
                  key={c.name}
                  className="flex items-start gap-3 px-4 py-3 border border-border/60 rounded-xl bg-card hover:border-primary/30 hover:bg-muted/20 transition-colors"
                >
                  <Globe className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <H3>Planned Credential-Based Coverage</H3>
            <div className="space-y-2 my-4">
              {[
                { name: 'AppsFlyer', desc: 'Install data, in-app events, and attribution by partner.' },
                { name: 'Firebase',  desc: 'Event analytics and user properties.' },
                { name: 'Stripe',    desc: 'Payment volume, MRR, subscription counts, and churn.' },
              ].map((c) => (
                <div
                  key={c.name}
                  className="flex items-start gap-3 px-4 py-3 border border-border/60 rounded-xl bg-card hover:border-primary/30 hover:bg-muted/20 transition-colors"
                >
                  <Hash className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <Callout type="warning" title="File upload is the release blocker">
              Do not infer availability from these catalog entries. The connector badge and
              <Code>GET /api/v1/capabilities</Code> response are authoritative. Unavailable actions
              are disabled and their APIs return a typed <Code>FEATURE_DISABLED</Code> error.
            </Callout>
          </section>

          {/* ── Workspace Agents ── */}
          <section>
            <SectionHeader icon={Bell} title="Workspace Agent Catalog" id="workspace-agents" />
            <P>
              Slack, Telegram, Zalo, and WhatsApp cards are catalog previews. They are unavailable
              by default and send no messages in the locked Hobby demo profile.
            </P>
            <H3>Certification Gates</H3>
            <div className="mt-3">
              <Step n={1} title="Configure credentials server-side">
                Provider secrets must never enter browser code, workflow payloads, Blob objects, Sandbox environments, or logs.
              </Step>
              <Step n={2} title="Verify the trust boundary">
                Signed OAuth state or webhook signatures, tenant isolation, and stable callback URLs must pass tests.
              </Step>
              <Step n={3} title="Pass the provider smoke test">
                The deployment owner enables the capability only after a real connection and bounded message test succeeds.
              </Step>
            </div>
            <Callout type="warning">
              Catalog screenshots and interactive mocks make no provider API call and do not prove that an integration is active.
            </Callout>
          </section>

          {/* ── Schedules ── */}
          <section>
            <SectionHeader icon={Calendar} title="Schedules" id="schedules" />
            <P>
              Scheduling is disabled in the locked Hobby demo profile. The workspace hides active
              schedule navigation, and schedule and sync-run APIs return <Code>FEATURE_DISABLED</Code>.
            </P>
            <H3>Why the UI Is Disabled</H3>
            <P>
              Vercel Hobby does not provide the precise per-minute scheduling contract needed for
              the legacy product. Enabling a future coarse dispatcher is a separate operational decision.
            </P>
            <H3>Separate Capability</H3>
            <P>
              Certifying a connector does not automatically enable scheduling. Both capabilities
              must be enabled independently, and database leases must prevent duplicate dispatch.
            </P>
            <Callout type="note">Use an explicit file upload for every guaranteed data run in this release.</Callout>
          </section>

          {/* ── Preview limits ── */}
          <section>
            <SectionHeader icon={CreditCard} title="Free Preview Limits" id="billing" />
            <H3>Deployment profile</H3>
            <div className="grid grid-cols-1 gap-3 my-5">
              {[
                { name: 'Hobby demo', price: 'Free Preview', features: ['5 data runs per user/day', '20 text runs per user/day', '10 MiB per file', 'Billing and credit debits disabled'], hi: true },
              ].map((p) => (
                <div
                  key={p.name}
                  className={cn(
                    'p-4 border rounded-xl',
                    p.hi
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-card'
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-foreground">{p.name}</p>
                    {p.hi
                      ? <span className="text-[10px] font-semibold text-white button-gradient rounded-full px-2 py-0.5">{p.price}</span>
                      : <span className="text-[10px] text-muted-foreground bg-muted border border-border rounded-full px-2 py-0.5">{p.price}</span>
                    }
                  </div>
                  <ul className="space-y-1.5">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="w-1 h-1 rounded-full bg-primary/60 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <H3>Technical usage quotas</H3>
            <P>
              Quotas protect the shared non-commercial deployment from exhausting Hobby storage,
              Workflow, and Sandbox capacity. They are operational limits, not a currency, and reset daily.
            </P>
            <H3>Checking remaining runs</H3>
            <P>
              The remaining daily data-run allowance appears in the user menu. For details open
              <strong>Account Center → Preview limits</strong>.
            </P>
            <Callout type="note">
              This deployment has no checkout, subscription, or credit-debit network flow.
            </Callout>
          </section>

          {/* ── FAQ ── */}
          <section>
            <SectionHeader icon={HelpCircle} title="FAQ" id="faq" />
            <div className="space-y-2">
              {[
                {
                  q: 'What data formats can I upload?',
                  a: 'CSV, Excel (.xlsx / .xls), and JSON (flat or array-of-objects structure).',
                },
                {
                  q: 'Can I upload multiple files at once?',
                  a: 'Yes — click the attach button multiple times to add files to one message. Morpheus reads all of them together for cross-file analysis.',
                },
                {
                  q: 'How do I reference a chart or dataset in chat?',
                  a: (
                    <>
                      Type <Code>@</Code> in the chat input. Use <Code>@chart</Code> to filter
                      to charts only, or type a dataset name to search. Selecting attaches a chip
                      that Morpheus uses as focused context.
                    </>
                  ),
                },
                {
                  q: 'Is my data used to train AI models?',
                  a: 'The default deterministic demo provider sends no data to an external AI model. If you enable OpenAI or Gemini with BYOK, that provider processes the minimum workflow context under your own provider account and its current terms.',
                },
                {
                  q: 'Can I share a dashboard publicly?',
                  a: 'No. Public dashboard links and anonymous preview APIs are disabled in this Hobby release. Use the supported export workflow instead.',
                },
                {
                  q: 'What happens to my data if I delete a project?',
                  a: 'All files, dashboards, and chat history are permanently deleted. This cannot be undone.',
                },
                {
                  q: 'How often is connector data refreshed?',
                  a: 'External connectors and scheduling are unavailable by default. File upload is the only guaranteed data-source workflow.',
                },
                {
                  q: 'What is the difference between Thorough and Fast modes?',
                  a: 'They select analysis depth within the preview workflow. Neither is a paid tier, and neither consumes credits. Both are subject to technical daily run quotas.',
                },
              ].map(({ q, a }) => (
                <div key={q} className="border border-border/60 rounded-xl overflow-hidden bg-card">
                  <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
                    <p className="text-sm font-semibold text-foreground">{q}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Support callout */}
            <div className="mt-8 flex items-start gap-4 p-5 border border-border rounded-xl bg-card">
              <div className="icon-panel w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
                <HelpCircle className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Still have questions?</p>
                <p className="text-sm text-muted-foreground">
                  Reach us at{' '}
                  <a href="mailto:dreamify.dev@gmail.com" className="text-primary hover:underline font-medium">
                    dreamify.dev@gmail.com
                  </a>{' '}
                  or join our{' '}
                  <a href="https://discord.gg/GhFjdbgdxd" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                    Discord community
                  </a>.
                </p>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
    </>
  );
};

export default Docs;
