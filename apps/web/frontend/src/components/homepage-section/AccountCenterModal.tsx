import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Star, CreditCard, Bell, LogOut, LogIn, User as UserIcon, Sparkles, Check, Settings } from "lucide-react";
import { useClerk, useUser, UserProfile } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { dark } from "@clerk/themes";
import AccountSettings from "@/components/homepage-section/AccountSettings";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSubscription } from "@/hooks/useSubscription";
import { PricingPlansCenterModal } from "@/components/homepage-section/pricing-plans-center-modal";
import { useTheme } from "@/hooks/useTheme";

type AccountCenterTab = "pricing" | "account" | "billing" | "notifications" | "plans" | "preferences";

interface AccountCenterModalProps {
  open: boolean;
  activeTab: AccountCenterTab;
  onChangeTab: (tab: AccountCenterTab) => void;
  onClose: () => void;
}

const PricingContent: React.FC = () => {
  const { upgradeToPro, isLoading, error } = useSubscription();
  const { isSignedIn } = useUser();
  const navigate = useNavigate();
  const [isUpgrading, setIsUpgrading] = useState(false);

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

  const handleUpgrade = async (plan: string) => {
    if (plan === 'pro') {
      await upgradeToPro();
    }
  };

  const handleContactSales = () => {
    // TODO: Implement contact sales functionality
    console.log('Contact sales clicked');
  };

  return (
    <div className="w-full">
      {error && (
        <div className="px-4 py-3 mb-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      <div className="px-2 sm:px-4 pt-8 pb-4 border-b border-border text-center">
        <h2 className="text-2xl md:text-3xl font-semibold text-foreground dark:text-white">Choose your plan</h2>
        <p className="text-sm text-muted-foreground dark:text-white/70 mt-2">Start with our free tier and upgrade as you grow to unlock higher limits, better support, and more features.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 md:p-6 items-stretch">
        <div className="rounded-xl dark:border-white/10 border-border dark:bg-gradient-to-b dark:from-white/5 dark:to-white/0 bg-foreground/3 p-5 h-full flex flex-col">
          <h3 className="text-lg font-semibold text-foreground dark:text-white">Sandbox</h3>
          <div className="mt-3"><span className="text-4xl font-bold text-foreground dark:text-white">$0</span><span className="text-muted-foreground dark:text-white/70 text-sm"> / month</span></div>
          <ul className="my-4 space-y-2 text-sm text-foreground/80 dark:text-white/80">
            <li>100 credits / month</li>
            <li>Diverse templates</li>
            <li>User roles & permissions</li>
            <li>7-day data retention</li>
          </ul>
          <button
            onClick={isSignedIn ? undefined : handleGetStarted}
            className="mt-auto w-full button-outline rounded-md py-2 text-sm"
          >
            {isSignedIn ? 'Current plan' : 'Get Started'}
          </button>
        </div>
        <div className="rounded-xl border border-primary/30 bg-gradient-to-b from-primary/20 to-primary/5 p-5 ring-1 ring-primary/20 h-full flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground dark:text-white">Pro</h3>
            <span className="px-2 py-0.5 text-[10px] rounded-full dark:bg-white/10 bg-foreground/10 text-foreground dark:text-white">POPULAR</span>
          </div>
          <div className="mt-3"><span className="text-4xl font-bold text-foreground dark:text-white">$25</span><span className="text-muted-foreground dark:text-white/70 text-sm"> / month</span></div>
          <ul className="my-4 space-y-2 text-sm text-foreground/80 dark:text-white/80">
            <li>1,000 credits / month</li>
            <li>Advanced AI reasoning</li>
            <li>Keep dashboards forever</li>
            <li>Remove the Dreamify badge</li>
          </ul>
          <button
            onClick={handleProUpgrade}
            disabled={isUpgrading}
            className="mt-auto w-full button-gradient rounded-md py-2 text-sm disabled:opacity-50"
          >
            {isUpgrading ? 'Processing...' : (isSignedIn ? 'Upgrade to Pro' : 'Get Started')}
          </button>
        </div>
        <div className="rounded-xl dark:border-white/10 border-border dark:bg-gradient-to-b dark:from-white/5 dark:to-white/0 bg-foreground/3 p-5 h-full flex flex-col">
          <h3 className="text-lg font-semibold text-foreground dark:text-white">Enterprise</h3>
          <div className="mt-3"><span className="text-4xl font-bold text-foreground dark:text-white">Custom</span></div>
          <ul className="my-4 space-y-2 text-sm text-foreground/80 dark:text-white/80">
            <li>Dedicated support</li>
            <li>Onboarding services</li>
            <li>Custom connections</li>
            <li>Group-based access control</li>
            <li>Custom design systems</li>
          </ul>
          <button
            onClick={handleContactSales}
            className="mt-auto w-full button-outline rounded-md py-2 text-sm"
          >
            Contact sales
          </button>
        </div>
      </div>
    </div>
  );
};

const PlansCreditsContent: React.FC = () => {
  const { creditsRemaining, creditUsage } = useSubscription();
  const tierLimit = 1000;
  const used = creditUsage?.monthly_credits_used ?? (tierLimit - creditsRemaining);
  const pct = tierLimit > 0 ? Math.max(0, Math.min(1, creditsRemaining / tierLimit)) : 0;

  return (
    <div className="w-full p-6">
      <div className="mb-1">
        <h2 className="text-xl font-semibold text-foreground dark:text-white">Plans & credits</h2>
        <p className="text-sm text-muted-foreground dark:text-white/50 mt-1">Manage your subscription plan and credit balance.</p>
      </div>

      {/* Top section: Plan info + Credits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        {/* Current Plan Card */}
        <div className="col-span-1 w-full rounded-xl dark:border-white/10 border-border dark:bg-white/[0.03] bg-foreground/3 p-4">
          <div className="flex items-center gap-3 mb-2">
            <img src="/logo-white.png" alt="Dreamify" className="w-12 h-6 object-contain dark:block hidden" />
            <img src="/logo-watermark.png" alt="Dreamify" className="w-6 h-6 object-contain dark:hidden block" />
            <div>
              <p className="text-foreground dark:text-white font-semibold">You're on Pro plan</p>
              <p className="text-xs text-muted-foreground dark:text-white/40">Early access member</p>
            </div>
          </div>
          <div className="space-y-0 text-sm text-foreground/70 dark:text-white/70">
            <div className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-primary" />
              <span>1,000 credits / month</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-primary" />
              <span>Advanced AI reasoning</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-primary" />
              <span>Keep dashboards forever</span>
            </div>
          </div>
        </div>

        {/* Credits remaining card */}
        <div className="col-span-2 w-full rounded-xl dark:border-white/10 border-border dark:bg-white/[0.03] bg-foreground/3 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground dark:text-white/70">Credits remaining</span>
            <span className="text-2xl font-bold text-foreground dark:text-white tabular-nums">{creditsRemaining.toLocaleString()}</span>
          </div>
          <div className="h-3 w-full dark:bg-white/10 bg-foreground/10 rounded-full overflow-hidden mb-4">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(pct * 100, 100)}%` }}
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground/80 dark:text-white/80">Monthly credits</p>
                <p className="text-[11px] text-muted-foreground dark:text-white/40">Resets monthly on the 1st</p>
              </div>
              <span className="text-sm font-semibold text-foreground dark:text-white tabular-nums">{used.toLocaleString()} / {tierLimit.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Plans */}
      <PricingPlansCenterModal className="mt-6" />
    </div>
  );
};

const Placeholder: React.FC<{ title: string; icon?: React.ReactNode }> = ({ title, icon }) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-6">
    <div className="w-12 h-12 rounded-full dark:bg-white/10 bg-foreground/10 flex items-center justify-center mb-4">
      {icon || <UserIcon className="w-6 h-6 text-foreground dark:text-white" />}
    </div>
    <h3 className="text-foreground dark:text-white font-medium text-lg">{title}</h3>
    <p className="text-muted-foreground dark:text-white/60 text-sm mt-1">Coming soon</p>
  </div>
);

const PreferencesContent: React.FC = () => {
  const { theme, setTheme } = useTheme();
  return (
    <div className="w-full p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">Appearance</h3>
        <p className="text-sm text-muted-foreground mb-4">Choose how Dreamify looks for you.</p>
        <div className="flex gap-2">
          {(['dark', 'light', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${theme === t
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const AccountCenterModal: React.FC<AccountCenterModalProps> = ({ open, activeTab, onChangeTab, onClose }) => {
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const { user, isSignedIn } = useUser();

  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const startYRef = useRef<number | null>(null);

  // Responsive: detect desktop to avoid mounting mobile Sheet overlay on desktop
  const [isDesktop, setIsDesktop] = useState<boolean>(false);

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 640px)') : null;
    const update = () => setIsDesktop(!!mq && mq.matches);
    update();
    if (mq) {
      try {
        mq.addEventListener('change', update);
      } catch {
        // Safari fallback
        // @ts-ignore
        mq.addListener(update);
      }
    }
    return () => {
      if (mq) {
        try {
          mq.removeEventListener('change', update);
        } catch {
          // @ts-ignore
          mq.removeListener(update);
        }
      }
    };
  }, []);

  // Mobile two-sheet state
  const [isShowingMobileContent, setIsShowingMobileContent] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<AccountCenterTab>(activeTab);

  // Reset mobile flow on open
  useEffect(() => {
    if (open) {
      const isDesktopOrUp = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 640px)').matches;
      setMobileActiveTab(isSignedIn ? 'account' : 'pricing');
      setDragY(0);
      // On mobile (< sm), open directly into the content sheet for the selected tab
      setIsShowingMobileContent(!isDesktopOrUp);
    } else {
      setIsShowingMobileContent(false);
      setDragY(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { }
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || startYRef.current == null) return;
    const delta = e.clientY - startYRef.current;
    setDragY(delta > 0 ? delta : 0);
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragY > 100) {
      onClose();
    }
    setDragY(0);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { }
  };

  const displayName = user?.fullName || user?.firstName || "User";
  const email = user?.primaryEmailAddress?.emailAddress || "user@example.com";
  const avatarUrl = user?.imageUrl;

  const sidebarItems = useMemo(() => {
    const items = [];
    if (isSignedIn) {
      items.push(
        { key: "plans" as AccountCenterTab, label: "Plans & credits", icon: <Sparkles className="w-4 h-4" /> },
        { key: "account" as AccountCenterTab, label: "Manage Account", icon: <UserIcon className="w-4 h-4" /> },
        /* { key: "billing" as AccountCenterTab, label: "Billing", icon: <CreditCard className="w-4 h-4" /> },
        { key: "notifications" as AccountCenterTab, label: "Notifications", icon: <Bell className="w-4 h-4" /> },*/
        {/* key: "preferences" as AccountCenterTab, label: "Preferences", icon: <Settings className="w-4 h-4" /> */ },
      );
    }
    return items;
  }, [isSignedIn]);

  if (!open) return null;

  const modalContent = (
    <>
      {/* Mobile: Single Sheet toggling between Settings list and Content (sm:hidden) */}
      {open && !isDesktop && (
        <Sheet open={open} onOpenChange={(v) => { if (!v) { setIsShowingMobileContent(false); onClose(); } }}>
          <SheetContent side="bottom" className="sm:hidden h-[80vh] w-full bg-muted border-t border-border rounded-t-2xl overflow-hidden p-0">
            {/* Drag Handle */}
            <div
              className="w-full flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing select-none"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
            >
              <div className="h-1.5 w-12 rounded-full dark:bg-white/20 bg-foreground/20" />
            </div>
            {/* Content with drag translate */}
            <div style={{ transform: `translateY(${dragY}px)`, transition: draggingRef.current ? 'none' : 'transform 200ms ease' }}>
              {/* Settings List View */}
              {!isShowingMobileContent && (
                <div className="relative z-10 w-full h-[calc(80vh-20px)] bg-muted overflow-hidden">

                  {/* Header user info */}
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-foreground/10 dark:bg-white/10 flex items-center justify-center shrink-0">
                        {user?.imageUrl ? <img src={user.imageUrl} alt="Avatar" className="w-full h-full object-cover" /> : <UserIcon className="w-4 h-4 text-foreground dark:text-white" />}
                      </div>
                      <div className="flex flex-col items-start justify-start min-w-0 whitespace-nowrap">
                        <p className="text-sm font-semibold text-foreground dark:text-white">{displayName}</p>
                        <p className="text-xs text-muted-foreground dark:text-white/70">{email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Settings list */}
                  <div className="p-3">
                    <div className="space-y-1">
                      {sidebarItems.map(item => (
                        <button
                          key={item.key}
                          onClick={() => { setMobileActiveTab(item.key); onChangeTab(item.key); setIsShowingMobileContent(true); }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-3 rounded-md text-sm dark:hover:bg-black hover:bg-foreground/10 ${mobileActiveTab === item.key ? 'dark:bg-black bg-foreground/10 text-foreground dark:text-white' : 'text-foreground/70 dark:text-white/80'}`}
                        >
                          <span className="flex items-center gap-2"><span className="text-foreground/60 dark:text-white/80">{item.icon}</span><span>{item.label}</span></span>
                          <svg className="w-4 h-4 text-foreground/40 dark:text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-border my-3"></div>
                    {isSignedIn ? (
                      <button
                        onClick={async () => { await signOut(); onClose(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground/70 dark:text-white/80 hover:bg-foreground/10 dark:hover:bg-black"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Log out</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => { onClose(); navigate('/login'); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground/70 dark:text-white/80 hover:bg-foreground/10 dark:hover:bg-black"
                      >
                        <LogIn className="w-4 h-4" />
                        <span>Login</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Content View */}
              {isShowingMobileContent && (
                <div className="relative z-10 w-full h-[calc(80vh-20px)] bg-muted overflow-hidden flex flex-col">
                  {/* Top bar with Back (no close icon on mobile) */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <button
                      onClick={() => { setIsShowingMobileContent(false); setDragY(0); }}
                      className="flex items-center gap-2 text-sm text-foreground/70 dark:text-white/80 hover:text-foreground dark:hover:text-white hover:bg-foreground/10 dark:hover:bg-white/10 rounded-md px-2 py-1"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                      <span>Back to settings</span>
                    </button>
                  </div>

                  {/* Content body */}
                  <div className="flex-1 overflow-y-auto">
                    {(isSignedIn ? mobileActiveTab : 'pricing') === "pricing" && <PricingContent />}
                    {isSignedIn && mobileActiveTab === "plans" && <PlansCreditsContent />}
                    {isSignedIn && mobileActiveTab === "account" && <AccountSettings />}
                    {isSignedIn && mobileActiveTab === "billing" && <Placeholder title="Billing" icon={<CreditCard className="w-6 h-6 text-foreground dark:text-white" />} />}
                    {isSignedIn && mobileActiveTab === "notifications" && <Placeholder title="Notifications" icon={<Bell className="w-6 h-6 text-foreground dark:text-white" />} />}
                    {isSignedIn && mobileActiveTab === "preferences" && <PreferencesContent />}
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop/Tablet Centered Dialog (hidden on mobile) */}
      <div className="hidden sm:flex fixed inset-0 z-[260] items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/80 hidden sm:block" onClick={onClose} />
        <div className="relative z-10 w-full max-w-6xl h-[80vh] bg-muted rounded-2xl border border-border shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-[max-content_1fr]">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 p-2 rounded-md text-foreground/60 dark:text-white/70 hover:text-foreground dark:hover:text-white hover:bg-foreground/10 dark:hover:bg-black transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Sidebar */}
          <aside className="border-r border-border dark:bg-black/10 bg-muted/60 h-full">
            <div className="p-3">
              {/* User Info */}
              <div className="flex items-center gap-3 p-2 mb-2">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-foreground/10 dark:bg-white/10 flex items-center justify-center shrink-0">
                  {user?.imageUrl ? <img src={user.imageUrl} alt="Avatar" className="w-full h-full object-cover" /> : <UserIcon className="w-4 h-4 text-foreground dark:text-white" />}
                </div>
                <div className="flex flex-col items-start justify-start min-w-0 whitespace-nowrap">
                  <p className="text-sm font-semibold text-foreground dark:text-white">{displayName}</p>
                  <p className="text-xs text-muted-foreground dark:text-white/70">{email}</p>
                </div>
              </div>
              <div className="h-px w-full bg-border my-2" />
              <div className="space-y-1">
                {sidebarItems.map(item => (
                  <button
                    key={item.key}
                    onClick={() => onChangeTab(item.key)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm dark:hover:bg-black hover:bg-foreground/10 ${activeTab === item.key ? 'dark:bg-black bg-foreground/10 text-foreground dark:text-white' : 'text-foreground/70 dark:text-white/80'}`}
                  >
                    <span className="text-foreground/60 dark:text-white/80">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-border my-3"></div>
              {isSignedIn ? (
                <button
                  onClick={async () => { await signOut(); onClose(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground/70 dark:text-white/80 hover:bg-foreground/10 dark:hover:bg-black"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log out</span>
                </button>
              ) : (
                <button
                  onClick={() => { onClose(); navigate('/login'); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-foreground/70 dark:text-white/80 hover:bg-foreground/10 dark:hover:bg-black"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Login</span>
                </button>
              )}
            </div>
          </aside>

          {/* Content */}
          <section className="h-full overflow-y-auto">
            {(isSignedIn ? activeTab : 'pricing') === "pricing" && <PricingContent />}
            {isSignedIn && activeTab === "plans" && <PlansCreditsContent />}
            {isSignedIn && activeTab === "account" && <AccountSettings />}
            {isSignedIn && activeTab === "billing" && <Placeholder title="Billing" icon={<CreditCard className="w-6 h-6 text-foreground dark:text-white" />} />}
            {isSignedIn && activeTab === "notifications" && <Placeholder title="Notifications" icon={<Bell className="w-6 h-6 text-foreground dark:text-white" />} />}
            {isSignedIn && activeTab === "preferences" && <PreferencesContent />}
          </section>
        </div>
      </div>
    </>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
};

export default AccountCenterModal;


