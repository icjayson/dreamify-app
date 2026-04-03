import React from "react";
import { Zap } from "lucide-react";

interface CreditExhaustedCardProps {
  tier: "standard" | "pro" | string;
  creditsLimit: number;
  onUpgrade: () => void;
}

export const CreditExhaustedCard: React.FC<CreditExhaustedCardProps> = ({
  tier,
  creditsLimit,
  onUpgrade,
}) => {
  const isPro = tier === "pro";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15">
          <Zap className="w-4 h-4 text-amber-400" />
        </div>
        <span className="text-sm font-semibold text-amber-300">Monthly credits used up</span>
      </div>

      {/* Progress bar — full */}
      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div className="h-full w-full rounded-full bg-amber-500/60" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">
            {isPro ? "Pro plan" : "Standard plan"} · {creditsLimit.toLocaleString()} credits/month
          </span>
          <span className="text-xs font-medium text-amber-400">
            {creditsLimit.toLocaleString()} / {creditsLimit.toLocaleString()}
          </span>
        </div>
      </div>

      <p className="text-xs text-white/40">Resets next month.</p>

      {/* CTAs */}
      {isPro ? (
        <a
          href="https://mail.google.com/mail/?view=cm&to=dreamify.dev@gmail.com&su=More%20Credits%20Request"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20 hover:bg-amber-500/25 transition-colors w-fit"
        >
          Contact us for more credits
        </a>
      ) : (
        <div className="flex items-center gap-2">
          {/* <button
            onClick={onUpgrade}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-white shadow-[0_4px_20px_hsl(var(--primary)/0.35)] hover:opacity-90 transition-opacity"
          >
            <Zap className="w-3.5 h-3.5" />
            Upgrade to Pro
          </button>*/}
          <a
            href="/pricing"
            className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            View plans
          </a>
        </div>
      )}
    </div>
  );
};
