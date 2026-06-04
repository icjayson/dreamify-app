/**
 * VersionHistoryDialog — Phase 7 version history + before/after diff + revert.
 *
 * Lists a dashboard's versions (version #, source, created_at, edit_summary)
 * with a per-version "Revert" and "View diff" affordance. The diff compares the
 * matching chart config from the selected older version (Before) against the
 * current component config (After) via ChartDiffView.
 *
 * Additive + flag-free: it only renders meaningful content when the backend
 * returns versions; when none are present it shows an empty state. Scoped to one
 * component when `component` is provided (the card it was opened from).
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, History, Loader2, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChartDiffView } from '@/components/charts/edit/ChartDiffView';
import { useVersionHistory } from '@/hooks/useVersionHistory';
import { getComponentKey } from '@/utils/componentKey';
import type { DashboardComponent } from '@/types/dashboard';
import type {
  DashboardVersionEntry,
  DashboardRevertResponse,
} from '@/services/conversationService';

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string | null;
  projectId?: string | null;
  dashboardId?: string | null;
  /**
   * The component the dialog was opened for. Its current config is the "After"
   * side of any diff; the matching config in an older snapshot is "Before".
   */
  component?: DashboardComponent | null;
  /** Called after a successful revert so the parent can re-fetch the dashboard. */
  onReverted?: (result: DashboardRevertResponse) => void;
}

type ChartConfigLike = Record<string, unknown>;

/** Pull a components array out of a heterogeneous snapshot payload. */
function extractComponents(data: Record<string, unknown> | null | undefined): DashboardComponent[] {
  if (!data) return [];
  if (Array.isArray((data as { components?: unknown }).components)) {
    return (data as { components: DashboardComponent[] }).components;
  }
  const nested = (data as { dashboard_config?: { components?: unknown } }).dashboard_config;
  if (nested && Array.isArray(nested.components)) {
    return nested.components as DashboardComponent[];
  }
  return [];
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export const VersionHistoryDialog = ({
  open,
  onOpenChange,
  conversationId,
  projectId,
  dashboardId,
  component,
  onReverted,
}: VersionHistoryDialogProps) => {
  const { versions, currentVersion, loading, error, getVersion, revert } = useVersionHistory({
    conversationId,
    projectId,
    dashboardId,
    onReverted,
  });

  const [diffEntry, setDiffEntry] = useState<DashboardVersionEntry | null>(null);
  const [diffBefore, setDiffBefore] = useState<ChartConfigLike | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);

  const componentKey = component ? getComponentKey(component) : null;
  const afterConfig = useMemo(
    () => (component?.component_config as ChartConfigLike | undefined) ?? null,
    [component],
  );

  const handleViewDiff = async (entry: DashboardVersionEntry) => {
    if (!component || !componentKey) return;
    setDiffLoading(true);
    setDiffEntry(entry);
    const snapshot = await getVersion(entry.version);
    const components = extractComponents(snapshot?.dashboard_data);
    const match = components.find((candidate) => getComponentKey(candidate) === componentKey);
    setDiffBefore((match?.component_config as ChartConfigLike | undefined) ?? null);
    setDiffLoading(false);
  };

  const handleRevert = async (entry: DashboardVersionEntry) => {
    setRevertingVersion(entry.version);
    const result = await revert(entry.version);
    setRevertingVersion(null);
    if (result) {
      onOpenChange(false);
    }
  };

  const closeDiff = () => {
    setDiffEntry(null);
    setDiffBefore(null);
  };

  const showDiff = diffEntry != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {showDiff ? `Changes since version ${diffEntry?.version}` : 'Version history'}
          </DialogTitle>
          <DialogDescription>
            {showDiff
              ? 'Comparing this chart against the selected older version.'
              : 'Review past versions and revert to any of them.'}
          </DialogDescription>
        </DialogHeader>

        {showDiff ? (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" className="gap-2" onClick={closeDiff}>
              <ArrowLeft className="h-4 w-4" />
              Back to history
            </Button>
            {diffLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : afterConfig && diffBefore ? (
              <ChartDiffView before={diffBefore} after={afterConfig} />
            ) : (
              <p className="text-sm text-muted-foreground">
                This chart was not present in the selected version.
              </p>
            )}
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {!loading && error && <p className="py-6 text-sm text-destructive">{error}</p>}
            {!loading && !error && versions.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">No version history yet.</p>
            )}
            {!loading &&
              !error &&
              versions.map((entry) => {
                const isCurrent = entry.version === currentVersion;
                return (
                  <div
                    key={entry.version}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>Version {entry.version}</span>
                        {isCurrent && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            Current
                          </span>
                        )}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {entry.source}
                        </span>
                      </div>
                      {entry.edit_summary && (
                        <p className="truncate text-sm text-muted-foreground">{entry.edit_summary}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{formatTimestamp(entry.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {component && !isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleViewDiff(entry)}
                        >
                          View diff
                        </Button>
                      )}
                      {!isCurrent && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={revertingVersion != null}
                          onClick={() => void handleRevert(entry)}
                        >
                          {revertingVersion === entry.version ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Revert
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
