import { LogIn, User as UserIcon, ChevronsUpDown, LogOut, PanelLeftOpen, Menu, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SignedIn, SignedOut, useUser, useClerk, UserProfile } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { cn } from "@/lib/utils";
import AccountCenterModal from "@/components/homepage-section/AccountCenterModal";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSubscription } from "@/hooks/useSubscription";
import { useTheme } from "@/hooks/useTheme";

const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userProfileOpen, setUserProfileOpen] = useState(false);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountCenterTab, setAccountCenterTab] = useState<"pricing" | "account" | "billing" | "notifications" | "plans" | "preferences">("pricing");
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { user } = useUser();
  const { signOut } = useClerk();
  const [showProjectsBtn, setShowProjectsBtn] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { creditsRemaining } = useSubscription();
  const { resolvedTheme } = useTheme();
  const logoHorizon = resolvedTheme === 'dark' ? "/logo-horizon.png" : "/logo-horizon-dark.png";
  const logoWatermark = resolvedTheme === 'dark' ? "/logo-watermark.png" : "/logo-horizon-dark.png";
  const tierLimit = 1000;
  const hasCreditBalance = creditsRemaining !== null;
  const creditPct = tierLimit > 0 && hasCreditBalance ? creditsRemaining / tierLimit : 0;
  const isProductActive = location.pathname.startsWith("/product");
  const navItemClass = (active = false) => cn(
    "relative text-sm font-medium transition-colors hover:text-accent hover:translate-y-[-2px]",
    active
      ? "text-primary after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-primary dark:text-white"
      : "text-foreground dark:text-white",
  );
  const mobileNavItemClass = (active = false) => cn(
    "w-full text-left px-3 py-2 rounded-md focus:outline-none text-sm transition-colors",
    active
      ? "bg-primary/10 text-primary"
      : "hover:bg-black focus:bg-black",
  );

  useEffect(() => {
    const handleOpen = () => setShowProjectsBtn(false);
    const handleClose = () => setShowProjectsBtn(true);
    window.addEventListener('open-projects', handleOpen as EventListener);
    window.addEventListener('close-projects', handleClose as EventListener);
    return () => {
      window.removeEventListener('open-projects', handleOpen as EventListener);
      window.removeEventListener('close-projects', handleClose as EventListener);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab ?? 'account';
      setAccountCenterTab(tab);
      setAccountCenterOpen(true);
    };
    window.addEventListener('dreamify:open-account-center', handler);
    return () => window.removeEventListener('dreamify:open-account-center', handler);
  }, []);


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && userProfileOpen) {
        setUserProfileOpen(false);
      }
    };
    if (userProfileOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userProfileOpen]);

  const displayName = user?.fullName || user?.firstName || "User";
  const email = user?.primaryEmailAddress?.emailAddress || "user@example.com";
  const avatarUrl = user?.imageUrl;

  const toggleUserMenu = () => setUserMenuOpen(prev => !prev);
  const handleManageAccount = () => {
    setUserMenuOpen(false);
    setUserProfileOpen(true);
  };
  const handleLogout = async () => {
    try {
      setUserMenuOpen(false);
      await signOut();
    } catch (e) {
      console.error("Error signing out:", e);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40">
      <SignedOut>
        <div className="w-full bg-accent/5 backdrop-blur-xl border-b border-border dark:border-white/10 py-2 px-4 shadow-2xl relative overflow-hidden group">
          {/* Subtle animated shine effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:animate-shimmer pointer-events-none" />

          <p className="text-xs sm:text-sm font-medium text-foreground/60 dark:text-white/70 text-center tracking-wide">
            ✨ <span className="text-foreground dark:text-white">Limited Offer:</span> We're giving away <span className="text-accent font-bold">Free Pro Access</span> to all early members.
            <button
              onClick={() => navigate("/login")}
              className="ml-2 text-foreground dark:text-white border-b border-border dark:border-white/40 hover:border-foreground dark:hover:border-white transition-all pb-0.5"
            >
              Log in to claim
            </button>
          </p>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="w-full bg-accent/5 backdrop-blur-xl border-b border-border dark:border-white/10 py-2 px-4 shadow-2xl relative overflow-hidden group">
          {/* Subtle animated shine effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:animate-shimmer pointer-events-none" />

          <p className="text-xs sm:text-sm font-medium text-foreground/60 dark:text-white/70 text-center tracking-wide">
            ✨ <span className="text-foreground dark:text-white">Limited Offer:</span> We're giving away <span className="text-accent font-bold">Free Pro Access</span> to all early members.
          </p>
        </div>
      </SignedIn>

      <div className="mx-4">
        {/* My projects floating button aligned with header but outside the glass panel */}
        <SignedIn>
          {showProjectsBtn && (
            <div className="hidden lg:block fixed left-6 top-16 z-40">
              <button
                onMouseEnter={(e) => e.currentTarget.classList.add('hovered')}
                onMouseLeave={(e) => e.currentTarget.classList.remove('hovered')}
                onClick={() => window.dispatchEvent(new Event('open-projects'))}
                className="button-outline group inline-flex items-center gap-2 px-3 py-2 rounded-md"
              >
                <span className="text-sm text-foreground dark:text-white">My projects</span>
                <PanelLeftOpen className="w-4 h-4 text-foreground/60 dark:text-white/70 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          )}
        </SignedIn>

        <div className="2xl:max-w-6xl xl:max-w-4xl lg:max-w-2xl md:w-full flex h-14 items-center justify-between px-4 glass-panel rounded-2xl mx-auto mt-4 border border-black/15 dark:border-white/10">
          {/* Left side - Logo and brand */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              {/* Logo for signed-in users - only show on lg+ screens */}
              <SignedIn>
                <div className="hidden lg:block w-32 h-auto rounded-lg flex items-center justify-center hover:cursor-pointer">
                  <img
                    src={logoHorizon}
                    alt="Dreamify Logo"
                    className="w-full h-full object-contain"
                    onClick={() => navigate("/")}
                  />
                </div>
              </SignedIn>

              {/* Logo for non-signed-in users - show on all screen sizes */}
              <SignedOut>
                <div className="w-12 md:w-32 h-auto rounded-lg flex items-center justify-center hover:cursor-pointer">
                  {/* Small screens: watermark */}
                  <img
                    src={logoWatermark}
                    alt="Dreamify Logo"
                    className="block md:hidden w-full h-full object-contain"
                    onClick={() => navigate("/")}
                  />
                  {/* md and up: original horizon logo */}
                  <img
                    src={logoHorizon}
                    alt="Dreamify Logo"
                    className="hidden md:block w-full h-full object-contain"
                    onClick={() => navigate("/")}
                  />
                </div>
              </SignedOut>

              {/* My projects button - only show on md and below screens for signed-in users */}
              <SignedIn>
                {showProjectsBtn && (
                  <div className="lg:hidden">
                    <button
                      onMouseEnter={(e) => e.currentTarget.classList.add('hovered')}
                      onMouseLeave={(e) => e.currentTarget.classList.remove('hovered')}
                      onClick={() => window.dispatchEvent(new Event('open-projects'))}
                      className="button-outline group inline-flex items-center gap-2 px-3 py-2 rounded-md"
                    >
                      <span className="text-sm text-foreground dark:text-white">My projects</span>
                      <PanelLeftOpen className="w-4 h-4 text-foreground/60 dark:text-white/70 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>
                )}
              </SignedIn>
              {/* Mobile menu trigger (small screens) */}
              <button
                className="md:hidden inline-flex items-center justify-center ml-1 p-2 rounded-md hover:bg-foreground/10 dark:hover:bg-white/10 transition-colors"
                aria-label="Open menu"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="w-5 h-5 text-foreground dark:text-white" />
              </button>
            </div>
            <nav className="hidden md:flex items-center space-x-4 ml-8">
              <button
                onClick={() => navigate("/product/data-connectors")}
                className={navItemClass(isProductActive)}
              >
                Product
              </button>
              <button
                onClick={() => navigate("/about")}
                className={navItemClass(location.pathname === "/about")}
              >
                About Us
              </button>
              <a
                href="https://discord.gg/GhFjdbgdxd"
                target="_blank"
                rel="noopener noreferrer"
                className={navItemClass()}
              >
                Community
              </a>
              <button
                onClick={() => navigate("/pricing")}
                className={navItemClass(location.pathname === "/pricing")}
              >
                Pricing
              </button>
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className={navItemClass(location.pathname === "/docs")}
              >
                Docs
              </a>
            </nav>
          </div>

          {/* Center - Navigation menu */}

          {/* Right side - Flame icon, notifications, waitlist, and login */}
          <div className="flex items-center gap-4">
            {/* Waitlist CTA (only when signed out) */}
            {/*<SignedOut>
            <button
              onClick={() => navigate("/waitlist")}
              className="button-gradient px-4 py-2 text-white font-medium transition-all text-sm duration-200 flex items-center gap-2 rounded-xl"
            >
              Join waitlist
            </button>
          </SignedOut>*/}

            {/* Authentication buttons */}
            <SignedOut>
              <button
                onClick={() => navigate("/login")}
                className="button-outline px-4 py-2 font-medium transition-all text-sm duration-200 flex items-center gap-2 rounded-xl"
              >
                Login
                <LogIn className="w-4 h-4" />
              </button>
            </SignedOut>
            <SignedIn>
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={toggleUserMenu}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-foreground/10 dark:hover:bg-black/50 rounded-lg transition-colors"
                  aria-label="Toggle user menu"
                >
                  <div className="w-8 h-8 shrink-0 aspect-square bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center overflow-hidden">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="hidden sm:inline text-sm font-medium text-foreground dark:text-white max-w-[160px] truncate">{displayName}</span>
                  <ChevronsUpDown className="w-4 h-4 text-foreground/60 dark:text-white/70" />
                </button>

                {/* User Menu Dropdown */}
                <div className={cn(
                  "absolute right-0 top-full mt-2 z-50 bg-muted border border-border rounded-lg shadow-lg min-w-64 w-auto max-w-80 transition-all duration-200 ease-in-out",
                  userMenuOpen ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-2 scale-95 pointer-events-none"
                )}>
                  <div className="p-2">
                    {/* User Info Header */}
                    <div className="flex items-center gap-3 p-2 mb-2">
                      <div className="w-8 h-8 shrink-0 aspect-square bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center overflow-hidden">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                        ) : (
                          <UserIcon className="w-4 h-4 text-white" />
                        )}
                      </div>
                      <div className="flex flex-col items-start justify-start min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground break-words">{displayName}</p>
                        <p className="text-xs text-muted-foreground break-words">{email}</p>
                      </div>
                    </div>

                    <div className="border-t border-border my-2"></div>

                    {/* Menu Items */}
                    <div className="space-y-1">
                      {/*<button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors" onClick={() => { setUserMenuOpen(false); setAccountCenterTab("pricing"); setAccountCenterOpen(true); }}>
                      <Star className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">Upgrade to Pro</span>
                    </button>*/}
                      {/* Pro Plan badge */}
                      <div className="w-full px-3 py-2.5 rounded-lg mb-1.5 relative overflow-hidden button-gradient">
                        <div className="flex items-center justify-between relative">
                          <div className="flex items-center gap-2.5">
                            <Sparkles className="w-4 h-4 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]" />
                            <span className="text-sm font-semibold text-white">Pro Plan</span>
                          </div>
                          <span className="text-xs font-regular tracking-wide text-white/90 bg-white/15 border border-white/20 px-2 py-0.5 rounded-full">Current plan</span>
                        </div>
                      </div>

                      {/* Credit usage */}
                      <div className="w-full p-2 rounded-md dark:bg-white/10 bg-foreground/5 mb-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-primary" />
                            <span className="text-sm text-foreground">Credit</span>
                          </div>
                          <span className="text-sm font-bold text-foreground dark:text-white tabular-nums">
                            {hasCreditBalance ? creditsRemaining.toLocaleString() : "..."}
                            <span className="text-foreground/30 dark:text-white/30 font-normal"> / {tierLimit.toLocaleString()}</span>
                          </span>
                        </div>
                        <div className="h-3 w-full dark:bg-white/10 bg-foreground/10 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${Math.min(creditPct * 100, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <p className="text-[10px] text-foreground/30 dark:text-white/30">Resets monthly</p>
                          <button
                            onClick={() => { setUserMenuOpen(false); setAccountCenterTab("plans"); setAccountCenterOpen(true); }}
                            className="text-[10px] text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 hover:underline transition-colors cursor-pointer"
                          >
                            Plans & credits →
                          </button>
                        </div>
                      </div>

                      <div className="border-t border-border my-1"></div>

                      <button
                        onClick={() => { setUserMenuOpen(false); setAccountCenterTab("account"); setAccountCenterOpen(true); }}
                        className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
                      >
                        <UserIcon className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">Manage Account</span>
                      </button>
                      {/*<button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                      <CreditCard className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">Billing</span>
                    </button>
                    <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                      <Bell className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">Notifications</span>
                    </button>*/}
                      <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors" onClick={handleLogout}>
                        <LogOut className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">Log out</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </SignedIn>
          </div>
        </div>

        {/* Mobile sidebar (Sheet) */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="md:hidden w-[60vw] max-w-xs bg-muted border-r border-border p-4 z-[300]" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="space-y-2">
              <button
                onClick={() => { setMobileNavOpen(false); navigate('/product/data-connectors'); }}
                className={mobileNavItemClass(isProductActive)}
              >
                Product
              </button>
              <button
                onClick={() => { setMobileNavOpen(false); navigate('/about'); }}
                className={mobileNavItemClass(location.pathname === "/about")}
              >
                About
              </button>
              <a
                href="https://discord.gg/GhFjdbgdxd"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileNavOpen(false)}
                className={cn(mobileNavItemClass(), "block")}
              >
                Community
              </a>
              <button
                onClick={() => { setMobileNavOpen(false); navigate("/pricing"); }}
                className={mobileNavItemClass(location.pathname === "/pricing")}
              >
                Pricing
              </button>
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileNavOpen(false)}
                className={cn(mobileNavItemClass(location.pathname === "/docs"), "block")}
              >
                Docs
              </a>
            </div>
          </SheetContent>
        </Sheet>
        {userProfileOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/80"
              onClick={() => setUserProfileOpen(false)}
            />
            <div className="relative z-10 bg-muted rounded-lg shadow-lg w-full max-w-4xl max-h-[95vh] overflow-hidden flex flex-col">
              <div className="px-4 pt-3 pb-2 border-b border-border flex-shrink-0">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground dark:text-white">Manage Account</h2>
                  <button
                    onClick={() => setUserProfileOpen(false)}
                    className="text-foreground/60 dark:text-white/70 hover:text-foreground dark:hover:text-white p-1 rounded-md hover:bg-foreground/10 dark:hover:bg-white/10 transition-colors"
                    aria-label="Close profile"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex flex-1 overflow-y-auto p-2">
                <UserProfile
                  appearance={{
                    baseTheme: resolvedTheme === 'dark' ? dark : undefined,
                    elements: {
                      rootBox: "w-full h-full",
                      card: "shadow-none border-none bg-transparent",
                      navbar: "border-none",
                      navbarButton: resolvedTheme === 'dark' ? "text-white/70 hover:text-white hover:bg-primary active:bg-primary" : "text-foreground/70 hover:text-foreground hover:bg-primary/10",
                      navbarButtonActive: resolvedTheme === 'dark' ? "text-white bg-white" : "text-primary bg-primary/10",
                      page: "p-4 bg-muted",
                      pageScrollBox: "p-0 bg-muted",
                      formButtonPrimary: "button-gradient",
                      formFieldInput: resolvedTheme === 'dark' ? "bg-black border-border text-white placeholder-white/30" : "bg-background border-border text-foreground",
                      formFieldLabel: resolvedTheme === 'dark' ? "text-white" : "text-foreground",
                      identityPreview: "bg-white/10 border-white/20",
                      identityPreviewText: "text-white",
                      identityPreviewEditButton: "text-white hover:text-white/80",
                      formFieldSuccessText: "text-green-400",
                      formFieldErrorText: "text-red-400",
                      footer: "border-none",
                      footerActionLink: "text-white hover:text-white/80",
                      main: "bg-muted",
                      profileSection: "bg-muted",
                      profileSectionTitle: "text-white",
                      profileSectionContent: "bg-muted",
                      profileSectionContentText: "text-white",
                      profileSectionContentButton: "text-white",
                      profileSectionContentButtonPrimary: "button-gradient",
                      profileSectionContentButtonSecondary: "bg-white/10 text-white border-white/20",
                      profileSectionContentButtonDanger: "bg-red-500 text-white",
                      profileSectionContentButtonSuccess: "bg-green-500 text-white",
                      profileSectionContentButtonWarning: "bg-yellow-500 text-white",
                      profileSectionContentButtonInfo: "bg-blue-500 text-white",
                      profileSectionContentButtonLink: "text-white hover:text-white/80",
                      profileSectionContentButtonGhost: "text-white hover:bg-white/10",
                      profileSectionContentButtonOutline: "border-white/20 text-white hover:bg-white/10",
                      profileSectionContentButtonSolid: "bg-white/10 text-white hover:bg-white/20",
                      profileSectionContentButtonSubtle: "text-white/70 hover:text-white hover:bg-white/5",
                      profileSectionContentButtonDestructive: "bg-red-500 text-white hover:bg-red-600",
                      profileSectionContentButtonConstructive: "bg-green-500 text-white hover:bg-green-600",
                      profileSectionContentButtonNeutral: "bg-white/10 text-white hover:bg-white/20",
                      profileSectionContentButtonBrand: "button-gradient",
                      profileSectionContentButtonPrimaryBrand: "button-gradient",
                      profileSectionContentButtonSecondaryBrand: "bg-white/10 text-white border-white/20",
                      profileSectionContentButtonTertiaryBrand: "text-white hover:bg-white/10",
                      profileSectionContentButtonQuaternaryBrand: "text-white/70 hover:text-white",
                      profileSectionContentButtonGhostBrand: "text-white hover:bg-white/10",
                      profileSectionContentButtonOutlineBrand: "border-white/20 text-white hover:bg-white/10",
                      profileSectionContentButtonSolidBrand: "bg-white/10 text-white hover:bg-white/20",
                      profileSectionContentButtonSubtleBrand: "text-white/70 hover:text-white hover:bg-white/5",
                      profileSectionContentButtonDestructiveBrand: "bg-red-500 text-white hover:bg-red-600",
                      profileSectionContentButtonConstructiveBrand: "bg-green-500 text-white hover:bg-green-600",
                      profileSectionContentButtonNeutralBrand: "bg-white/10 text-white hover:bg-white/20"
                    },
                    variables: {
                      colorText: "#ffffff",
                      colorBackground: "primary",
                    },
                    layout: {
                      unsafe_disableDevelopmentModeWarnings: true,
                      animations: true,
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
        {/* Deprecated single pricing modal (kept temporarily) */}
        {/* <PricingModal open={pricingOpen} onClose={() => setPricingOpen(false)} /> */}
        <AccountCenterModal
          open={accountCenterOpen}
          activeTab={accountCenterTab}
          onChangeTab={(t) => setAccountCenterTab(t)}
          onClose={() => setAccountCenterOpen(false)}
        />
      </div>
    </header>
  );
};

export default Header;

// User Profile Modal (global to header)
// Rendered at the end to ensure it overlays content
// Keep outside component to avoid JSX nesting warnings
// We attach it conditionally below the default export via IIFE in runtime
