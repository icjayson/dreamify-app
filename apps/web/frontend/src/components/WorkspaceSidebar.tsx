import { useState, createContext, useContext, forwardRef, useEffect, useRef } from "react";
import {
  User,
  PanelLeft,
  Plus,
  Building2,
  Star,
  CreditCard,
  Bell,
  LogOut,
  ChevronsUpDown,
  BarChart3,
  Users,
  FileText,
  Headphones,
  ArrowUpRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUser, useClerk, UserProfile } from "@clerk/clerk-react";
import { useUserSync } from "@/hooks/useUserSync";
import { dark } from "@clerk/themes";

// Custom Sheet Components
interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

const Sheet = ({ open, onOpenChange, children }: SheetProps) => {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50">
          <div 
            className="fixed inset-0 bg-black/80" 
            onClick={() => onOpenChange(false)}
          />
          {children}
        </div>
      )}
    </>
  );
};

interface SheetContentProps extends React.ComponentProps<"div"> {
  side?: "left" | "right";
}

const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, side = "left", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "fixed top-0 z-50 h-full w-full border-r bg-muted p-0 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
          side === "right" && "right-0 border-l border-r-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
SheetContent.displayName = "SheetContent";

// Sidebar Context
type SidebarContext = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContext | null>(null);

function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }
  return context;
}

// SidebarProvider Component
const SidebarProvider = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange: setOpenProp,
      className,
      style,
      children,
      ...props
    },
    ref
  ) => {
    const isMobile = useIsMobile();
    const [openMobile, setOpenMobile] = useState(false);
    const [_open, _setOpen] = useState(defaultOpen);
    const open = openProp ?? _open;
    const setOpen = (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
    };

    const toggleSidebar = () => {
      return isMobile
        ? setOpenMobile((open) => !open)
        : setOpen((open) => !open);
    };

    const state = open ? "expanded" : "collapsed";

    const contextValue: SidebarContext = {
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    };

    return (
      <SidebarContext.Provider value={contextValue}>
        <div
          style={
            {
              "--sidebar-width": "16rem",
              "--sidebar-width-icon": "3rem",
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper flex min-h-svh w-full",
            className
          )}
          ref={ref}
          {...props}
        >
          {children}
            </div>
      </SidebarContext.Provider>
    );
  }
);
SidebarProvider.displayName = "SidebarProvider";

// Sidebar Component
const Sidebar = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
  }
>(
  (
    {
      side = "left",
      variant = "sidebar",
      collapsible = "offcanvas",
      className,
      children,
      ...props
    },
    ref
  ) => {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

    if (collapsible === "none") {
      return (
        <div
          className={cn(
            "flex h-full w-[--sidebar-width] flex-col bg-muted text-foreground border-r",
            className
          )}
          ref={ref}
          {...props}
        >
          {children}
          </div>
      );
    }

    if (isMobile) {
      return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent
            data-sidebar="sidebar"
            data-mobile="true"
            className="w-[--sidebar-width] bg-muted p-0 text-foreground"
            style={
              {
                "--sidebar-width": "18rem",
              } as React.CSSProperties
            }
            side={side}
          >
            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "group peer text-foreground",
          "hidden md:flex",
          "w-[--sidebar-width]",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[collapsible=icon]:w-[--sidebar-width-icon]",
          "duration-200 transition-[width] ease-linear",
          className
        )}
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          className="flex h-full w-full flex-col bg-muted border-r group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-border group-data-[variant=floating]:shadow"
        >
          {children}
        </div>
      </div>
    );
  }
);
Sidebar.displayName = "Sidebar";

// SidebarHeader Component
const SidebarHeader = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2 sticky top-0 z-10 bg-muted", className)}
      {...props}
    />
  );
});
SidebarHeader.displayName = "SidebarHeader";

// SidebarContent Component
const SidebarContent = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  );
});
SidebarContent.displayName = "SidebarContent";

// SidebarFooter Component
const SidebarFooter = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2 sticky bottom-0 z-10 bg-muted", className)}
      {...props}
    />
  );
});
SidebarFooter.displayName = "SidebarFooter";

// SidebarGroup Component
const SidebarGroup = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
});
SidebarGroup.displayName = "SidebarGroup";

// SidebarGroupLabel Component
const SidebarGroupLabel = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? "div" : "div";
  return (
    <Comp
      ref={ref}
      data-sidebar="group-label"
      className={cn(
        "duration-200 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-muted-foreground outline-none ring-ring transition-[margin,opa] ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      {...props}
    />
  );
});
SidebarGroupLabel.displayName = "SidebarGroupLabel";

// SidebarGroupContent Component
const SidebarGroupContent = forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="group-content"
    className={cn("w-full text-sm", className)}
    {...props}
  />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

// SidebarMenu Component
const SidebarMenu = forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    data-sidebar="menu"
    className={cn("flex w-full min-w-0 flex-col gap-1", className)}
    {...props}
  />
));
SidebarMenu.displayName = "SidebarMenu";

// SidebarMenuItem Component
const SidebarMenuItem = forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    data-sidebar="menu-item"
    className={cn("group/menu-item relative", className)}
    {...props}
  />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

// SidebarMenuButton Component
const SidebarMenuButton = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
  }
>(
  (
    {
      asChild = false,
      isActive = false,
      className,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? "button" : "button";
    const { isMobile, state } = useSidebar();

    return (
      <Comp
        ref={ref}
        data-sidebar="menu-button"
        data-active={isActive}
        className={cn(
          "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-ring transition-[width,height,padding] hover:bg-background hover:text-foreground focus-visible:ring-2 active:bg-background active:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-primary data-[active=true]:font-medium data-[active=true]:text-foreground data-[state=open]:hover:bg-background data-[state=open]:hover:text-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
          isActive && "bg-secondary font-medium text-foreground",
          className
        )}
        {...props}
      />
    );
  }
);
SidebarMenuButton.displayName = "SidebarMenuButton";

// SidebarTrigger Component
const SidebarTrigger = forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      ref={ref}
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7", className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeft />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";

interface SidebarState {
  activeItem: string;
  workspaceDropdownOpen: boolean;
  userMenuOpen: boolean;
  userProfileOpen: boolean;
}

interface WorkspaceSidebarProps {
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  activeItem?: string;
  onActiveItemChange?: (item: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export default function WorkspaceSidebar({ 
  mobileOpen = false, 
  onMobileOpenChange,
  activeItem,
  onActiveItemChange,
  collapsed,
  onCollapsedChange,
}: WorkspaceSidebarProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { supabaseUser, isSyncing } = useUserSync();
  
  const [state, setState] = useState<SidebarState>({
    activeItem: "projects",
    workspaceDropdownOpen: false,
    userMenuOpen: false,
    userProfileOpen: false,
  });

  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (workspaceDropdownRef.current && !workspaceDropdownRef.current.contains(event.target as Node)) {
        setState(prev => ({ ...prev, workspaceDropdownOpen: false }));
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setState(prev => ({ ...prev, userMenuOpen: false }));
      }
    };

    if (state.workspaceDropdownOpen || state.userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [state.workspaceDropdownOpen, state.userMenuOpen]);

  // Close user profile modal when pressing Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state.userProfileOpen) {
        setState(prev => ({ ...prev, userProfileOpen: false }));
      }
    };

    if (state.userProfileOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [state.userProfileOpen]);

  const handleItemClick = (item: string) => {
    setState(prev => ({ ...prev, activeItem: item }));
    onActiveItemChange?.(item);
  };

  const currentActive = activeItem ?? state.activeItem;

  const toggleWorkspaceDropdown = () => {
    setState(prev => ({ ...prev, workspaceDropdownOpen: !prev.workspaceDropdownOpen }));
  };

  const toggleUserMenu = () => {
    setState(prev => ({ ...prev, userMenuOpen: !prev.userMenuOpen }));
  };

  const handleLogout = async () => {
    try {
      setState(prev => ({ ...prev, userMenuOpen: false }));
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleManageAccount = () => {
    setState(prev => ({ ...prev, userMenuOpen: false, userProfileOpen: true }));
  };

  return (
    <SidebarProvider 
      open={collapsed === undefined ? undefined : !collapsed}
      onOpenChange={(open) => {
        onCollapsedChange?.(!open);
      }}
    >
      <Sidebar 
        variant="sidebar" 
        collapsible="icon"
        className="border-r bg-muted"
      >
        {/* Header Section - Sticky */}
        <SidebarHeader className="border-b bg-secondary/20 relative" ref={workspaceDropdownRef}>
          <button
            onClick={toggleWorkspaceDropdown}
            className="w-full flex items-center justify-between p-3 hover:bg-background rounded-md transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:gap-0"
            aria-label="Toggle workspace menu"
          >
            <div className="flex items-start justify-start gap-3">
              <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col items-start justify-start group-data-[collapsible=icon]:hidden">
                <h3 className="text-sm font-semibold text-foreground">Workspace Name</h3>
                <p className="text-xs text-muted-foreground">Workspace</p>
              </div>
            </div>
            <ChevronsUpDown className="w-4 h-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </button>
        
          {/* Switch Workspace Menu */}
          <div className={cn(
            "absolute top-4 left-full z-50 ml-2 bg-muted border border-border rounded-lg shadow-lg w-64 transition-all duration-200 ease-in-out",
            state.workspaceDropdownOpen 
              ? "opacity-100 translate-x-0 scale-100" 
              : "opacity-0 -translate-x-2 scale-95 pointer-events-none"
          )}>
              <div className="p-2">
                <h4 className="text-xs font-medium text-muted-foreground mb-2 px-2">Teams</h4>
                <div className="space-y-1">
                  <button className="w-full flex items-center justify-between p-2 hover:bg-background rounded-md transition-colors">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-primary" />
                      <span className="text-sm text-foreground">Workspace 1</span>
                    </div>
                    <span className="text-xs text-muted-foreground">⌘1</span>
                  </button>
                  <button className="w-full flex items-center justify-between p-2 hover:bg-background rounded-md transition-colors">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-primary" />
                      <span className="text-sm text-foreground">Workspace 2</span>
                    </div>
                    <span className="text-xs text-muted-foreground">⌘2</span>
                  </button>
                  <button className="w-full flex items-center justify-between p-2 hover:bg-background rounded-md transition-colors">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-primary" />
                      <span className="text-sm text-foreground">Workspace 3</span>
                    </div>
                    <span className="text-xs text-muted-foreground">⌘3</span>
                  </button>
                </div>
                <div className="border-t border-border my-2"></div>
                <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                  <Plus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Add workspace</span>
                </button>
              </div>
            </div>
        </SidebarHeader>

        {/* Content Section - Scrollable */}
        <SidebarContent className="flex-1 overflow-y-auto">
          {/* Top Group - Primary navigation */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem className="flex flex-col items-center justify-center">
                  <SidebarMenuButton
                    isActive={currentActive === "projects"}
                    onClick={() => handleItemClick("projects")}
                    className="w-full flex items-center justify-between rounded-xl px-2 py-2 mt-2 mb-2"
                  >
                    <div className="flex items-center gap-3">
                      <BarChart3 className="w-5 h-5" />
                      <span className="text-base font-medium group-data-[collapsible=icon]:hidden">Projects</span>
                    </div>
                  </SidebarMenuButton>
                  <SidebarMenuButton
                    isActive={currentActive === "template"}
                    onClick={() => handleItemClick("template")}
                    className="w-full flex items-center justify-between px-2 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5" />
                      <span className="text-base font-medium group-data-[collapsible=icon]:hidden">Template</span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <div className="h-px w-full bg-border" />
          
          {/* Bottom Group - Resources */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem className="flex flex-col items-center justify-center">
                  <SidebarMenuButton
                    isActive={currentActive === "learn"}
                    onClick={() => handleItemClick("learn")}
                    className="w-full flex items-center justify-between px-2 py-2 mb-2"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5" />
                      <span className="text-base font-medium group-data-[collapsible=icon]:hidden">Learn</span>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                  <SidebarMenuButton
                    isActive={currentActive === "help"}
                    onClick={() => handleItemClick("help")}
                    className="w-full flex items-center justify-between px-2 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Headphones className="w-5 h-5" />
                      <span className="text-base font-medium group-data-[collapsible=icon]:hidden">Help</span>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Footer Section - Sticky */}
        <SidebarFooter className="border-t bg-secondary/20 relative" ref={userMenuRef}>
          <div className="p-1">
            <button
              onClick={toggleUserMenu}
              className="w-full flex items-center gap-3 p-3 hover:bg-background rounded-md transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:gap-0"
              aria-label="Toggle user menu"
            >
              <div className="w-8 h-8 shrink-0 aspect-square bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center overflow-hidden">
                {(supabaseUser?.image_url || user?.imageUrl) ? (
                  <img 
                    src={supabaseUser?.image_url || user?.imageUrl} 
                    alt={supabaseUser?.full_name || user?.fullName || "User"} 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-4 h-4 text-white" />
                )}
              </div>
              <div className="flex-1 min-w-0 text-left group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-medium text-foreground truncate" title={supabaseUser?.full_name || user?.fullName || user?.firstName || "User"}>
                  {supabaseUser?.full_name || user?.fullName || user?.firstName || "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate" title={supabaseUser?.email || user?.primaryEmailAddress?.emailAddress || "user@example.com"}>
                  {supabaseUser?.email || user?.primaryEmailAddress?.emailAddress || "user@example.com"}
                </p>
                {isSyncing && (
                  <p className="text-xs text-blue-500">Syncing...</p>
                )}
              </div>
              <ChevronsUpDown className="w-4 h-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </button>
          </div>
          
          {/* User Menu Dropdown */}
          <div className={cn(
            "absolute bottom-4 left-full z-50 ml-2 bg-muted border border-border rounded-lg shadow-lg w-64 transition-all duration-200 ease-in-out",
            state.userMenuOpen 
              ? "opacity-100 translate-x-0 scale-100" 
              : "opacity-0 -translate-x-2 scale-95 pointer-events-none"
          )}>
            <div className="p-2">
              {/* User Info Header */}
              <div className="flex items-center gap-3 p-2 mb-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center overflow-hidden">
                  {(supabaseUser?.image_url || user?.imageUrl) ? (
                    <img 
                      src={supabaseUser?.image_url || user?.imageUrl} 
                      alt={supabaseUser?.full_name || user?.fullName || "User"} 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-4 h-4 text-white" />
                  )}
                </div>
                <div className="flex flex-col items-start justify-start">
                  <p className="text-sm font-medium text-foreground">
                    {supabaseUser?.full_name || user?.fullName || user?.firstName || "User"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {supabaseUser?.email || user?.primaryEmailAddress?.emailAddress || "user@example.com"}
                  </p>
                  {isSyncing && (
                    <p className="text-xs text-blue-500">Syncing...</p>
                  )}
                </div>
              </div>
              
              <div className="border-t border-border my-2"></div>
              
              {/* Menu Items */}
              <div className="space-y-1">
                <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                  <Star className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Upgrade to Pro</span>
                </button>
                <button 
                  onClick={handleManageAccount}
                  className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Manage Account</span>
        </button>
                <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                  <CreditCard className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Billing</span>
        </button>
                <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Notifications</span>
        </button>
                <button className="w-full flex items-center gap-2 p-2 hover:bg-background rounded-md transition-colors" onClick={handleLogout}>
                  <LogOut className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Log out</span>
        </button>
              </div>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      
      {/* User Profile Modal */}
      {state.userProfileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-black/80" 
            onClick={() => setState(prev => ({ ...prev, userProfileOpen: false }))}
          />
          <div className="relative z-10 bg-muted rounded-lg shadow-lg w-full max-w-4xl max-h-[95vh] overflow-hidden flex flex-col">
            <div className="px-4 pt-3 pb-2 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Manage Account</h2>
                <button
                  onClick={() => setState(prev => ({ ...prev, userProfileOpen: false }))}
                  className="text-white/70 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
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
                  baseTheme: dark,
                  elements: {
                    rootBox: "w-full h-full",
                    card: "shadow-none border-none bg-transparent",
                    navbar: "border-none",
                    navbarButton: "text-white/70 hover:text-white hover:bg-primary active:bg-primary",
                    navbarButtonActive: "text-white bg-white",
                    page: "p-4 bg-muted",
                    pageScrollBox: "p-0 bg-muted",
                    formButtonPrimary: "button-gradient",
                    formFieldInput: "bg-black border-border text-white placeholder-white/30",
                    formFieldLabel: "text-white",
                    identityPreview: "bg-white/10 border-white/20",
                    identityPreviewText: "text-white",
                    identityPreviewEditButton: "text-white hover:text-white/80",
                    formFieldSuccessText: "text-green-400",
                    formFieldErrorText: "text-red-400",
                    footer: "border-none",
                    footerActionLink: "text-white hover:text-white/80",
                    // Additional selectors for dark theme
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
    </SidebarProvider>
  );
}