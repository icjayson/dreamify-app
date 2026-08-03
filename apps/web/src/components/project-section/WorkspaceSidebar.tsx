import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@/lib/navigation";
import {
  Plug,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronsUpDown,
  LogOut,
  User as UserIcon,
  Sparkles,
  CreditCard,
  Ellipsis,
  SquareArrowOutUpRight,
  MessageSquarePlus,
  ChevronRight,
  Info,
  Mail,
  BookOpen,
  Newspaper,
  Settings,
  FolderOpen,
} from "lucide-react";
import { useUser, useClerk } from "@/lib/clerk";
import { cn } from "@/lib/utils";
import AccountCenterModal from "@/components/homepage-section/AccountCenterModal";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";

type Tab = "new-chat" | "connectors" | "dashboards" | "files";

interface WorkspaceSidebarProject {
  id: string;
  title: string;
}

const NAV_ITEMS: { tab: Tab; label: string; Icon: React.ElementType }[] = [
  { tab: "new-chat", label: "New Project", Icon: MessageSquarePlus },
  { tab: "connectors", label: "Connectors", Icon: Plug },
  { tab: "dashboards", label: "My Dashboards", Icon: LayoutDashboard },
  { tab: "files", label: "Files", Icon: FolderOpen },
];

const XIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z" />
  </svg>
);

const CONTACT_LINKS = [
  { icon: XIcon, href: "https://x.com/dreamify_dev", label: "X (Twitter)", internal: false },
  { icon: FacebookIcon, href: "https://www.facebook.com/profile.php?id=61587411536040", label: "Facebook", internal: false },
  { icon: DiscordIcon, href: "https://discord.gg/GhFjdbgdxd", label: "Discord", internal: false },
  { icon: Mail, href: "https://mail.google.com/mail/?view=cm&to=dreamify.dev@gmail.com&su=Contact%20Dreamify", label: "Email", internal: false },
  { icon: MessageSquarePlus, href: "/feedback", label: "Feedback", internal: true },
];

interface WorkspaceSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (val: boolean) => void;
  activeTab: string;
  projects?: WorkspaceSidebarProject[];
  projectsLoading?: boolean;
  onOpenProject?: (id: string) => void;
  onRenameProject?: (id: string, newTitle: string) => void;
  onDeleteProject?: (id: string) => void;
  aesthetic?: boolean;
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
  aesthetic = false,
}: WorkspaceSidebarProps) {
  const navigate = useNavigate();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { dailyDataRunLimit } = useSubscription();
  const { toast } = useToast();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountCenterTab, setAccountCenterTab] = useState<"pricing" | "account" | "billing" | "notifications" | "plans" | "preferences">("pricing");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState({ open: false, mode: 'rename', itemId: '', itemTitle: '', value: '' });
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

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
    navigate("/workspace?tab=settings&section=account");
  };

  const handlePlansCredits = () => {
    setUserMenuOpen(false);
    navigate("/workspace?tab=settings&section=plans");
  };

  const handlePreferences = () => {
    setUserMenuOpen(false);
    navigate("/workspace?tab=settings&section=preferences");
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

  return (
    <aside
      className={cn(
        "workspace-sidebar flex flex-col sticky top-0 z-50 transition-all duration-300 ease-out flex-shrink-0 rounded-xl m-3",
        aesthetic
          ? "glass-panel-strong workspace-sidebar--aesthetic"
          : "workspace-sidebar--standard border border-border bg-muted/80"
      )}
      style={{ width: collapsed ? "3.5rem" : "280px", height: "calc(100dvh - 1.5rem)" }}
    >
      {/* Sidebar header */}
      <div className="flex items-center justify-between p-4 flex-shrink-0">
        {!collapsed && (
          <span className="workspace-sidebar__title text-foreground/90 font-medium truncate">My workspace</span>
        )}
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className={`workspace-sidebar__collapse-button text-foreground/70 hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted flex-shrink-0 ${collapsed ? "mx-auto" : ""}`}
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
      <div className="workspace-sidebar__nav-section flex flex-col gap-2 px-2 py-2 border-b border-border/30">
        {NAV_ITEMS.map(({ tab, label, Icon }) => (
          <button
            key={tab}
            onClick={() => navigate(`/workspace?tab=${tab}`)}
            className={cn(
              "workspace-sidebar__nav-item flex items-center gap-2 rounded-md border border-transparent py-2 px-2 text-sm transition-colors w-full text-left",
              activeTab === tab
                ? "workspace-sidebar__nav-item--active bg-primary/10 text-primary"
                : "workspace-sidebar__nav-item--inactive text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
              collapsed ? "justify-center px-0" : ""
            )}
            title={collapsed ? label : undefined}
          >
            <Icon className={cn(
              "workspace-sidebar__nav-icon w-4 h-4 flex-shrink-0",
              activeTab === tab ? "text-primary" : "text-muted-foreground"
            )} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </div>

      {/* Recents list — only when expanded */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
          <div className="workspace-sidebar__section-label text-muted-foreground text-xs mt-4 mb-4 px-2">Recent projects</div>
          {projectsLoading ? (
            <div className="workspace-sidebar__muted-text text-muted-foreground text-xs mt-4 text-center flex items-center justify-center gap-2">
              <div className="workspace-sidebar__loading-spinner w-3 h-3 border-2 border-border border-t-foreground/80 rounded-full animate-spin"></div>
              Loading your projects
            </div>
          ) : projects.length === 0 ? (
            <div className="workspace-sidebar__muted-text text-muted-foreground text-xs px-2">No projects yet</div>
          ) : (
            projects.map((item) => (
              <div
                key={item.id}
                className="workspace-sidebar__recent-item group relative w-full rounded-md hover:bg-foreground/5 transition-colors"
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
                  className="workspace-sidebar__project-action hidden md:flex items-center justify-center w-6 h-6 rounded hover:bg-foreground/10 absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Open project"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenProject(item.id);
                  }}
                >
                  <SquareArrowOutUpRight className="w-4 h-4 text-foreground/80" />
                </button>

                {/* Title row with single-line truncation */}
                <div className="workspace-sidebar__recent-title w-full text-left px-3 py-2 text-foreground/90 text-sm md:transition-all md:duration-200 md:group-hover:pl-9 md:group-hover:pr-10 truncate whitespace-nowrap overflow-hidden">
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
                  className={`workspace-sidebar__project-action absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded hover:bg-foreground/10 ${openMenuId === item.id ? '' : 'md:opacity-0 md:group-hover:opacity-100'} transition-opacity`}
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
                      className="w-full text-left px-3 py-1 text-xs rounded hover:bg-foreground/8"
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
      <div className="workspace-sidebar__footer p-4 border-t border-border/30 relative" ref={userMenuRef}>
        <button
          onClick={toggleUserMenu}
          className={cn(
            "workspace-sidebar__user-trigger flex items-center gap-2 rounded-lg transition-colors hover:bg-foreground/5 w-full text-left",
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
              <div className="min-w-0 pr-2">
                <span className="workspace-sidebar__user-name block text-sm font-medium text-foreground truncate" title={displayName}>
                  {displayName}
                </span>
                <span className="workspace-sidebar__user-plan block text-xs text-muted-foreground truncate">Free Preview</span>
              </div>
              <ChevronsUpDown className="workspace-sidebar__user-chevron w-4 h-4 text-foreground/70 ml-auto flex-shrink-0" />
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
              {/* Deployment profile */}
              <div className="w-full px-3 py-2.5 rounded-lg mb-1.5 relative overflow-hidden button-gradient">
                <div className="flex items-center justify-between relative">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]" />
                    <span className="text-sm font-semibold text-white">Free Preview</span>
                  </div>
                  <span className="text-[10px] font-regular tracking-wide text-white/90 bg-white/15 border border-white/20 px-2 py-0.5 rounded-full">Current</span>
                </div>
              </div>

              {/* Preview quota */}
              <div className="w-full p-2 rounded-md bg-muted/60 mb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span className="text-sm text-foreground">Daily data runs</span>
                  </div>
                  <span className="text-sm font-bold text-foreground tabular-nums">
                    Up to {dailyDataRunLimit.toLocaleString()}/day
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-[10px] text-muted-foreground">Server-enforced cap; live usage not shown</p>
                  <button
                    onClick={handlePlansCredits}
                    className="text-[10px] text-muted-foreground hover:text-foreground/70 hover:underline transition-colors cursor-pointer"
                  >
                    Preview limits →
                  </button>
                </div>
              </div>

              <div className="border-t border-border my-1"></div>

              <button
                onClick={handlePlansCredits}
                className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
              >
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Preview limits</span>
              </button>
              <button
                onClick={handleManageAccount}
                className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
              >
                <UserIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Manage Account</span>
              </button>
              <button
                onClick={handlePreferences}
                className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
              >
                <Settings className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Preferences</span>
              </button>

              <div className="border-t border-border my-1"></div>

              {/* Learn more with hover submenu */}
              <div
                className="relative"
                onMouseEnter={() => setLearnMoreOpen(true)}
                onMouseLeave={() => setLearnMoreOpen(false)}
              >
                <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Learn more</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
                </button>

                {/* Submenu */}
                <div
                  className={cn(
                    "absolute left-full bottom-0 ml-1.5 w-[176px] bg-muted border border-border rounded-lg shadow-lg p-1.5 z-[60] transition-all duration-150 origin-bottom-left",
                    learnMoreOpen
                      ? "opacity-100 scale-100 pointer-events-auto"
                      : "opacity-0 scale-95 pointer-events-none"
                  )}
                >
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate("/workspace?tab=privacy"); }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-background transition-colors text-sm text-foreground/80 hover:text-foreground"
                  >
                    <span>Privacy Policy</span>
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate("/workspace?tab=terms"); }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-background transition-colors text-sm text-foreground/80 hover:text-foreground"
                  >
                    <span>Terms of Service</span>
                  </button>
                </div>
              </div>

              {/* Contact with hover submenu */}
              <div
                className="relative"
                onMouseEnter={() => setContactOpen(true)}
                onMouseLeave={() => setContactOpen(false)}
              >
                <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Contact</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
                </button>

                {/* Submenu */}
                <div
                  className={cn(
                    "absolute left-full bottom-0 ml-1.5 w-[176px] bg-muted border border-border rounded-lg shadow-lg p-1.5 z-[60] transition-all duration-150 origin-bottom-left",
                    contactOpen
                      ? "opacity-100 scale-100 pointer-events-auto"
                      : "opacity-0 scale-95 pointer-events-none"
                  )}
                >
                  {CONTACT_LINKS.map(({ icon: Icon, href, label, internal }) => (
                    <button
                      key={label}
                      onClick={() => {
                        setUserMenuOpen(false);
                        if (internal) window.open(href, "_blank", "noopener,noreferrer");
                        else window.open(href, "_blank", "noopener,noreferrer");
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-background transition-colors text-sm text-foreground/80 hover:text-foreground"
                    >
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
                onClick={() => {
                  setUserMenuOpen(false);
                  window.open("/docs", "_blank", "noopener,noreferrer");
                }}
              >
                <BookOpen className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Documentation</span>
              </button>

              <button
                className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
                onClick={() => {
                  setUserMenuOpen(false);
                  window.open("/blog", "_blank", "noopener,noreferrer");
                }}
              >
                <Newspaper className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Blog</span>
              </button>

              <div className="border-t border-border my-1"></div>

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
