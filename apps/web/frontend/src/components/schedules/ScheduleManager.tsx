import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Plus, Trash2, ChevronDown, ChevronUp, AlertCircle, ArrowRight, PlayCircle } from 'lucide-react';
import { useScheduleStore } from '@/chat/useScheduleStore';
import { ScheduleRecord, scheduleService } from '@/services/scheduleService';
import type { ConnectorOverviewItem } from '@/services/integrationService';
import type { Project } from '@/hooks/useProjects';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateScheduleModal } from './CreateScheduleModal';
import { SyncRunHistory } from './SyncRunHistory';
import { useToast } from '@/hooks/use-toast';

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
  isRunning: boolean;
  onRunNow: (schedule: ScheduleRecord) => Promise<void>;
}

function schedulerStatusLabel(schedule: ScheduleRecord) {
  if (schedule.scheduler_status === 'configured') return null;
  if (schedule.scheduler_status === 'error') {
    return <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-0 text-xs">Scheduler Error</Badge>;
  }
  return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0 text-xs">Not Configured</Badge>;
}

function ScheduleCard({ schedule, defaultProjectId, isRunning, onRunNow }: ScheduleCardProps) {
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
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {schedulerStatusLabel(schedule)}
            {schedule.scheduler_error && (
              <span className="text-xs text-muted-foreground truncate max-w-[420px]" title={schedule.scheduler_error}>
                {schedule.scheduler_error}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onRunNow(schedule)}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
            title="Run this schedule now"
          >
            <PlayCircle className={`w-3.5 h-3.5 ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? 'Running' : 'Run now'}
          </button>
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
  connectorOverview?: ConnectorOverviewItem[];
  projects?: Project[];
}

export function ScheduleManager({ projectId, connectorOverview = [], projects = [] }: ScheduleManagerProps) {
  const { schedules, isLoadingSchedules, schedulesError, fetchSchedules, runScheduleNow } = useScheduleStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const handleRunNow = async (schedule: ScheduleRecord) => {
    setRunningScheduleId(schedule.schedule_id);
    try {
      await runScheduleNow(schedule.schedule_id);
      toast({
        title: 'Schedule run started',
        description: `${schedule.account_name || PROVIDER_LABELS[schedule.provider] || 'Schedule'} was triggered successfully.`,
      });
    } catch (error) {
      toast({
        title: 'Run failed',
        description: error instanceof Error ? error.message : 'Could not run this schedule.',
        variant: 'destructive',
      });
    } finally {
      setRunningScheduleId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm ring-1 ring-foreground/5">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground dark:text-white">Scheduled Syncs</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Automatically fetch fresh data from your connectors on a recurring schedule.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              <Clock className="h-3.5 w-3.5" />
              {schedules.length} schedule{schedules.length !== 1 ? 's' : ''}
            </span>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Schedule
            </Button>
          </div>
        </div>
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
            <ScheduleCard
              key={s.schedule_id}
              schedule={s}
              defaultProjectId={projectId}
              isRunning={runningScheduleId === s.schedule_id}
              onRunNow={handleRunNow}
            />
          ))}
        </div>
      )}

      <CreateScheduleModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        connectorOverview={connectorOverview}
        projects={projects}
      />
    </div>
  );
}
