import { api } from './api';

export interface Notification {
  notification_id: string;
  type: 'sync_success' | 'sync_failed' | 'token_expired';
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  schedule_id?: string;
  run_id?: string;
  provider?: string;
  asset_id?: string;
  project_id?: string;
}

export interface NotificationsListResponse {
  notifications: Notification[];
  unread_count: number;
}

class NotificationService {
  private baseUrl = '/api/v1/notifications';

  async listNotifications(unreadOnly = false, limit = 20): Promise<NotificationsListResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (unreadOnly) params.set('unread_only', 'true');
    const res = await api.get<NotificationsListResponse>(`${this.baseUrl}?${params}`);
    if (res.success && res.data) return res.data;
    return { notifications: [], unread_count: 0 };
  }

  async markRead(notificationIds?: string[]): Promise<void> {
    await api.post(`${this.baseUrl}/mark-read`, {
      notification_ids: notificationIds ?? null,
    });
  }
}

export const notificationService = new NotificationService();
