import { api } from './api';

export type ProviderKey = 'ga4' | 'meta_ads' | 'tiktok' | 'appsflyer' | 'stripe' | 'warehouse';
export type FrequencyKey = 'daily' | 'weekly' | 'biweekly';
export type DateRangePreset = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d';
export type ScheduleStatus = 'active' | 'paused';
export type SchedulerStatus = 'configured' | 'not_configured' | 'error';
export type RunStatus = 'running' | 'success' | 'failed' | 'token_expired';

export interface SlackAction {
  type: 'slack';
  channel_id: string;
}

export interface ScheduleRecord {
  schedule_id: string;
  user_id: string;
  provider: ProviderKey;
  connector_config: Record<string, unknown>;
  project_id: string;
  account_name: string;
  frequency: FrequencyKey;
  hour_utc: number;
  day_of_week: number;
  date_range_preset: DateRangePreset;
  status: ScheduleStatus;
  eventbridge_rule_name: string;
  scheduler_status?: SchedulerStatus;
  scheduler_error?: string;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
  last_run_status?: RunStatus;
  last_run_rows?: number;
  on_complete_actions?: SlackAction[];
  auto_refresh_conversation_id?: string;
  auto_refresh_prompt?: string;
}

export interface SyncRun {
  schedule_id: string;
  run_id: string;
  user_id: string;
  provider: ProviderKey;
  triggered_at: string;
  completed_at?: string;
  status: RunStatus;
  rows_fetched?: number;
  columns_fetched?: number;
  asset_id?: string;
  error_message?: string;
  date_range_start?: string;
  date_range_end?: string;
  duration_ms?: number;
}

export interface CreateScheduleRequest {
  provider: ProviderKey;
  connector_config: Record<string, unknown>;
  project_id: string;
  account_name?: string;
  frequency: FrequencyKey;
  hour_utc: number;
  day_of_week: number;
  date_range_preset: DateRangePreset;
  on_complete_actions?: SlackAction[];
  auto_refresh_conversation_id?: string;
  auto_refresh_prompt?: string;
}

export interface UpdateScheduleRequest {
  frequency?: FrequencyKey;
  hour_utc?: number;
  day_of_week?: number;
  date_range_preset?: DateRangePreset;
  account_name?: string;
  project_id?: string;
  connector_config?: Record<string, unknown>;
  on_complete_actions?: SlackAction[];
  auto_refresh_conversation_id?: string;
  auto_refresh_prompt?: string;
}

export interface PaginatedSyncRuns {
  items: SyncRun[];
  next_key: string | null;
}

class ScheduleService {
  private baseUrl = '/api/v1/schedules';

  async createSchedule(req: CreateScheduleRequest): Promise<ScheduleRecord> {
    const res = await api.post<ScheduleRecord>(this.baseUrl, req);
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to create schedule');
  }

  async listSchedules(): Promise<ScheduleRecord[]> {
    const res = await api.get<ScheduleRecord[]>(this.baseUrl);
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to list schedules');
  }

  async getSchedule(scheduleId: string): Promise<ScheduleRecord> {
    const res = await api.get<ScheduleRecord>(`${this.baseUrl}/${scheduleId}`);
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Schedule not found');
  }

  async updateSchedule(scheduleId: string, req: UpdateScheduleRequest): Promise<ScheduleRecord> {
    const res = await api.patch<ScheduleRecord>(`${this.baseUrl}/${scheduleId}`, req);
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to update schedule');
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${scheduleId}`);
  }

  async pauseSchedule(scheduleId: string): Promise<ScheduleRecord> {
    const res = await api.post<ScheduleRecord>(`${this.baseUrl}/${scheduleId}/pause`, {});
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to pause schedule');
  }

  async resumeSchedule(scheduleId: string): Promise<ScheduleRecord> {
    const res = await api.post<ScheduleRecord>(`${this.baseUrl}/${scheduleId}/resume`, {});
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to resume schedule');
  }

  async runScheduleNow(scheduleId: string): Promise<{ status: RunStatus | 'skipped' | 'not_found'; run_id?: string; rows?: number; duration_ms?: number; reason?: string }> {
    const res = await api.post<{ status: RunStatus | 'skipped' | 'not_found'; run_id?: string; rows?: number; duration_ms?: number; reason?: string }>(
      `${this.baseUrl}/${scheduleId}/run-now`,
      {}
    );
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to run schedule');
  }

  async getScheduleRuns(scheduleId: string, limit = 20): Promise<SyncRun[]> {
    const res = await api.get<SyncRun[]>(`${this.baseUrl}/${scheduleId}/runs?limit=${limit}`);
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to fetch run history');
  }

  async getAllSyncRuns(limit = 50, nextKey?: string): Promise<PaginatedSyncRuns> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (nextKey) params.set('last_key', nextKey);
    const res = await api.get<PaginatedSyncRuns>(`/api/v1/sync-runs?${params}`);
    if (res.success && res.data) return res.data;
    throw new Error(res.error || 'Failed to fetch sync runs');
  }
}

export const scheduleService = new ScheduleService();
