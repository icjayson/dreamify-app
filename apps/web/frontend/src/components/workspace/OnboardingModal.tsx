import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  CalendarClock,
  Files,
  Link2,
  PlugZap,
  Sparkles,
} from "lucide-react";

interface OnboardingModalProps {
  open: boolean;
  onDismiss: () => void;
}

export default function OnboardingModal({ open, onDismiss }: OnboardingModalProps) {
  const items = useMemo(
    () => [
      {
        id: "welcome",
        title: "Welcome to Dreamify",
        tag: "GET STARTED",
        body: [
          "You're currently on the Pro plan and have full access while Dreamify is in early access.",
          "You get 1,000 credits each month to analyze data and generate dashboards.",
        ],
        icon: Sparkles,
      },
      {
        id: "multi-file-analyze",
        title: "Analyze multiple files in one run",
        tag: "MULTI-SOURCE ANALYTICS",
        body: [
          "Drop up to 5 CSV or Excel files and ask one question to compare metrics across datasets.",
          "Dreamify merges context automatically so you can identify trends and outliers faster.",
        ],
        icon: Files,
      },
      {
        id: "data-connectors",
        title: "Connect live data sources in minutes",
        tag: "DATA CONNECTORS",
        body: [
          "Link GA4, Google Ads, Sheets, Stripe, and more from one place.",
          "Use connector-based sync so your dashboards stay fresh without manual uploads.",
        ],
        icon: PlugZap,
      },
      {
        id: "templates",
        title: "Launch with beautiful dashboard templates",
        tag: "TEMPLATES",
        body: [
          "Pick a ready-made template to get KPI layout, charts, and storytelling structure instantly.",
          "Great when you need executive-ready dashboards without starting from scratch.",
        ],
        icon: Sparkles,
      },
      {
        id: "dashboard-shared-link",
        title: "Share dashboards with a public link",
        tag: "SHARED LINK",
        body: [
          "Generate a share link for stakeholders in seconds and keep everyone aligned.",
          "Perfect for async reporting across teams, clients, and decision makers.",
        ],
        icon: Link2,
      },
      {
        id: "schedule-syncs",
        title: "Automate refresh with recurring syncs",
        tag: "SCHEDULED SYNCS",
        body: [
          "Set daily or weekly syncs so connector data is updated automatically.",
          "Spend less time on data prep and more time on insights.",
        ],
        icon: CalendarClock,
      },
    ],
    []
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const isLast = activeIndex === items.length - 1;
  const activeItem = items[activeIndex];
  const progressPercent = ((activeIndex + 1) / items.length) * 100;

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
    }
  }, [open]);

  const handleNext = () => {
    if (isLast) {
      onDismiss();
      return;
    }
    setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
  };

  const renderVisual = () => {
    const renderTopText = () => (
      <div className="rounded-lg border border-white/20 bg-white/10 p-3">
        <p className="text-[10px] uppercase tracking-wide text-white/80">{activeItem.tag}</p>
        <p className="mt-1 text-base font-semibold text-white">{activeItem.title}</p>
        <div className="mt-2 space-y-1">
          {activeItem.body.map((line) => (
            <p key={line} className="text-xs text-white/90">
              {line}
            </p>
          ))}
        </div>
      </div>
    );

    if (activeItem.id === "welcome") {
      return (
        <div className="relative h-full w-full overflow-hidden rounded-r-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-600 p-5">
          <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-white/20 blur-2xl" />
          <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-cyan-300/40 blur-2xl" />
          <div className="relative z-10 flex h-full flex-col">
            {renderTopText()}
            <div className="relative mt-3 flex-1 rounded-xl border border-white/25 bg-black/20 p-4 backdrop-blur-md">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/20 bg-white/10 p-3">
                <p className="text-[10px] text-white/70">Plan</p>
                <p className="mt-1 text-sm font-semibold text-white">Pro</p>
              </div>
              <div className="rounded-lg border border-white/20 bg-white/10 p-3">
                <p className="text-[10px] text-white/70">Credits</p>
                <p className="mt-1 text-sm font-semibold text-white">1,000/mo</p>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-white/20 bg-white/10 p-3">
              <p className="text-[10px] uppercase tracking-wide text-white/70">What you can do now</p>
              <p className="mt-1 text-xs text-white/90">Connect data, ask AI, build and share dashboards in minutes.</p>
            </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeItem.id === "multi-file-analyze") {
      return (
        <div className="relative h-full w-full overflow-hidden rounded-r-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-600 p-5">
          <div className="absolute -top-8 -right-6 h-28 w-28 rounded-full bg-white/20 blur-2xl" />
          <div className="absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-cyan-300/40 blur-2xl" />
          <div className="relative z-10 flex h-full flex-col">
            {renderTopText()}
            <div className="relative mt-3 flex flex-1 flex-col rounded-2xl border border-white/25 bg-black/20 p-4 backdrop-blur-md">
            <div className="space-y-2">
              {["Revenue_Q1.xlsx", "Ad_Spend.csv", "CRM_Leads.xlsx"].map((file) => (
                <div key={file} className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-1.5">
                  <span className="truncate text-xs text-white/95">{file}</span>
                  <span className="ml-2 text-[10px] text-emerald-200">Ready</span>
                </div>
              ))}
            </div>
            <div className="mt-auto rounded-xl border border-white/15 bg-white/10 p-3">
              <p className="text-[10px] uppercase tracking-wide text-white/70">Merged insights</p>
              <p className="mt-1 text-xs text-white">+22% ROAS · -14% CPA · +9% LTV</p>
            </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeItem.id === "data-connectors") {
      return (
        <div className="relative h-full w-full overflow-hidden rounded-r-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 p-5">
          <div className="absolute -bottom-16 -left-14 h-40 w-40 rounded-full bg-lime-300/25 blur-3xl" />
          <div className="relative z-10 flex h-full flex-col">
            {renderTopText()}
            <div className="relative mt-3 flex flex-1 flex-col rounded-2xl border border-white/25 bg-black/20 p-4 backdrop-blur-md">
            <div className="grid grid-cols-4 gap-2">
              {["GA4", "Sheets", "Ads", "Stripe", "Meta", "TikTok", "Firebase", "AppsFlyer"].map((name) => (
                <div key={name} className="rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-center text-[10px] text-white/95">
                  {name}
                </div>
              ))}
            </div>
            <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
              <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
                <p className="text-[10px] text-white/75">Active sources</p>
                <p className="text-sm font-semibold text-white">8 connected</p>
              </div>
              <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
                <p className="text-[10px] text-white/75">Sync health</p>
                <p className="text-sm font-semibold text-emerald-100">Stable</p>
              </div>
            </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeItem.id === "templates") {
      return (
        <div className="relative h-full w-full overflow-hidden rounded-r-2xl bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 p-5">
          <div className="absolute -right-12 top-1/3 h-36 w-36 rounded-full bg-red-200/35 blur-3xl" />
          <div className="relative z-10 flex h-full flex-col">
            {renderTopText()}
            <div className="relative mt-3 flex flex-1 flex-col rounded-2xl border border-white/25 bg-black/20 p-4 backdrop-blur-md">
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-20 rounded-lg border border-white/20 bg-white/10" />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {["Executive KPI", "Performance", "Growth"].map((name) => (
                <span key={name} className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] text-white/95">
                  {name}
                </span>
              ))}
            </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeItem.id === "dashboard-shared-link") {
      return (
        <div className="relative h-full w-full overflow-hidden rounded-r-2xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 p-5">
          <div className="absolute -left-10 -top-10 h-36 w-36 rounded-full bg-cyan-200/25 blur-3xl" />
          <div className="relative z-10 flex h-full flex-col">
            {renderTopText()}
            <div className="relative mt-3 flex flex-1 flex-col rounded-2xl border border-white/20 bg-black/20 p-4 backdrop-blur-md">
            <div className="mb-3 rounded-lg border border-white/20 bg-white/10 px-2.5 py-2 text-[11px] text-white/95">
              dreamify.app/dashboard/team-growth-q2
            </div>
            <div className="rounded-xl border border-white/20 bg-white/10 p-3">
              <p className="text-[11px] text-white/90">Weekly KPI Snapshot</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="rounded-md bg-white/10 px-1 py-1.5 text-white">Revenue +18%</div>
                <div className="rounded-md bg-white/10 px-1 py-1.5 text-white">CAC -9%</div>
                <div className="rounded-md bg-white/10 px-1 py-1.5 text-white">LTV +12%</div>
              </div>
            </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-full w-full overflow-hidden rounded-r-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 p-5">
        <div className="absolute -right-12 -bottom-14 h-40 w-40 rounded-full bg-rose-200/25 blur-3xl" />
        <div className="relative z-10 flex h-full flex-col">
          {renderTopText()}
          <div className="relative mt-3 flex flex-1 flex-col rounded-2xl border border-white/20 bg-black/20 p-4 backdrop-blur-md">
          <div className="space-y-2.5">
            {[
              { source: "GA4", cadence: "Daily 07:00 UTC", status: "Active" },
              { source: "Meta Ads", cadence: "Weekly Mon", status: "Active" },
              { source: "Stripe", cadence: "Daily 09:00 UTC", status: "Paused" },
            ].map((row) => (
              <div key={row.source} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white">{row.source}</span>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[9px] text-white">{row.status}</span>
                </div>
                <p className="mt-1 text-[10px] text-white/80">{row.cadence}</p>
              </div>
            ))}
          </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="w-[90vw] max-w-4xl bg-muted border border-border rounded-xl sm:rounded-2xl p-0 overflow-hidden [&>button]:z-50 [&>button]:top-3 [&>button]:right-3 [&>button]:h-7 [&>button]:w-7 [&>button]:rounded-full [&>button]:border [&>button]:border-border [&>button]:bg-background/80 [&>button]:shadow-sm"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="grid grid-cols-1 lg:grid-cols-5 items-stretch">
          <aside className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-border p-4 sm:p-5 flex flex-col">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">Onboarding</h3>
              <p className="text-xs text-muted-foreground mt-1">6 steps to explore Dreamify quickly</p>
            </div>
            <nav className="space-y-1.5">
              {items.map((item, index) => {
                const Icon = item.icon;
                const isActive = index === activeIndex;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveIndex(index)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      isActive
                        ? "bg-primary/10 border-primary/40 text-foreground"
                        : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Icon className="h-4 w-4 mt-0.5" />
                      <div>
                        <div className="text-[11px] uppercase tracking-wide opacity-80">{item.tag}</div>
                        <div className="text-sm font-medium leading-tight mt-0.5">{item.title}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
            <div className="mt-4">
              <div className="mb-1 text-[11px] text-muted-foreground">Step {activeIndex + 1} of {items.length}</div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-accent transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="outline" onClick={onDismiss}>
                Skip
              </Button>
              <Button onClick={handleNext} className="button-gradient ml-auto">
                {isLast ? "Start exploring" : "Next"}
              </Button>
            </div>
          </aside>

          <section className="lg:col-span-3 p-0 flex">
            {renderVisual()}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
