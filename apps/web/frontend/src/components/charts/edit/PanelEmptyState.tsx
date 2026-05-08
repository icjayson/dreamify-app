/**
 * PanelEmptyState — used inside the EditPanel's Style / Data / Structure
 * tabs when there's nothing to render for the currently selected component
 * (e.g. Style for a metric, Structure for a table). Keeps the panel from
 * looking like a broken/blank surface.
 */
import { Sparkles } from 'lucide-react';

interface PanelEmptyStateProps {
  /** Short single-line message explaining why the tab is empty. */
  title: string;
  /** Optional secondary hint pointing the user somewhere useful. */
  hint?: string;
  /** Override the default sparkle icon. Pass any lucide-react icon. */
  icon?: React.ComponentType<{ className?: string }>;
}

const PanelEmptyState: React.FC<PanelEmptyStateProps> = ({ title, hint, icon: Icon = Sparkles }) => {
  return (
    <div className="flex flex-col items-center justify-center text-center px-4 py-10 rounded-md border border-dashed border-muted-foreground/30">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 dark:bg-white/5 mb-3">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground max-w-[260px]">{hint}</p>}
    </div>
  );
};

export default PanelEmptyState;
