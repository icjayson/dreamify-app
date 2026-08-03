import React from "react";
import { Zap } from "lucide-react";

interface CreditExhaustedCardProps {
  tier: "standard" | "pro" | string;
  creditsLimit: number;
  onUpgrade: () => void;
}

export const CreditExhaustedCard: React.FC<CreditExhaustedCardProps> = ({
  creditsLimit,
}) => {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15">
          <Zap className="w-4 h-4 text-amber-400" />
        </div>
        <span className="text-sm font-semibold text-amber-300">Daily data-run limit reached</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          Free Preview · up to {creditsLimit.toLocaleString()} data runs/day
        </span>
        <p className="text-xs text-muted-foreground">
          The server enforces this cap; no live remaining balance is displayed.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">Try again after the daily quota resets.</p>

      {/* CTAs */}
      <a
        href="/pricing"
        className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        View preview limits
      </a>
    </div>
  );
};
