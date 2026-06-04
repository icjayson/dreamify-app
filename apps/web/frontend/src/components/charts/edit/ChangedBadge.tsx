import { Sparkles } from 'lucide-react';
import { useChatStore } from '@/chat/useChatStore';

interface ChangedBadgeProps {
  componentId: string;
  /**
   * Optional alternate id. `changedComponentIds` may hold either the cell id
   * (`component.id`) or the config id (`component_config.id`); pass both so the
   * badge lights up regardless of which form the store recorded.
   */
  altComponentId?: string;
  /**
   * Phase 7: when provided, the badge becomes a button that opens the version
   * history / diff view for this card. When absent it stays presentational.
   */
  onOpenHistory?: () => void;
}

/**
 * Transient "Updated" badge shown on a card right after a chart edit lands.
 * Visibility is driven by the same `changedComponentIds` mechanism that powers
 * the `dashboard-component-highlight` pulse in DashboardPreview, so it fades on
 * the same short window. When `onOpenHistory` is provided it becomes clickable
 * and opens the Phase 7 version history / diff view.
 */
export const ChangedBadge = ({ componentId, altComponentId, onOpenHistory }: ChangedBadgeProps) => {
  const isChanged = useChatStore(
    (s) =>
      s.changedComponentIds.has(componentId) ||
      (altComponentId != null && s.changedComponentIds.has(altComponentId)),
  );

  if (!isChanged) return null;

  const className =
    'absolute right-2 bottom-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium';
  const style = {
    backgroundColor: 'var(--highlight-color)',
    color: 'var(--bg-card-color)',
    opacity: 0.85,
  } as const;

  if (onOpenHistory) {
    return (
      <button
        type="button"
        className={`${className} cursor-pointer transition-opacity hover:opacity-100`}
        data-export-exclude
        data-edit-control="changed-badge"
        aria-label="View what changed"
        style={style}
        onClick={(e) => {
          e.stopPropagation();
          onOpenHistory();
        }}
      >
        <Sparkles className="w-3 h-3" />
        <span>Updated</span>
      </button>
    );
  }

  return (
    <div
      className={`${className} pointer-events-none`}
      data-export-exclude
      style={style}
    >
      <Sparkles className="w-3 h-3" />
      <span>Updated</span>
    </div>
  );
};
