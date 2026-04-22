import { useEffect, useState } from "react";
import { PanelLeftClose, SquarePlus, Ellipsis, SquareArrowOutUpRight, Plug, LayoutDashboard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface ProjectsSidebarProps {
  open: boolean;
  onClose: () => void;
  onNewProject?: () => void;
  recents?: Array<{ id: string; title: string }>;
  isLoading?: boolean;
  onOpenProject?: (id: string) => void;
  onRenameProject?: (id: string, newTitle: string) => void;
  onDeleteProject?: (id: string) => void;
  className?: string;
}


const ProjectsSidebar: React.FC<ProjectsSidebarProps> = ({ open, onClose, onNewProject, recents, isLoading, onOpenProject, onRenameProject, onDeleteProject, className }) => {
  const navigate = useNavigate();
  const [sidebarShown, setSidebarShown] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    mode: 'rename' | 'delete';
    itemId: string | null;
    itemTitle: string;
    value: string;
  }>({ open: false, mode: 'rename', itemId: null, itemTitle: '', value: '' });
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      // Double rAF ensures the browser has painted the initial hidden state
      // before triggering the slide-in transition (setTimeout was too fast in prod)
      let rafId: number;
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => {
          setSidebarShown(true);
        });
      });
      return () => cancelAnimationFrame(rafId);
    } else {
      setSidebarShown(false);
      const timeout = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  // Close kebab menu on outside click or Escape
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (
        openMenuId &&
        !target.closest('[data-menu="kebab"]') &&
        !target.closest('[data-btn="kebab"]')
      ) {
        setOpenMenuId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    if (openMenuId) {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  if (!shouldRender) return null;

  const computedRecents = recents ?? [];
  const hasRecents = Array.isArray(computedRecents) && computedRecents.length > 0;

  // Safe no-op handlers used when not provided
  const safeNewProject = onNewProject ?? (() => { });
  const safeOpenProject = onOpenProject ?? ((id: string) => { });
  const safeRenameProject = onRenameProject ?? ((id: string, newTitle: string) => { });
  const safeDeleteProject = onDeleteProject ?? ((id: string) => { });

  return (
    <div className="fixed inset-0 z-[250]" role="dialog" aria-modal="true">
      <div
        className={`absolute inset-0 bg-black/10 transition-opacity duration-300 ${sidebarShown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className={`absolute left-0 top-0 h-full w-[280px] max-w-[80vw] ${className || 'bg-muted/80'} border-r border-border p-4 flex flex-col transform transition-transform duration-300 ease-out ${sidebarShown ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-foreground/90 dark:text-white/90 font-medium">My workspace</div>
          <button onClick={onClose} className="text-muted-foreground dark:text-white/70 hover:text-foreground dark:hover:text-white text-sm" aria-label="Close projects">
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        <button
          className="button-outline w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2"
          onClick={safeNewProject}
        >
          <SquarePlus className="w-4 h-4 text-muted-foreground dark:text-white/70" />
          <span>New project</span>
        </button>
        {/* Connectors */}
        <button
          className="w-full text-left px-3 py-2 mt-2 rounded-md text-sm flex items-center gap-2 hover:bg-foreground/5 dark:hover:bg-black/30 transition-colors text-foreground/80 dark:text-white/80"
          onClick={() => { onClose(); navigate('/workspace?tab=connectors'); }}
        >
          <Plug className="w-4 h-4 text-muted-foreground dark:text-white/60" />
          <span>Connectors</span>
        </button>
        {/* My Dashboards */}
        <button
          className="w-full text-left px-3 py-2 mt-2 rounded-md text-sm flex items-center gap-2 hover:bg-foreground/5 dark:hover:bg-black/30 transition-colors text-foreground/80 dark:text-white/80"
          onClick={() => { onClose(); navigate('/workspace?tab=dashboards'); }}
        >
          <LayoutDashboard className="w-4 h-4 text-muted-foreground dark:text-white/60" />
          <span>My Dashboards</span>
        </button>
        <div className="flex-1 overflow-y-auto space-y-2">
          <div className="text-muted-foreground dark:text-white/50 text-xs mt-4 mb-4">Recent projects</div>
          {isLoading ? (
            <div className="text-muted-foreground dark:text-white/50 text-xs mt-4 text-center flex items-center justify-center gap-2">
              <div className="w-3 h-3 border-2 border-border dark:border-white/20 border-t-foreground dark:border-t-white/80 rounded-full animate-spin"></div>
              Loading your projects
            </div>
          ) : hasRecents ? (
            computedRecents.map((item) => (
              <div
                key={item.id}
                className="group relative w-full rounded-md hover:bg-foreground/5 dark:hover:bg-black/40 transition-colors"
                onClick={() => safeOpenProject(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    safeOpenProject(item.id);
                  }
                }}
              >
                {/* Left open icon (desktop hover) */}
                <button
                  className="hidden md:flex items-center justify-center w-6 h-6 rounded hover:bg-primary/50 absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Open project"
                  onClick={(e) => {
                    e.stopPropagation();
                    safeOpenProject(item.id);
                  }}
                >
                  <SquareArrowOutUpRight className="w-4 h-4 text-muted-foreground dark:text-white/80" />
                </button>

                {/* Title row with single-line truncation */}
                <div className="w-full text-left px-3 py-2 text-foreground/90 dark:text-white/90 text-sm md:transition-all md:duration-200 md:group-hover:pl-9 md:group-hover:pr-10 truncate whitespace-nowrap overflow-hidden">
                  {item.title}
                </div>

                {/* Hover tooltip with full title */}
                <div className="pointer-events-none absolute left-3 bottom-full mb-2 z-[200] opacity-0 group-hover:opacity-100 transition-opacity hidden md:block">
                  <div className="relative max-w-[240px] px-3 py-1.5 text-xs bg-background/95 dark:bg-black/80 border border-border dark:border-transparent text-foreground dark:text-white rounded-md shadow-lg whitespace-normal break-words">
                    {item.title}
                    <div className="absolute -bottom-1 left-4 w-2 h-2 bg-background/95 dark:bg-black/80 border-r border-b border-border dark:border-transparent rotate-45" />
                  </div>
                </div>

                {/* Right kebab button (always visible on mobile, hover on desktop) */}
                <button
                  data-btn="kebab"
                  className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded hover:bg-primary/50 ${openMenuId === item.id ? '' : 'md:opacity-0 md:group-hover:opacity-100'} transition-opacity`}
                  aria-label="More actions"
                  aria-expanded={openMenuId === item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId((prev) => (prev === item.id ? null : item.id));
                  }}
                >
                  <Ellipsis className="w-4 h-4 text-muted-foreground dark:text-white/80" />
                </button>

                {openMenuId === item.id && (
                  <div
                    data-menu="kebab"
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
          ) : (
            <div className="text-muted-foreground dark:text-white/50 text-xs mt-4 text-center">No projects yet</div>
          )}
        </div>
      </div>

      {/* Small confirm/rename modal */}
      {dialog.open && (
        <div className="absolute inset-0 z-[160] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDialog({ ...dialog, open: false })} />
          <div className="relative z-[161] w-[280px] rounded-md border border-border/40 bg-background/95 backdrop-blur-md shadow-xl p-3">
            {dialog.mode === 'rename' ? (
              <div>
                <div className="text-sm text-foreground/80 dark:text-white/80 mb-2">Rename project</div>
                <input
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm rounded-md bg-transparent dark:bg-muted/50 border border-border/40 outline-none focus:border-primary/60 text-foreground dark:text-white"
                  autoFocus
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    className="px-3 py-1.5 text-xs rounded-md bg-transparent border border-border/40 text-muted-foreground dark:text-white/70 hover:text-foreground dark:hover:text-white"
                    onClick={() => setDialog({ ...dialog, open: false })}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs rounded-md button-gradient"
                    onClick={() => {
                      const v = dialog.value.trim();
                      if (v && dialog.itemId) {
                        safeRenameProject(dialog.itemId, v);
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
                <div className="text-sm text-foreground/80 dark:text-white/80 mb-4">Are you sure you want to delete "{dialog.itemTitle}"?</div>
                <div className="flex justify-end gap-2">
                  <button
                    className="px-3 py-1.5 text-xs rounded-md bg-transparent border border-border/40 text-muted-foreground dark:text-white/70 hover:text-foreground dark:hover:text-white"
                    onClick={() => setDialog({ ...dialog, open: false })}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs rounded-md bg-red-600/80 hover:bg-red-600 text-white"
                    onClick={() => {
                      if (dialog.itemId) {
                        safeDeleteProject(dialog.itemId);
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
    </div>
  );
};

export default ProjectsSidebar;


