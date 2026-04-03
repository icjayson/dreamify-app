import React, { useEffect, useState, useRef } from "react";
import { useUser } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { cn } from "@/lib/utils";

export const PricingPlansSection: React.FC<{ className?: string }> = ({ className }) => {
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

  // Check for intended action when component mounts
  useEffect(() => {
    if (isSignedIn) {
      const intendedAction = sessionStorage.getItem('intendedAction');
      if (intendedAction === 'upgrade-pro') {
        // Clear the intended action
        sessionStorage.removeItem('intendedAction');
        // Trigger the Pro upgrade
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
      // Store intent to upgrade to Pro after login
      sessionStorage.setItem('intendedAction', 'upgrade-pro');
      navigate('/login');
    }
  };

  const handleContactSales = () => {
    // TODO: Implement contact sales functionality
    console.log('Contact sales clicked');
  };

  return (
    <section className={cn("py-16 w-full", className)}>
      <div ref={rootRef} className="max-w-6xl mx-auto px-6">
        {error && (
          <div className="px-4 py-3 mb-8 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {/* Sandbox Plan */}
          <div 
            className={`rounded-2xl border border-white/10 bg-white/5 p-8 h-full flex flex-col transition-all duration-700 ease-out delay-[100ms] ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
          >
            <h3 className="text-xl font-semibold text-white">Sandbox</h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-5xl font-bold text-white">$0</span>
              <span className="text-white/60 text-sm">/ month</span>
            </div>
            <p className="mt-4 text-white/50 text-sm">Our baseline features, always available for individuals starting out.</p>
            <ul className="my-8 space-y-4 text-sm text-white/70 flex-1">
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                100 credits / month
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Diverse templates
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                7-day data retention
              </li>
            </ul>
            <button
              disabled
              className="mt-auto w-full border border-white/10 bg-white/5 text-white/40 rounded-xl py-3 text-sm font-medium"
            >
              Base Plan
            </button>
          </div>

          {/* Pro Plan - ACTIVE DURING PREVIEW */}
          <div 
            className={`rounded-2xl border-2 p-8 h-full flex flex-col relative transition-all duration-700 ease-out delay-[200ms] ${
              isVisible 
                ? isSignedIn 
                  ? "border-primary bg-primary/20 shadow-[0_0_50px_-12px_rgba(139,92,246,0.5)] scale-[1.02]" 
                  : "border-primary/40 bg-primary/10 shadow-[0_0_40px_-15px_rgba(139,92,246,0.3)]"
                : "opacity-0 translate-y-8"
            }`}
          >
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-white text-[10px] font-bold tracking-wider uppercase shadow-lg shadow-primary/20">
              Limited Preview
            </div>
            <h3 className="text-xl font-semibold text-white">Pro</h3>
            <div className="mt-4 flex flex-col justify-start items-start gap-1">
              <span className="text-5xl font-bold text-white tracking-tighter">TBD</span>
            </div>
            <p className="mt-6 text-cyan-400 font-bold text-lg leading-tight uppercase tracking-wide">
              Free Access During Preview
            </p>
            <ul className="my-8 space-y-4 text-sm text-white/80 flex-1">
              <li className="flex items-center gap-2 font-medium text-white">
                <svg className="w-4 h-4 text-primary font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                1,000 credits / month
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                30-day data retention
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Custom domains
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Remove the Dreamify badge
              </li>
            </ul>
            <button
              onClick={isSignedIn ? undefined : handleGetStarted}
              className={`mt-auto w-full rounded-xl py-4 text-sm font-bold transition-all shadow-lg ${
                isSignedIn 
                  ? 'bg-primary text-white cursor-default shadow-primary/20' 
                  : 'button-gradient hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {isSignedIn ? 'Current Plan (Full Access)' : 'Start Free Preview'}
            </button>
          </div>

          {/* Enterprise Plan */}
          <div 
            className={`rounded-2xl border border-white/10 bg-white/5 p-8 h-full flex flex-col transition-all duration-700 ease-out delay-[300ms] ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
          >
            <h3 className="text-xl font-semibold text-white">Enterprise</h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-5xl font-bold text-white">Custom</span>
            </div>
            <p className="mt-4 text-white/50 text-sm">Tailored solutions for large teams and high-volume data needs.</p>
            <ul className="my-8 space-y-4 text-sm text-white/70 flex-1">
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Dedicated support
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Onboarding services
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Custom connections
              </li>
              <li className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Group-based access control
              </li>
            </ul>
            <button
              onClick={handleContactSales}
              className="mt-auto w-full button-outline rounded-xl py-3 text-sm font-medium transition-all"
            >
              Contact sales
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
