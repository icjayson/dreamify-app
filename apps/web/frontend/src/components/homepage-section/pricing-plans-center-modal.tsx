import React, { useEffect, useState, useRef } from "react";
import { useUser } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { cn } from "@/lib/utils";

export const PricingPlansCenterModal: React.FC<{ className?: string }> = ({ className }) => {
  const { upgradeToPro, isLoading, error } = useSubscription();
  const { isSignedIn } = useUser();
  const navigate = useNavigate();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { root: null, threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      const intendedAction = sessionStorage.getItem('intendedAction');
      if (intendedAction === 'upgrade-pro') {
        sessionStorage.removeItem('intendedAction');
        setIsUpgrading(true);
        upgradeToPro().finally(() => setIsUpgrading(false));
      }
    }
  }, [isSignedIn, upgradeToPro]);

  const handleGetStarted = () => {
    navigate('/login');
  };

  const handleProUpgrade = async () => {
    if (isSignedIn) {
      setIsUpgrading(true);
      try {
        await upgradeToPro();
      } finally {
        setIsUpgrading(false);
      }
    } else {
      sessionStorage.setItem('intendedAction', 'upgrade-pro');
      navigate('/login');
    }
  };

  const handleContactSales = () => {
    console.log('Contact sales clicked');
  };

  const checkIcon = (
    <svg className="w-3.5 h-3.5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
  );

  return (
    <section className={cn("py-6 w-full", className)}>
      <div ref={rootRef} className="max-w-5xl mx-auto">
        {error && (
          <div className="px-3 py-2 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg text-center">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {/* Sandbox Plan */}
          <div
            className={`rounded-xl border border-white/10 bg-white/5 p-5 h-full flex flex-col transition-all duration-700 ease-out delay-[100ms] ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
          >
            <h3 className="text-base font-semibold text-white">Sandbox</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-white">$0</span>
              <span className="text-white/60 text-xs">/ month</span>
            </div>
            <p className="mt-2 text-white/50 text-xs">Our baseline features, always available for individuals starting out.</p>
            <ul className="my-4 space-y-2 text-xs text-white/70 flex-1">
              <li className="flex items-center gap-2">{checkIcon} 100 monthly credits</li>
              <li className="flex items-center gap-2">{checkIcon} Limited AI reasoning</li>
              <li className="flex items-center gap-2">{checkIcon} 30-day dashboard history</li>
            </ul>
            <button
              disabled
              className="mt-auto w-full border border-white/10 bg-white/5 text-white/40 rounded-lg py-2 text-xs font-medium"
            >
              Base Plan
            </button>
          </div>

          {/* Pro Plan - ACTIVE DURING PREVIEW */}
          <div
            className={`rounded-xl border-2 p-5 h-full flex flex-col relative transition-all duration-700 ease-out delay-[200ms] ${isVisible
              ? isSignedIn
                ? "border-primary bg-primary/20 shadow-[0_0_40px_-12px_rgba(139,92,246,0.5)] scale-[1.02]"
                : "border-primary/40 bg-primary/10 shadow-[0_0_30px_-15px_rgba(139,92,246,0.3)]"
              : "opacity-0 translate-y-8"
              }`}
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-white text-[9px] font-bold tracking-wider uppercase shadow-lg shadow-primary/20">
              Limited Preview
            </div>
            <h3 className="text-base font-semibold text-white">Pro</h3>
            <div className="mt-2">
              <span className="text-3xl font-bold text-white tracking-tighter">TBD</span>
            </div>
            <p className="mt-3 text-cyan-400 font-bold text-sm leading-tight uppercase tracking-wide">
              Free Access During Preview
            </p>
            <ul className="my-4 space-y-2 text-xs text-white/80 flex-1">
              <li className="flex items-center gap-2 font-medium text-white">{checkIcon} 1,000 monthly credits</li>
              <li className="flex items-center gap-2">{checkIcon} Advanced AI reasoning</li>
              <li className="flex items-center gap-2">{checkIcon} Keep dashboards forever</li>
              <li className="flex items-center gap-2">{checkIcon} Remove the Dreamify badge</li>
            </ul>
            <button
              onClick={isSignedIn ? undefined : handleGetStarted}
              className={`mt-auto w-full rounded-lg py-2.5 text-xs font-bold transition-all shadow-lg ${isSignedIn
                ? 'bg-primary text-white cursor-default shadow-primary/20'
                : 'button-gradient hover:scale-[1.02] active:scale-[0.98]'
                }`}
            >
              {isSignedIn ? 'Current Plan (Full Access)' : 'Start Free Preview'}
            </button>
          </div>

          {/* Enterprise Plan */}
          <div
            className={`rounded-xl border border-white/10 bg-white/5 p-5 h-full flex flex-col transition-all duration-700 ease-out delay-[300ms] ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
          >
            <h3 className="text-base font-semibold text-white">Enterprise</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-white">Custom</span>
            </div>
            <p className="mt-2 text-white/50 text-xs">Tailored solutions for large teams and high-volume data needs.</p>
            <ul className="my-4 space-y-2 text-xs text-white/70 flex-1">
              <li className="flex items-center gap-2">{checkIcon} Custom credit volume</li>
              <li className="flex items-center gap-2">{checkIcon} Custom internal data connectors</li>
              <li className="flex items-center gap-2">{checkIcon} Advanced group-based access control</li>
              <li className="flex items-center gap-2">{checkIcon} Dedicated onboarding & support</li>
            </ul>
            <button
              onClick={handleContactSales}
              className="mt-auto w-full button-outline rounded-lg py-2 text-xs font-medium transition-all"
            >
              Contact sales
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
