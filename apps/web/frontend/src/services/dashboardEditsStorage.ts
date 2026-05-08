/**
 * Dashboard edits persistence.
 *
 * v1: localStorage-backed. v2: swap implementations for a backend PATCH.
 * The async signatures already match a fetch boundary so the swap is contained here.
 */
import type { DashboardEdits, ComponentEditDelta } from '@/types/dashboard';
import { deepMerge } from '@/utils/deepMerge';

const EDITS_VERSION = 1;
const STORAGE_PREFIX = 'dreamify_dashboard_edits_';

const keyFor = (dashboardId: string) => `${STORAGE_PREFIX}${dashboardId}`;

export async function loadEdits(dashboardId: string): Promise<DashboardEdits | null> {
  try {
    const raw = localStorage.getItem(keyFor(dashboardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardEdits;
    if (!parsed || parsed.version !== EDITS_VERSION || parsed.dashboardId !== dashboardId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveEdits(dashboardId: string, edits: DashboardEdits): Promise<void> {
  try {
    localStorage.setItem(keyFor(dashboardId), JSON.stringify({ ...edits, version: EDITS_VERSION }));
  } catch {
    /* quota or disabled storage — ignore */
  }
}

export async function clearEdits(dashboardId: string): Promise<void> {
  try {
    localStorage.removeItem(keyFor(dashboardId));
  } catch {
    /* ignore */
  }
}

export function makeEmptyEdits(dashboardId: string): DashboardEdits {
  return { dashboardId, deltas: {}, version: EDITS_VERSION };
}

export function upsertDelta(
  edits: DashboardEdits,
  componentId: string,
  patch: Record<string, unknown>
): DashboardEdits {
  const prev: ComponentEditDelta | undefined = edits.deltas[componentId];
  // Deep-merge so a later patch can't type-flip an earlier one (e.g.
  // `{ data: [...] }` clobbered by a stray `{ data: { '2': {...} } }` from a
  // setAtPath emit). Arrays are still replaced wholesale by deepMerge —
  // intentional, matches how component_config consumes them.
  const merged: ComponentEditDelta = {
    componentId,
    edits: deepMerge(prev?.edits || {}, patch),
    editedAt: Date.now(),
  };
  return { ...edits, deltas: { ...edits.deltas, [componentId]: merged } };
}

export function removeDelta(edits: DashboardEdits, componentId: string): DashboardEdits {
  if (!edits.deltas[componentId]) return edits;
  const next = { ...edits.deltas };
  delete next[componentId];
  return { ...edits, deltas: next };
}
