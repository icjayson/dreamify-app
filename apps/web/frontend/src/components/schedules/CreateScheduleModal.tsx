import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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

  const showDayPicker = frequency === 'weekly' || frequency === 'biweekly';

  const handleSubmit = async () => {
    setError(null);
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
