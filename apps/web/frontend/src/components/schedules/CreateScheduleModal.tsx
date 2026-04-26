import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useScheduleStore } from '@/chat/useScheduleStore';
import { CreateScheduleRequest, ProviderKey, FrequencyKey, DateRangePreset } from '@/services/scheduleService';

interface CreateScheduleModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill a provider when opened from a connector card */
  defaultProvider?: ProviderKey;
  /** Connector config pre-filled from the connector context */
  defaultConnectorConfig?: Record<string, unknown>;
  defaultAccountName?: string;
  projectId: string;
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  ga4: 'Google Analytics 4',
  meta_ads: 'Meta Ads',
  tiktok: 'TikTok Ads',
  appsflyer: 'AppsFlyer',
  stripe: 'Stripe',
};

const FREQUENCY_OPTIONS: { value: FrequencyKey; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
];

const DATE_PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_14d', label: 'Last 14 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00 UTC`,
}));

const DOW_OPTIONS = [
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
];

export function CreateScheduleModal({
  open,
  onClose,
  defaultProvider,
  defaultConnectorConfig = {},
  defaultAccountName = '',
  projectId,
}: CreateScheduleModalProps) {
  const { createSchedule } = useScheduleStore();

  const [provider, setProvider] = useState<ProviderKey>(defaultProvider ?? 'ga4');
  const [frequency, setFrequency] = useState<FrequencyKey>('daily');
  const [hourUtc, setHourUtc] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('last_30d');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Slack action
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackChannelId, setSlackChannelId] = useState('');

  // Auto-refresh
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshConvId, setAutoRefreshConvId] = useState('');
  const DEFAULT_AUTO_REFRESH_PROMPT = 'Refresh this dashboard with the latest synced data.';

  const showDayPicker = frequency === 'weekly' || frequency === 'biweekly';

  const handleSubmit = async () => {
    setError(null);
    if (slackEnabled && !slackChannelId.trim()) {
      setError('Please enter a Slack channel ID to enable the Slack action.');
      return;
    }
    if (autoRefreshEnabled && !autoRefreshConvId.trim()) {
      setError('Please enter a conversation ID to enable auto-refresh.');
      return;
    }
    setIsSubmitting(true);
    try {
      const req: CreateScheduleRequest = {
        provider,
        connector_config: defaultConnectorConfig,
        project_id: projectId,
        account_name: defaultAccountName,
        frequency,
        hour_utc: hourUtc,
        day_of_week: dayOfWeek,
        date_range_preset: datePreset,
        on_complete_actions: slackEnabled && slackChannelId.trim()
          ? [{ type: 'slack', channel_id: slackChannelId.trim() }]
          : undefined,
        auto_refresh_conversation_id: autoRefreshEnabled && autoRefreshConvId.trim()
          ? autoRefreshConvId.trim()
          : undefined,
        auto_refresh_prompt: autoRefreshEnabled ? DEFAULT_AUTO_REFRESH_PROMPT : undefined,
      };
      await createSchedule(req);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule Automatic Sync</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider */}
          <div className="space-y-1.5">
            <Label>Connector</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as ProviderKey)} disabled={!!defaultProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Frequency */}
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as FrequencyKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time */}
          <div className="space-y-1.5">
            <Label>Time (UTC)</Label>
            <Select value={String(hourUtc)} onValueChange={(v) => setHourUtc(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Day of week */}
          {showDayPicker && (
            <div className="space-y-1.5">
              <Label>Day of Week</Label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOW_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date range */}
          <div className="space-y-1.5">
            <Label>Data Window</Label>
            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DateRangePreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_PRESET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Each sync will pull this rolling window of data.
            </p>
          </div>

          {/* Slack action */}
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Post to Slack after sync</p>
                <p className="text-xs text-muted-foreground">
                  Automatically analyze data and post a summary to a Slack channel
                </p>
              </div>
              <Switch
                checked={slackEnabled}
                onCheckedChange={setSlackEnabled}
              />
            </div>
            {slackEnabled && (
              <div className="space-y-1.5">
                <Label>Slack Channel ID</Label>
                <Input
                  placeholder="e.g. C1234567890"
                  value={slackChannelId}
                  onChange={(e) => setSlackChannelId(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Find the channel ID in Slack: right-click channel → View channel details → scroll to bottom.
                </p>
              </div>
            )}
          </div>

          {/* Auto-refresh */}
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Auto-refresh dashboard</p>
                <p className="text-xs text-muted-foreground">
                  Re-run analysis on an existing conversation after each sync
                </p>
              </div>
              <Switch
                checked={autoRefreshEnabled}
                onCheckedChange={setAutoRefreshEnabled}
              />
            </div>
            {autoRefreshEnabled && (
              <div className="space-y-1.5">
                <Label>Conversation ID</Label>
                <Input
                  placeholder="Paste conversation UUID"
                  value={autoRefreshConvId}
                  onChange={(e) => setAutoRefreshConvId(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Find this in the project URL or from the Dreamify API.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
