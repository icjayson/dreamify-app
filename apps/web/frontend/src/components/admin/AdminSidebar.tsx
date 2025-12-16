import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, LogOut, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAdminAuth } from '@/contexts/AdminAuthContext';

interface AdminSidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function AdminSidebar({ collapsed = false, onCollapsedChange }: AdminSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, credentials } = useAdminAuth();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div
      className={cn(
        'border-r bg-card/50 transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-16 items-center border-b px-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-5 w-5" />
              <span className="font-semibold">Admin Panel</span>
            </div>
          )}
          {collapsed && (
            <LayoutDashboard className="h-5 w-5 mx-auto" />
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-8 p-4">
          <Button
            variant={isActive('/admin') ? 'secondary' : 'ghost'}
            className={cn(
              'w-full justify-start',
              collapsed && 'justify-center px-0'
            )}
            onClick={() => navigate('/admin')}
          >
            <LayoutDashboard className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Dashboard</span>}
          </Button>
          {!collapsed && (
            <div className="mt-4 px-2">
              <img 
                src="/funfunadminport.gif" 
                alt="Admin Portal" 
                className="w-full h-auto object-contain rounded"
              />
            </div>
          )}
                    {!collapsed && (
            <div className="mt-4 px-2">
              <img 
                src="/fungift2.gif" 
                alt="Admin Portal" 
                className="w-full h-auto object-contain rounded"
              />
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t p-4 space-y-2">
          {!collapsed && credentials && (
            <div className="px-2 py-1 text-sm text-muted-foreground">
              Logged in as: <span className="font-medium">{credentials.username}</span>
            </div>
          )}
          <Button
            variant="ghost"
            className={cn(
              'w-full justify-start text-destructive hover:text-destructive',
              collapsed && 'justify-center px-0'
            )}
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Logout</span>}
          </Button>
          {onCollapsedChange && (
            <Button
              variant="ghost"
              size="icon"
              className="w-full"
              onClick={() => onCollapsedChange(!collapsed)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

