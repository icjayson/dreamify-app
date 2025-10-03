import React, { useMemo } from "react";
import { Star, CreditCard, Bell, LogOut, User as UserIcon } from "lucide-react";
import { useClerk, useUser, UserProfile } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { useUserSync } from "@/hooks/useUserSync";
import AccountSettings from "@/components/AccountSettings";

type AccountCenterTab = "pricing" | "account" | "billing" | "notifications";

interface AccountCenterModalProps {
  open: boolean;
  activeTab: AccountCenterTab;
  onChangeTab: (tab: AccountCenterTab) => void;
  onClose: () => void;
}

const PricingContent: React.FC = () => {
  return (
    <div className="w-full">
      <div className="px-2 sm:px-4 pt-8 pb-4 border-b border-border text-center">
        <h2 className="text-2xl md:text-3xl font-semibold text-white">Choose your plan</h2>
        <p className="text-sm text-white/70 mt-2">Start with our free tier and upgrade as you grow to unlock higher limits, better support, and more features.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 md:p-6 items-stretch">
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-white/0 p-5 h-full flex flex-col">
          <h3 className="text-lg font-semibold text-white">Sandbox</h3>
          <div className="mt-3"><span className="text-4xl font-bold text-white">$0</span><span className="text-white/70 text-sm"> / month</span></div>
          <ul className="my-4 space-y-2 text-sm text-white/80">
            <li>5 daily credits</li>
            <li>Diverse templates</li>
            <li>User roles & permissions</li>
            <li>7-day data retention</li>
          </ul>
          <button className="mt-auto w-full button-outline rounded-md py-2 text-sm">Current plan</button>
        </div>
        <div className="rounded-xl border border-primary/30 bg-gradient-to-b from-primary/20 to-primary/5 p-5 ring-1 ring-primary/20 h-full flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Pro</h3>
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-white/10 text-white">POPULAR</span>
          </div>
          <div className="mt-3"><span className="text-4xl font-bold text-white">$25</span><span className="text-white/70 text-sm"> / month</span></div>
          <ul className="my-4 space-y-2 text-sm text-white/80">
            <li>100 monthly credits</li>
            <li>5 daily credits (up to 150/month)</li>
            <li>30-day data retention</li>
            <li>Custom domains</li>
            <li>Remove the Dreamify badge</li>
            <li>User roles & permissions</li>
          </ul>
          <button className="mt-auto w-full button-gradient rounded-md py-2 text-sm">Upgrade to Pro</button>
        </div>
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-white/0 p-5 h-full flex flex-col">
          <h3 className="text-lg font-semibold text-white">Enterprise</h3>
          <div className="mt-3"><span className="text-4xl font-bold text-white">Custom</span></div>
          <ul className="my-4 space-y-2 text-sm text-white/80">
            <li>Dedicated support</li>
            <li>Onboarding services</li>
            <li>Custom connections</li>
            <li>Group-based access control</li>
            <li>Custom design systems</li>
          </ul>
          <button className="mt-auto w-full button-outline rounded-md py-2 text-sm">Contact sales</button>
        </div>
      </div>
    </div>
  );
};

const Placeholder: React.FC<{ title: string; icon?: React.ReactNode }> = ({ title, icon }) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-6">
    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mb-4">
      {icon || <UserIcon className="w-6 h-6 text-white" />}
    </div>
    <h3 className="text-white font-medium text-lg">{title}</h3>
    <p className="text-white/60 text-sm mt-1">Coming soon</p>
  </div>
);

const AccountCenterModal: React.FC<AccountCenterModalProps> = ({ open, activeTab, onChangeTab, onClose }) => {
  const { signOut } = useClerk();
  const { user } = useUser();
  const { supabaseUser } = useUserSync();

  const displayName = supabaseUser?.full_name || user?.fullName || user?.firstName || "User";
  const email = supabaseUser?.email || user?.primaryEmailAddress?.emailAddress || "user@example.com";
  const avatarUrl = supabaseUser?.image_url || user?.imageUrl;

  const sidebarItems = useMemo(() => ([
    { key: "pricing" as AccountCenterTab, label: "Pricing", icon: <Star className="w-4 h-4" /> },
    { key: "account" as AccountCenterTab, label: "Manage Account", icon: <UserIcon className="w-4 h-4" /> },
    { key: "billing" as AccountCenterTab, label: "Billing", icon: <CreditCard className="w-4 h-4" /> },
    { key: "notifications" as AccountCenterTab, label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  ]), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-6xl h-[80vh] bg-muted rounded-2xl border border-border shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-[max-content_1fr]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-2 rounded-md text-white/70 hover:text-white hover:bg-black transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Sidebar */}
        <aside className="border-r border-border bg-secondary/10 h-full">
          <div className="p-3">
            {/* User Info */}
            <div className="flex items-center gap-3 p-2 mb-2">
              <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <UserIcon className="w-4 h-4 text-white" />
                )}
              </div>
              <div className="flex flex-col items-start justify-start min-w-0 whitespace-nowrap">
                <p className="text-sm font-semibold text-white">{displayName}</p>
                <p className="text-xs text-white/70">{email}</p>
              </div>
            </div>
            <div className="h-px w-full bg-border my-2" />
            <div className="space-y-1">
              {sidebarItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => onChangeTab(item.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-black ${activeTab === item.key ? 'bg-black text-white' : 'text-white/80'}`}
                >
                  <span className="text-white/80">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-border my-3"></div>
            <button
              onClick={async () => { await signOut(); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-white/80 hover:bg-black"
            >
              <LogOut className="w-4 h-4" />
              <span>Log out</span>
            </button>
          </div>
        </aside>

        {/* Content */}
        <section className="h-full overflow-y-auto">
          {activeTab === "pricing" && <PricingContent />}
          {activeTab === "account" && <AccountSettings />}
          {activeTab === "billing" && <Placeholder title="Billing" icon={<CreditCard className="w-6 h-6 text-white" />} />}
          {activeTab === "notifications" && <Placeholder title="Notifications" icon={<Bell className="w-6 h-6 text-white" />} />}
        </section>
      </div>
    </div>
  );
};

export default AccountCenterModal;


