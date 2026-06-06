import { type ElementType, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  FolderKanban,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { IntegrationContent } from "@/content/integrations";
import type { WorkspaceContent } from "@/content/workspaces";
import { cn } from "@/lib/utils";

type PlatformMeta = {
  Logo: ElementType;
  logoBg: string;
};

const glass =
  "rounded-2xl border border-slate-200/75 bg-white/72 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur-2xl dark:border-white/12 dark:bg-zinc-950/58";
const innerGlass =
  "rounded-xl border border-slate-200/75 bg-white/68 shadow-[0_10px_26px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-white/6";
const softButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-white/40 px-3 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-xl transition-colors hover:border-primary/40 hover:bg-white/55 dark:border-white/10 dark:bg-white/8 dark:text-white";

function connectorExamples(integration: IntegrationContent) {
  const dataOptions = integration.sampleDashboards.slice(0, 3).map((dashboard) => dashboard.title);
  const metricFallback = integration.metrics.slice(0, 3);
  const accountName = integration.category.includes("Database")
    ? `Example ${integration.name} warehouse`
    : integration.category.includes("Analytics")
      ? `Example ${integration.name} property`
      : integration.category.includes("Finance")
        ? `Example ${integration.name} account`
        : `Example ${integration.name} account`;

  return {
    accounts: [
      accountName,
      integration.category.includes("Advertising") ? "Example Growth Team Ads" : `Example ${integration.name} production`,
    ],
    projects: ["Example Growth Project", "Example Weekly KPI Board"],
    data: dataOptions.length > 0 ? dataOptions : metricFallback,
  };
}

export function ConnectorMockModalPreview({ integration }: { integration: IntegrationContent }) {
  const examples = useMemo(() => connectorExamples(integration), [integration]);
  const [tab, setTab] = useState<"new" | "connected">("new");
  const [account, setAccount] = useState(examples.accounts[0]);
  const [project, setProject] = useState(examples.projects[0]);
  const [data, setData] = useState(examples.data[0] ?? "Campaign performance");
  const [dateRange, setDateRange] = useState("Last 30 days");

  return (
    <div className={cn(glass, "mx-auto w-full max-w-[560px] p-4 sm:p-5")} role="dialog" aria-label={`Mock ${integration.name} connector modal`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/75 dark:border-white/10 dark:bg-white/8", integration.iconBg)}>
            <img src={integration.icon} alt="" className="h-9 w-9 object-contain" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">Connect {integration.name}</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/12 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Mock
              </span>
            </div>
            <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
              Interactive example account. No API calls, no backend sync.
            </p>
          </div>
        </div>
        <div className="hidden h-9 w-9 items-center justify-center rounded-xl border border-slate-200/70 bg-white/70 text-primary dark:border-white/10 dark:bg-white/8 sm:flex">
          <ShieldCheck className="h-4 w-4" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200/70 bg-slate-100/60 p-1 dark:border-white/10 dark:bg-white/7">
        {[
          { value: "new", label: "Connect New" },
          { value: "connected", label: "Connected Data" },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value as typeof tab)}
            className={cn(
              "h-9 rounded-lg text-sm font-semibold transition-all",
              tab === item.value
                ? "bg-white text-slate-950 shadow-sm dark:bg-white/16 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {tab === "new" ? (
          <>
            <MockSelect
              icon={Link2}
              label="Example Account"
              value={account}
              options={examples.accounts}
              onChange={setAccount}
            />
            <MockSelect
              icon={FolderKanban}
              label="Example Project"
              value={project}
              options={examples.projects}
              onChange={setProject}
            />
            <div className={cn(innerGlass, "p-3")}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Database className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Example Data</p>
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">{data}</p>
                  </div>
                </div>
                <button type="button" className={softButton} onClick={() => setDateRange(dateRange === "Last 30 days" ? "Last 7 days" : "Last 30 days")}>
                  <CalendarDays className="h-4 w-4" />
                  {dateRange}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {examples.data.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setData(option)}
                    className={cn(
                      "min-h-16 rounded-xl border px-3 py-2 text-left text-xs font-semibold leading-5 transition-all",
                      data === option
                        ? "border-primary/45 bg-primary/10 text-primary"
                        : "border-slate-200/75 bg-white/64 text-slate-600 hover:border-primary/30 dark:border-white/10 dark:bg-white/7 dark:text-slate-300",
                    )}
                  >
                    <span className="mb-1 flex items-center gap-1.5">
                      {data === option ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
                      Source
                    </span>
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className={cn(innerGlass, "p-4")}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-950 dark:text-white">{account}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Last synced just now • {project}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {["Rows", "Fields", "Freshness"].map((label, index) => (
                <div key={label} className="rounded-xl border border-slate-200/70 bg-white/64 p-3 dark:border-white/10 dark:bg-white/7">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-950 dark:text-white">{["12.4K", "38", "Live"][index]}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => setTab("connected")}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_12px_30px_rgba(37,99,235,0.28)] transition-transform hover:-translate-y-0.5"
        >
          Use example data
          <Sparkles className="h-4 w-4" />
        </button>
        <button type="button" className={softButton}>
          Preview dashboard
          <LayoutDashboard className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function WorkspaceMockModalPreview({
  workspace,
  meta,
}: {
  workspace: WorkspaceContent;
  meta: PlatformMeta;
}) {
  const [destination, setDestination] = useState(`#example-${workspace.slug}`);
  const [report, setReport] = useState(workspace.useCases[0]?.persona ?? "Example report");
  const [cadence, setCadence] = useState("Daily at 9:00");
  const [workspaceAccount, setWorkspaceAccount] = useState(`Example ${workspace.name} workspace`);

  return (
    <div className={cn(glass, "mx-auto w-full max-w-[560px] p-4 sm:p-5")} role="dialog" aria-label={`Mock ${workspace.name} workspace modal`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm", meta.logoBg)}>
            <meta.Logo className="h-8 w-8" aria-hidden />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">Connect {workspace.name}</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/12 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Example
              </span>
            </div>
            <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
              Mock workspace setup. Try the controls, no messages are sent.
            </p>
          </div>
        </div>
        <span className="hidden h-9 w-9 items-center justify-center rounded-xl border border-slate-200/70 bg-white/70 text-primary dark:border-white/10 dark:bg-white/8 sm:flex">
          <MessageSquare className="h-4 w-4" />
        </span>
      </div>

      <div className="space-y-3">
        <MockSelect
          icon={MessageSquare}
          label="Example Workspace"
          value={workspaceAccount}
          options={[`Example ${workspace.name} workspace`, "Example Ops workspace"]}
          onChange={setWorkspaceAccount}
        />
        <MockSelect
          icon={Send}
          label="Example Destination"
          value={destination}
          options={[`#example-${workspace.slug}`, "#growth-reports", "#leadership-kpis"]}
          onChange={setDestination}
        />
        <MockSelect
          icon={BarChart3}
          label="Example Report"
          value={report}
          options={workspace.useCases.map((item) => item.persona)}
          onChange={setReport}
        />
        <div className={cn(innerGlass, "p-3")}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <RefreshCw className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Schedule</p>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">{cadence}</p>
              </div>
            </div>
            <button type="button" className={softButton} onClick={() => setCadence(cadence === "Daily at 9:00" ? "Weekly Monday" : "Daily at 9:00")}>
              Change
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-primary/20 bg-primary/8 p-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
        <span className="font-bold text-slate-950 dark:text-white">Preview:</span> Dreamify will post a fresh dashboard to {destination} for {report.toLowerCase()}.
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_12px_30px_rgba(37,99,235,0.28)] transition-transform hover:-translate-y-0.5"
        >
          Use example workspace
          <Check className="h-4 w-4" />
        </button>
        <button type="button" className={softButton}>
          Send test preview
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MockSelect({
  icon: Icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: ElementType;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className={cn("relative", isOpen ? "z-40" : "z-10")}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          innerGlass,
          "relative flex w-full cursor-pointer items-center justify-between gap-3 p-3 text-left transition-colors hover:border-primary/35",
          isOpen && "border-primary/45 bg-white/80 shadow-[0_18px_42px_rgba(37,99,235,0.13)] dark:bg-white/10",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</span>
            <span className="mt-0.5 block truncate text-sm font-bold text-slate-950 dark:text-white">{value}</span>
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 flex-shrink-0 text-slate-500 transition-transform", isOpen && "rotate-180")} />
      </button>

      <div
        id={listboxId}
        role="listbox"
        aria-label={label}
        className={cn(
          "absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-2 text-slate-950 shadow-[0_22px_60px_rgba(15,23,42,0.20)] backdrop-blur-2xl transition-all duration-150 dark:border-white/12 dark:bg-popover dark:text-popover-foreground",
          isOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
        )}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={value === option}
            onClick={() => {
              onChange(option);
              setIsOpen(false);
            }}
            className={cn(
              "block w-full rounded-xl px-4 py-3 text-left text-sm font-bold leading-5 transition-colors hover:bg-primary hover:text-primary-foreground",
              value === option
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-slate-950 dark:text-popover-foreground",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
