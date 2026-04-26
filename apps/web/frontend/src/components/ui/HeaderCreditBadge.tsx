import React, { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import AccountCenterModal from "@/components/homepage-section/AccountCenterModal";

const TIER_LIMIT = 1000;

interface HeaderCreditBadgeProps {
  creditsRemaining: number;
  monthlyCreditsUsed?: number;
}

const HeaderCreditBadge: React.FC<HeaderCreditBadgeProps> = ({
  creditsRemaining,
  monthlyCreditsUsed,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountCenterTab, setAccountCenterTab] = useState<"pricing" | "account" | "billing" | "notifications" | "plans" | "preferences">("plans");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const used = monthlyCreditsUsed ?? (TIER_LIMIT - creditsRemaining);
  const pct = TIER_LIMIT > 0 ? Math.max(0, Math.min(1, creditsRemaining / TIER_LIMIT)) : 0;

  // Credit state coloring (same as ModelSelector)
  const creditState = creditsRemaining === 0 ? 'empty' : pct <= 0.1 ? 'critical' : pct <= 0.3 ? 'warning' : 'ok';
  const strokeColor = creditState === 'empty' || creditState === 'critical'
    ? '#ef4444' : creditState === 'warning'
      ? '#f59e0b' : 'hsl(var(--primary))';

  // Popup circle SVG constants
  const popupRadius = 26;
  const popupCircumference = 2 * Math.PI * popupRadius;
  const popupDashOffset = popupCircumference * (1 - pct);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setIsHovered(false), 150);
  };

  const openPlansModal = () => {
    setIsHovered(false);
    setAccountCenterTab("plans");
    setAccountCenterOpen(true);
  };

  // Also listen to the global event (for compatibility with other dispatchers)
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab ?? 'plans';
      setAccountCenterTab(tab);
      setAccountCenterOpen(true);
    };
    window.addEventListener('dreamify:open-account-center', handler);
    return () => window.removeEventListener('dreamify:open-account-center', handler);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <>
      <div
        className="relative flex items-center gap-1.5 mr-4 cursor-default select-none"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm sm:text-md font-semibold text-foreground dark:text-white/90 tabular-nums">
          {creditsRemaining.toLocaleString()}
        </span>

        {/* Hover popup */}
        {isHovered && (
          <div
            className="absolute right-0 top-full mt-2 z-[300] bg-popover/95 backdrop-blur-xl border border-border rounded-2xl shadow-header p-2 w-[260px]"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              animation: "fadeInDown 180ms cubic-bezier(0.4, 0, 0.2, 1) forwards",
            }}
          >
            <div className="flex items-center gap-3">
              {/* Large credit circle — depletes as credits are consumed */}
              <div className="relative flex items-center justify-center w-[64px] h-[64px] shrink-0">
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 64 64"
                  className="absolute inset-0"
                >
                  <circle
                    cx="32"
                    cy="32"
                    r={popupRadius}
                    fill="none"
                    stroke="hsl(var(--border))"
                    strokeWidth="3.5"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r={popupRadius}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray={`${popupCircumference}`}
                    strokeDashoffset={`${popupDashOffset}`}
                    style={{ transition: "stroke-dashoffset 0.6s ease", transform: "rotate(90deg) scaleX(-1)", transformOrigin: "center" }}
                  />
                </svg>
                <span className="relative text-base font-bold text-foreground dark:text-white leading-none">
                  {creditsRemaining}
                </span>
              </div>

              {/* Text content */}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold tracking-wider text-muted-foreground dark:text-white/80 uppercase">
                  Remaining Credits
                </p>
                <p className="text-[11px] text-muted-foreground/60 dark:text-white/40 leading-snug mt-1">
                  {used.toLocaleString()} / {TIER_LIMIT.toLocaleString()} used this month
                </p>
                <button
                  onClick={openPlansModal}
                  className="text-[11px] text-muted-foreground/50 underline underline-offset-2 hover:text-primary transition-colors mt-0.5 cursor-pointer dark:text-white/35 dark:hover:text-white/60"
                >
                  Plans & Credits
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <AccountCenterModal
        open={accountCenterOpen}
        activeTab={accountCenterTab}
        onChangeTab={(t) => setAccountCenterTab(t)}
        onClose={() => setAccountCenterOpen(false)}
      />
    </>
  );
};

export default HeaderCreditBadge;
