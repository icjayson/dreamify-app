import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Plus, Trash2, ChevronDown, ChevronUp, AlertCircle, ArrowRight } from 'lucide-react';
import { useScheduleStore } from '@/chat/useScheduleStore';
import { ScheduleRecord, scheduleService } from '@/services/scheduleService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateScheduleModal } from './CreateScheduleModal';
import { SyncRunHistory } from './SyncRunHistory';

const PROVIDER_LABELS: Record<string, string> = {
  ga4: 'Google Analytics 4',
  meta_ads: 'Meta Ads',
  tiktok: 'TikTok Ads',
  appsflyer: 'AppsFlyer',
  stripe: 'Stripe',
};

const FREQ_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
};

const PRESET_LABELS: Record<string, string> = {
  last_7d: 'Last 7 days',
  last_14d: 'Last 14 days',
  last_30d: 'Last 30 days',
  last_90d: 'Last 90 days',
};

function formatRunTime(isoStr?: string): string {
  if (!isoStr) return 'Never';
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

function lastRunBadge(schedule: ScheduleRecord) {
  if (!schedule.last_run_status) return null;
  switch (schedule.last_run_status) {
    case 'success':
      return <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title="Last run succeeded" />;
    case 'token_expired':
      return <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" title="Token expired" />;
    default:
      return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title="Last run failed" />;
  }
}

interface ScheduleCardProps {
  schedule: ScheduleRecord;
  defaultProjectId: string;
}

const ASSET_SOURCE_TYPE: Record<string, string> = {
  integration_ga4: 'GA4',
  integration_meta_ads: 'Meta Ads',
  integration_tiktok: 'TikTok Ads',
  integration_appsflyer: 'AppsFlyer',
  integration_stripe: 'Stripe',
};

function ScheduleCard({ schedule, defaultProjectId }: ScheduleCardProps) {
  const { togglePause, deleteSchedule } = useScheduleStore();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm('Delete this schedule? This cannot be undone.')) return;
    setIsDeleting(true);
    await deleteSchedule(schedule.schedule_id);
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const runs = await scheduleService.getScheduleRuns(schedule.schedule_id, 1);
      const latestRun = runs[0];
      if (!latestRun?.asset_id) return;
      const projectId = schedule.project_id || defaultProjectId;
      navigate(`/project?projectId=${projectId}&analyze=${latestRun.asset_id}`);
    } catch (err) {
      console.error('Failed to fetch run for analyze shortcut', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const scheduleLabel = () => {
    const freq = FREQ_LABELS[schedule.frequency] ?? schedule.frequency;
    const hour = `${String(schedule.hour_utc).padStart(2, '0')}:00 UTC`;
    if (schedule.frequency === 'daily') return `${freq} at ${hour}`;
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][schedule.day_of_week] ?? '';
    return `${freq} on ${dow} at ${hour}`;
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">
              {schedule.account_name || PROVIDER_LABELS[schedule.provider] || schedule.provider}
            </span>
            <Badge variant="secondary" className="text-xs capitalize">
              {PROVIDER_LABELS[schedule.provider] ?? schedule.provider}
            </Badge>
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {scheduleLabel()}
            </span>
            <span>{PRESET_LABELS[schedule.date_range_preset] ?? schedule.date_range_preset}</span>
          </div>

          {schedule.last_run_status && (
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground flex-wrap">
              {lastRunBadge(schedule)}
              <span>Last sync: {formatRunTime(schedule.last_run_at)}</span>
              {schedule.last_run_rows != null && (
                <span>· {schedule.last_run_rows.toLocaleString()} rows</span>
              )}
              {schedule.last_run_status === 'token_expired' && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="w-3 h-3" />
                  Reconnect account
                </span>
              )}
              {schedule.last_run_status === 'success' && (
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="flex items-center gap-1 text-primary hover:text-primary/80 font-medium disabled:opacity-50 transition-colors ml-1"
                  title="Open this data in project chat"
                >
                  {isAnalyzing ? 'Opening…' : 'Analyze'}
                  {!isAnalyzing && <ArrowRight className="w-3 h-3" />}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Switch
            checked={schedule.status === 'active'}
            onCheckedChange={() => togglePause(schedule)}
            title={schedule.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
          />
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
            title="View run history"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-muted-foreground hover:text-destructive"
            title="Delete schedule"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground mb-1">Run History</p>
          <SyncRunHistory scheduleId={schedule.schedule_id} />
        </div>
      )}
    </Card>
  );
}

interface ScheduleManagerProps {
  projectId: string;
}

export function ScheduleManager({ projectId }: ScheduleManagerProps) {
  const { schedules, isLoadingSchedules, schedulesError, fetchSchedules } = useScheduleStore();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground dark:text-white mb-1">Scheduled Syncs</h2>
          <p className="text-sm text-muted-foreground">
            Automatically fetch fresh data from your connectors on a recurring schedule.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Schedule
        </Button>
      </div>

      {isLoadingSchedules ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : schedulesError ? (
        <p className="text-sm text-destructive">{schedulesError}</p>
      ) : schedules.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-lg">
          <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No schedules yet</p>
          <p className="text-xs text-muted-foreground mb-4">
            Set up automatic syncs so your data stays fresh without manual effort.
          </p>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Create your first schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <ScheduleCard key={s.schedule_id} schedule={s} defaultProjectId={projectId} />
          ))}
        </div>
      )}

      <CreateScheduleModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}
