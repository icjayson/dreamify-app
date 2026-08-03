/**
 * useVersionHistory — Phase 7 dashboard version history + revert.
 *
 * Given a conversation/project/dashboard, exposes the version list plus
 * helpers to fetch a single snapshot and to revert to a target version. Kept on
 * local state + the service (rather than React Query) so it stays hermetic and
 * easy to test in isolation; the underlying service is resilient to 404/409.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  conversationService,
  type DashboardVersionEntry,
  type DashboardDataResponse,
  type DashboardRevertResponse,
} from '@/services/conversationService';

interface UseVersionHistoryParams {
  conversationId?: string | null;
  projectId?: string | null;
  dashboardId?: string | null;
  /** Called after a successful revert so the parent can re-fetch the dashboard. */
  onReverted?: (result: DashboardRevertResponse) => void;
}

interface UseVersionHistoryResult {
  versions: DashboardVersionEntry[];
  currentVersion: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getVersion: (version: number) => Promise<DashboardDataResponse | null>;
  revert: (targetVersion: number) => Promise<DashboardRevertResponse | null>;
}

function isReady(
  conversationId?: string | null,
  projectId?: string | null,
  dashboardId?: string | null,
): conversationId is string {
  return !!conversationId && !!projectId && !!dashboardId;
}

export function useVersionHistory({
  conversationId,
  projectId,
  dashboardId,
  onReverted,
}: UseVersionHistoryParams): UseVersionHistoryResult {
  const [versions, setVersions] = useState<DashboardVersionEntry[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isReady(conversationId, projectId, dashboardId)) return;
    setLoading(true);
    setError(null);
    try {
      const data = await conversationService.getDashboardVersions(
        conversationId,
        dashboardId as string,
        projectId as string,
      );
      setVersions(data.versions ?? []);
      setCurrentVersion(data.current_version ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions');
      setVersions([]);
      setCurrentVersion(null);
    } finally {
      setLoading(false);
    }
  }, [conversationId, projectId, dashboardId]);

  const getVersion = useCallback(
    async (version: number): Promise<DashboardDataResponse | null> => {
      if (!isReady(conversationId, projectId, dashboardId)) return null;
      try {
        return await conversationService.getDashboardVersion(
          conversationId,
          dashboardId as string,
          projectId as string,
          version,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load version');
        return null;
      }
    },
    [conversationId, projectId, dashboardId],
  );

  const revert = useCallback(
    async (targetVersion: number): Promise<DashboardRevertResponse | null> => {
      if (!isReady(conversationId, projectId, dashboardId)) return null;
      setError(null);
      try {
        const result = await conversationService.revertDashboard(
          conversationId,
          dashboardId as string,
          projectId as string,
          targetVersion,
        );
        await refresh();
        onReverted?.(result);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revert');
        return null;
      }
    },
    [conversationId, projectId, dashboardId, refresh, onReverted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { versions, currentVersion, loading, error, refresh, getVersion, revert };
}
