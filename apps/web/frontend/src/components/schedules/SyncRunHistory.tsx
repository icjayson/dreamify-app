import { useEffect } from 'react';
import { useScheduleStore } from '@/chat/useScheduleStore';
import { SyncRun } from '@/services/scheduleService';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface SyncRunHistoryProps {
  scheduleId: string;
}

function runStatusBadge(status: SyncRun['status']) {
  switch (status) {
    case 'success':
      return <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-0 text-xs">Success</Badge>;
    case 'running':
      return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-0 text-xs">Running</Badge>;
    case 'token_expired':
      return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-0 text-xs">Token Expired</Badge>;
    default:
      return <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-0 text-xs">Failed</Badge>;
  }
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function SyncRunHistory({ scheduleId }: SyncRunHistoryProps) {
  const { selectedScheduleRuns, isLoadingRuns, fetchScheduleRuns } = useScheduleStore();

  useEffect(() => {
    fetchScheduleRuns(scheduleId);
  }, [scheduleId, fetchScheduleRuns]);

  if (isLoadingRuns) {
    return (
      <div className="space-y-2 mt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded" />
        ))}
      </div>
    );
  }

  if (selectedScheduleRuns.length === 0) {
    return <p className="text-xs text-muted-foreground mt-2">No runs yet.</p>;
  }

  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left pb-2 font-medium">Triggered</th>
            <th className="text-left pb-2 font-medium">Status</th>
            <th className="text-right pb-2 font-medium">Rows</th>
            <th className="text-right pb-2 font-medium">Duration</th>
            <th className="text-left pb-2 font-medium pl-4">Date Range</th>
          </tr>
        </thead>
        <tbody>
          {selectedScheduleRuns.map((run) => (
            <tr key={run.run_id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-2">{fmtDate(run.triggered_at)}</td>
              <td className="py-2">{runStatusBadge(run.status)}</td>
              <td className="py-2 text-right">{run.rows_fetched ?? '—'}</td>
              <td className="py-2 text-right">
                {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
              </td>
              <td className="py-2 pl-4 text-muted-foreground">
                {run.date_range_start && run.date_range_end
                  ? `${run.date_range_start} → ${run.date_range_end}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
