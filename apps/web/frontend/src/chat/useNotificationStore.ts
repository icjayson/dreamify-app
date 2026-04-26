import { create } from 'zustand';
import { Notification, notificationService } from '@/services/notificationService';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  _intervalId: ReturnType<typeof setInterval> | null;

  fetchNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  _intervalId: null,

  fetchNotifications: async () => {
    set({ isLoading: true });
    try {
      const res = await notificationService.listNotifications(false, 20);
      set({
        notifications: res.notifications,
        unreadCount: res.unread_count,
      });
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    } finally {
      set({ isLoading: false });
    }
  },

  markRead: async (notificationId: string) => {
    await notificationService.markRead([notificationId]);
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.notification_id === notificationId ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllRead: async () => {
    await notificationService.markRead();
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  startPolling: () => {
    const { _intervalId, fetchNotifications } = get();
    if (_intervalId) return; // already polling
    fetchNotifications();
    const id = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    set({ _intervalId: id });
  },

  stopPolling: () => {
    const { _intervalId } = get();
    if (_intervalId) {
      clearInterval(_intervalId);
      set({ _intervalId: null });
    }
  },
}));
