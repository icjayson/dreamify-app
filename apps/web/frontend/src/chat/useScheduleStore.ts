import { create } from 'zustand';
import {
  scheduleService,
  ScheduleRecord,
  SyncRun,
  CreateScheduleRequest,
  UpdateScheduleRequest,
} from '@/services/scheduleService';

interface ScheduleState {
  schedules: ScheduleRecord[];
  isLoadingSchedules: boolean;
  schedulesError: string | null;

  selectedScheduleRuns: SyncRun[];
  isLoadingRuns: boolean;

  // Actions
  fetchSchedules: () => Promise<void>;
  createSchedule: (req: CreateScheduleRequest) => Promise<ScheduleRecord>;
  updateSchedule: (scheduleId: string, req: UpdateScheduleRequest) => Promise<void>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
  togglePause: (schedule: ScheduleRecord) => Promise<void>;
  fetchScheduleRuns: (scheduleId: string) => Promise<void>;
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  schedules: [],
  isLoadingSchedules: false,
  schedulesError: null,
  selectedScheduleRuns: [],
  isLoadingRuns: false,

  fetchSchedules: async () => {
    set({ isLoadingSchedules: true, schedulesError: null });
    try {
      const schedules = await scheduleService.listSchedules();
      set({ schedules, isLoadingSchedules: false });
    } catch (err) {
      set({
        isLoadingSchedules: false,
        schedulesError: err instanceof Error ? err.message : 'Failed to load schedules',
      });
    }
  },

  createSchedule: async (req) => {
    const created = await scheduleService.createSchedule(req);
    set((state) => ({ schedules: [created, ...state.schedules] }));
    return created;
  },

  updateSchedule: async (scheduleId, req) => {
    const updated = await scheduleService.updateSchedule(scheduleId, req);
    set((state) => ({
      schedules: state.schedules.map((s) =>
        s.schedule_id === scheduleId ? updated : s
      ),
    }));
  },

  deleteSchedule: async (scheduleId) => {
    await scheduleService.deleteSchedule(scheduleId);
    set((state) => ({
      schedules: state.schedules.filter((s) => s.schedule_id !== scheduleId),
    }));
  },

  togglePause: async (schedule) => {
    const updated =
      schedule.status === 'active'
        ? await scheduleService.pauseSchedule(schedule.schedule_id)
        : await scheduleService.resumeSchedule(schedule.schedule_id);
    set((state) => ({
      schedules: state.schedules.map((s) =>
        s.schedule_id === schedule.schedule_id ? updated : s
      ),
    }));
  },

  fetchScheduleRuns: async (scheduleId) => {
    set({ isLoadingRuns: true });
    try {
      const runs = await scheduleService.getScheduleRuns(scheduleId);
      set({ selectedScheduleRuns: runs, isLoadingRuns: false });
    } catch {
      set({ isLoadingRuns: false });
    }
  },
}));
