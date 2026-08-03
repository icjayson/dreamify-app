import React from "react";
import { Check, Database, FileSpreadsheet, Sparkles } from "lucide-react";
import { useNavigate } from "@/lib/navigation";

import { useUser } from "@/lib/clerk";
import { useCapabilities } from "@/hooks/useCapabilities";
import { cn } from "@/lib/utils";

export const PricingPlansSection: React.FC<{ className?: string }> = ({ className }) => {
  const navigate = useNavigate();
  const { isSignedIn } = useUser();
  const { capabilities } = useCapabilities();
  const limits = capabilities.limits;

  const features = [
    `${limits.data_runs_per_user_per_day} data analysis runs per day`,
    `${limits.text_runs_per_user_per_day} text runs per day`,
    `Up to ${Math.round(limits.max_file_bytes / 1024 / 1024)} MiB per file`,
    capabilities.model.mode === "demo" ? "Deterministic demo AI included" : "Bring-your-own-key AI enabled",
  ];

  return (
    <section className={cn("w-full px-6 py-16", className)}>
      <div className="mx-auto max-w-3xl rounded-3xl border border-primary/30 bg-background/80 p-8 shadow-2xl backdrop-blur-xl md:p-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">Hobby demo</span>
            <h2 className="mt-4 text-3xl font-semibold text-foreground">Free Preview</h2>
            <p className="mt-2 max-w-xl text-muted-foreground">A private, non-commercial preview with technical usage limits. Billing, checkout, subscriptions, and credit debits are disabled.</p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold text-foreground">$0</div>
            <div className="text-sm text-muted-foreground">during preview</div>
          </div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature} className="flex items-center gap-3 rounded-xl bg-foreground/5 px-4 py-3 text-sm text-foreground">
              <Check className="h-4 w-4 shrink-0 text-primary" />
              {feature}
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><FileSpreadsheet className="h-4 w-4" /> CSV, XLSX, XLS and flat JSON</span>
          <span className="inline-flex items-center gap-1.5"><Database className="h-4 w-4" /> File upload is the guaranteed data source</span>
          <span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Optional connectors depend on capabilities</span>
        </div>

        <button type="button" onClick={() => navigate(isSignedIn ? "/workspace" : "/login")} className="button-gradient mt-8 w-full rounded-xl px-5 py-3 font-semibold">
          {isSignedIn ? "Open workspace" : "Start Free Preview"}
        </button>
      </div>
    </section>
  );
};
