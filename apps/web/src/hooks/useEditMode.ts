/**
 * useEditMode — Zustand store for the manual-edit feature.
 *
 * - Holds editMode toggle, currently-selected component, currently-editing field.
 * - Holds the per-dashboard edit deltas in memory and persists to localStorage
 *   via dashboardEditsStorage. The same async boundary will be swapped for a
 *   backend PATCH in v2 without touching consumers.
 */
import { create } from 'zustand';
import { deepMerge } from '@/utils/deepMerge';
import {
  loadEdits,
  saveEdits,
  clearEdits,
  makeEmptyEdits,
  upsertDelta,
  removeDelta,
} from '@/services/dashboardEditsStorage';
import type { DashboardEdits, DashboardComponent } from '@/types/dashboard';

interface EditModeState {
  editMode: boolean;
  activeDashboardId: string | null;
  selectedComponentId: string | null;
  selectedField: string | null;
  edits: DashboardEdits | null;
  isDirty: boolean;

  setEditMode: (on: boolean) => void;
  toggleEditMode: () => void;
  setSelectedComponent: (id: string | null) => void;
  setSelectedField: (field: string | null) => void;

  hydrate: (dashboardId: string) => Promise<void>;
  applyFieldEdit: (componentId: string, patch: Record<string, unknown>) => void;
  revertComponent: (componentId: string) => void;
  resetAllEdits: () => void;
  markSaved: () => void;

  /** Returns true if the component has any edit delta. */
  isEdited: (componentId: string) => boolean;
}

export const useEditMode = create<EditModeState>((set, get) => ({
  editMode: false,
  activeDashboardId: null,
  selectedComponentId: null,
  selectedField: null,
  edits: null,
  isDirty: false,

  setEditMode: (on) => set({ editMode: on, selectedComponentId: on ? get().selectedComponentId : null, selectedField: null }),
  toggleEditMode: () => {
    const next = !get().editMode;
    set({ editMode: next, selectedComponentId: next ? get().selectedComponentId : null, selectedField: null });
  },
  setSelectedComponent: (id) => set({ selectedComponentId: id }),
  setSelectedField: (field) => set({ selectedField: field }),

  hydrate: async (dashboardId) => {
    if (get().activeDashboardId === dashboardId && get().edits) return;
    const loaded = await loadEdits(dashboardId);
    set({
      activeDashboardId: dashboardId,
      edits: loaded || makeEmptyEdits(dashboardId),
    });
  },

  applyFieldEdit: (componentId, patch) => {
    const { edits, activeDashboardId } = get();
    if (!edits || !activeDashboardId) return;
    const next = upsertDelta(edits, componentId, patch);
    set({ edits: next, isDirty: true });
    void saveEdits(activeDashboardId, next);
  },

  revertComponent: (componentId) => {
    const { edits, activeDashboardId } = get();
    if (!edits || !activeDashboardId) return;
    const next = removeDelta(edits, componentId);
    const stillDirty = Object.keys(next.deltas).length > 0;
    set({ edits: next, isDirty: stillDirty });
    void saveEdits(activeDashboardId, next);
  },

  resetAllEdits: () => {
    const { activeDashboardId } = get();
    if (!activeDashboardId) return;
    const empty = makeEmptyEdits(activeDashboardId);
    set({ edits: empty, isDirty: false });
    void clearEdits(activeDashboardId);
  },

  markSaved: () => {
    const { activeDashboardId } = get();
    if (!activeDashboardId) return;
    const empty = makeEmptyEdits(activeDashboardId);
    // Stay in edit mode after save — user keeps editing without re-clicking Edit.
    set({ edits: empty, isDirty: false });
    void clearEdits(activeDashboardId);
  },

  isEdited: (componentId) => {
    const e = get().edits;
    return !!(e && e.deltas[componentId]);
  },
}));

/**
 * Apply current edits to the components array. Pure function, safe to call in render.
 */
export function applyEditsToComponents(
  components: DashboardComponent[],
  edits: DashboardEdits | null
): DashboardComponent[] {
  if (!edits || Object.keys(edits.deltas).length === 0) return components;
  return components.map((comp) => {
    const delta = edits.deltas[String(comp.id)];
    if (!delta) return comp;
    return {
      ...comp,
      component_config: deepMerge(comp.component_config as Record<string, unknown>, delta.edits),
    };
  });
}
