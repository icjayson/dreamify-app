import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plug,
  LayoutDashboard,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronsUpDown,
  LogOut,
  User as UserIcon,
  Sparkles,
  CreditCard,
  Bell,
  Ellipsis,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useUser, useClerk } from "@clerk/clerk-react";
import { cn } from "@/lib/utils";
import AccountCenterModal from "@/components/homepage-section/AccountCenterModal";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";

type Tab = "connectors" | "dashboards" | "schedules";

const NAV_ITEMS: { tab: Tab; label: string; Icon: React.ElementType }[] = [
  { tab: "connectors", label: "Connectors", Icon: Plug },
  { tab: "dashboards", label: "My Dashboards", Icon: LayoutDashboard },
  { tab: "schedules", label: "Scheduled Syncs", Icon: Clock },
];

interface WorkspaceSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (val: boolean) => void;
  activeTab: string;
  projects?: any[]; // Replaced by Recents 
  projectsLoading?: boolean;
  onOpenProject?: (id: string) => void;
  onRenameProject?: (id: string, newTitle: string) => void;
  onDeleteProject?: (id: string) => void;
}

export default function WorkspaceSidebar({
  collapsed,
  onCollapsedChange,
  activeTab,
  projects = [],
  projectsLoading = false,
  onOpenProject = () => { },
  onRenameProject = () => { },
  onDeleteProject = () => { },
}: WorkspaceSidebarProps) {
  const navigate = useNavigate();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { creditsRemaining } = useSubscription();
  const { toast } = useToast();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountCenterTab, setAccountCenterTab] = useState<"pricing" | "account" | "billing" | "notifications" | "plans">("pricing");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState({ open: false, mode: 'rename', itemId: '', itemTitle: '', value: '' });

  const userMenuRef = useRef<HTMLDivElement>(null);

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
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab ?? 'account';
      setAccountCenterTab(tab);
      setAccountCenterOpen(true);
    };
    window.addEventListener('dreamify:open-account-center', handler);
    return () => window.removeEventListener('dreamify:open-account-center', handler);
  }, []);

  const toggleUserMenu = () => setUserMenuOpen(prev => !prev);

  const handleManageAccount = () => {
    setUserMenuOpen(false);
    setAccountCenterTab("account");
    setAccountCenterOpen(true);
  };

  const handleLogout = async () => {
    try {
      setUserMenuOpen(false);
      await signOut();
    } catch (e) {
      console.error("Error signing out:", e);
    }
  };

  const displayName = user?.fullName || user?.firstName || "User";
  const email = user?.primaryEmailAddress?.emailAddress || "user@example.com";
  const avatarUrl = user?.imageUrl;

  const tierLimit = 1000;
  const creditPct = tierLimit > 0 ? creditsRemaining / tierLimit : 0;

  return (
    <aside
      className="flex flex-col h-screen sticky top-0 z-50 border-r border-border bg-muted/80 transition-all duration-300 ease-out flex-shrink-0"
      style={{ width: collapsed ? "3.5rem" : "280px" }}
    >
      {/* Sidebar header */}
      <div className="flex items-center justify-between p-4 flex-shrink-0">
        {!collapsed && (
          <span className="text-foreground/90 font-medium truncate">My workspace</span>
        )}
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className={`text-foreground/70 hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted flex-shrink-0 ${collapsed ? "mx-auto" : ""}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4 transition-all duration-200" />
          ) : (
            <PanelLeftClose className="w-4 h-4 transition-all duration-200" />
          )}
        </button>
      </div>

      {/* Nav buttons */}
      <div className="flex flex-col gap-2 px-4 py-2 border-b border-border/30">
        {NAV_ITEMS.map(({ tab, label, Icon }) => (
          <button
            key={tab}
            onClick={() => navigate(`/workspace?tab=${tab}`)}
            className={cn(
              "flex items-center gap-2 rounded-md py-2 px-3 text-sm transition-colors w-full text-left",
              activeTab === tab
                ? "bg-primary/10 text-primary"
                : "text-foreground/70 hover:bg-muted hover:text-foreground",
              collapsed ? "justify-center px-0" : ""
            )}
            title={collapsed ? label : undefined}
          >
            <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </div>

      {/* Recents list — only when expanded */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          <div className="text-muted-foreground text-xs mt-4 mb-4">Recent projects</div>
          {projectsLoading ? (
            <div className="text-muted-foreground text-xs mt-4 text-center flex items-center justify-center gap-2">
              <div className="w-3 h-3 border-2 border-border border-t-foreground/80 rounded-full animate-spin"></div>
              Loading your projects
            </div>
          ) : projects.length === 0 ? (
            <div className="text-muted-foreground text-xs px-2">No projects yet</div>
          ) : (
            projects.slice(0, 10).map((item) => (
              <div
                key={item.id}
                className="group relative w-full rounded-md hover:bg-muted transition-colors"
                onClick={() => onOpenProject(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenProject(item.id);
                  }
                }}
              >
                {/* Left open icon (desktop hover) */}
                <button
                  className="hidden md:flex items-center justify-center w-6 h-6 rounded hover:bg-primary/50 absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Open project"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenProject(item.id);
                  }}
                >
                  <SquareArrowOutUpRight className="w-4 h-4 text-foreground/80" />
                </button>

                {/* Title row with single-line truncation */}
                <div className="w-full text-left px-3 py-2 text-foreground/90 text-sm md:transition-all md:duration-200 md:group-hover:pl-9 md:group-hover:pr-10 truncate whitespace-nowrap overflow-hidden">
                  {item.title}
                </div>

                {/* Hover tooltip with full title */}
                <div className="pointer-events-none absolute left-3 bottom-full mb-2 z-[200] opacity-0 group-hover:opacity-100 transition-opacity hidden md:block">
                  <div className="relative max-w-[240px] px-3 py-1.5 text-xs bg-popover text-popover-foreground border border-border rounded-md shadow-lg whitespace-normal break-words">
                    {item.title}
                    <div className="absolute -bottom-1 left-4 w-2 h-2 bg-popover rotate-45" />
                  </div>
                </div>

                {/* Right kebab button */}
                <button
                  className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded hover:bg-primary/50 ${openMenuId === item.id ? '' : 'md:opacity-0 md:group-hover:opacity-100'} transition-opacity`}
                  aria-label="More actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId((prev) => (prev === item.id ? null : item.id));
                  }}
                >
                  <Ellipsis className="w-4 h-4 text-foreground/80" />
                </button>

                {openMenuId === item.id && (
                  <div
                    className="absolute right-2 top-full mt-1 max-w-[100px] bg-background/95 backdrop-blur-sm border border-border/30 rounded-md shadow-lg p-1 z-20"
                  >
                    <button
                      className="w-full text-left px-3 py-1 text-xs rounded hover:bg-primary/30"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ open: true, mode: 'rename', itemId: item.id, itemTitle: item.title, value: item.title });
                        setOpenMenuId(null);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="w-full text-left px-3 py-1 text-xs rounded hover:bg-red-500/10 text-red-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ open: true, mode: 'delete', itemId: item.id, itemTitle: item.title, value: '' });
                        setOpenMenuId(null);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Spacer for collapsed */}
      {collapsed && <div className="flex-1" />}

      {/* Footer / User Account */}
      <div className="p-4 border-t border-border/30 relative" ref={userMenuRef}>
        <button
          onClick={toggleUserMenu}
          className={cn(
            "flex items-center gap-2 rounded-lg transition-colors hover:bg-muted w-full text-left",
            collapsed ? "justify-center py-2 px-0" : "px-2 py-1.5"
          )}
          aria-label="Toggle user menu"
        >
          <div className="w-8 h-8 shrink-0 aspect-square bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <UserIcon className="w-4 h-4 text-white" />
            )}
          </div>
          {!collapsed && (
            <>
              <span className="text-sm font-medium text-foreground min-w-0 pr-2 truncate" title={displayName}>
                {displayName}
              </span>
              <ChevronsUpDown className="w-4 h-4 text-foreground/70 ml-auto flex-shrink-0" />
            </>
          )}
        </button>

        {/* User Menu Dropdown (Matches Header) */}
        <div className={cn(
          "absolute left-4 bottom-full mb-2 z-50 bg-muted border border-border rounded-lg shadow-lg w-[248px] max-w-[calc(100vw-32px)] transition-all duration-200 ease-in-out origin-bottom-left",
          userMenuOpen ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95 pointer-events-none"
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
                <p className="text-sm font-medium text-foreground break-words truncate w-full">{displayName}</p>
                <p className="text-xs text-muted-foreground break-words truncate w-full">{email}</p>
              </div>
            </div>

            <div className="border-t border-border my-2"></div>

            <div className="space-y-1">
              {/* Pro Plan badge */}
              <div className="w-full px-3 py-2.5 rounded-lg mb-1.5 relative overflow-hidden button-gradient">
                <div className="flex items-center justify-between relative">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]" />
                    <span className="text-sm font-semibold text-white">Pro Plan</span>
                  </div>
                  <span className="text-[10px] font-regular tracking-wide text-white/90 bg-white/15 border border-white/20 px-2 py-0.5 rounded-full">Current</span>
                </div>
              </div>

              {/* Credit usage */}
              <div className="w-full p-2 rounded-md bg-muted/60 mb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span className="text-sm text-foreground">Credit</span>
                  </div>
                  <span className="text-sm font-bold text-foreground tabular-nums">
                    {creditsRemaining.toLocaleString()}
                    <span className="text-muted-foreground font-normal"> / {tierLimit.toLocaleString()}</span>
                  </span>
                </div>
                <div className="h-3 w-full bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.min(creditPct * 100, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-[10px] text-muted-foreground">Resets monthly</p>
                  <button
                    onClick={() => { setUserMenuOpen(false); setAccountCenterTab("plans"); setAccountCenterOpen(true); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground/70 hover:underline transition-colors cursor-pointer"
                  >
                    Plans & credits →
                  </button>
                </div>
              </div>

              <div className="border-t border-border my-1"></div>

              <button
                onClick={handleManageAccount}
                className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
              >
                <UserIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Manage Account</span>
              </button>
              <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors" onClick={handleLogout}>
                <LogOut className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Log out</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <AccountCenterModal
        open={accountCenterOpen}
        activeTab={accountCenterTab}
        onChangeTab={(t) => setAccountCenterTab(t)}
        onClose={() => setAccountCenterOpen(false)}
      />

      {/* Small confirm/rename modal */}
      {dialog.open && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDialog({ ...dialog, open: false })} />
          <div className="relative z-[161] w-[280px] rounded-md border border-border/40 bg-background/95 backdrop-blur-md shadow-xl p-3">
            {dialog.mode === 'rename' ? (
              <div>
                <div className="text-sm text-foreground/80 mb-2">Rename project</div>
                <input
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm rounded-md bg-muted/50 border border-border/40 outline-none focus:border-primary/60"
                  autoFocus
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    className="px-3 py-1.5 text-xs rounded-md bg-transparent border border-border/40 text-foreground/70 hover:text-foreground"
                    onClick={() => setDialog({ ...dialog, open: false })}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs rounded-md button-gradient"
                    onClick={() => {
                      const v = dialog.value.trim();
                      if (v && dialog.itemId) {
                        onRenameProject(dialog.itemId, v);
                        toast({
                          title: "Project renamed",
                          description: `"${dialog.itemTitle}" → "${v}"`,
                          className: "border border-border/40 bg-background/90 backdrop-blur-md",
                        });
                      }
                      setDialog({ ...dialog, open: false });
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm text-foreground/80 mb-3">Delete "{dialog.itemTitle}"?</div>
                <div className="flex justify-end gap-2">
                  <button
                    className="px-3 py-1.5 text-xs rounded-md bg-transparent border border-border/40 text-foreground/70 hover:text-foreground"
                    onClick={() => setDialog({ ...dialog, open: false })}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs rounded-md bg-red-600/80 hover:bg-red-600 text-white"
                    onClick={() => {
                      if (dialog.itemId) {
                        onDeleteProject(dialog.itemId);
                        window.dispatchEvent(new Event('projectUpdated'));
                        toast({
                          title: "Project deleted",
                          description: `"${dialog.itemTitle}" was removed`,
                          variant: "destructive",
                          className: "border border-destructive/40 bg-destructive/20 backdrop-blur-md",
                        });
                      }
                      setDialog({ ...dialog, open: false });
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}