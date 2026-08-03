/**
 * Dashboard edits persistence.
 *
 * v1: localStorage-backed. v2 (Phase 7): optionally route through the backend
 * dashboard-save endpoint for unified persistence, behind USE_BACKEND_EDITS.
 * The async signatures already match a fetch boundary so the swap is contained
 * here and useEditMode never changes.
 */
import type { DashboardEdits, ComponentEditDelta } from '@/types/dashboard';
import { deepMerge } from '@/utils/deepMerge';
import { conversationService } from '@/services/conversationService';

const EDITS_VERSION = 1;
const STORAGE_PREFIX = 'dreamify_dashboard_edits_';

/**
 * Phase 7 unified-persistence flag. Default OFF: every call behaves exactly as
 * the v1 localStorage implementation, so no consumer sees a behavior change and
 * the feature ships dark. When flipped ON (in a later task — DO NOT flip here),
 * saves are written through to the backend save endpoint with optimistic
 * concurrency, while localStorage stays as a write-through cache + offline
 * fallback. The flag is read per call so it can later be sourced from config.
 *
 * Migration note: existing local deltas under STORAGE_PREFIX remain valid as
 * the cache when the flag turns on; the first backend save will reconcile them.
 * No destructive migration is performed here.
 */
const USE_BACKEND_EDITS = false;

/**
 * Backend identity needed to address a dashboard. loadEdits/saveEdits/clearEdits
 * only receive a dashboardId (to keep their signatures stable), so the app sets
 * the surrounding conversation/project context here. Only consulted when
 * USE_BACKEND_EDITS is ON; harmless to leave unset while the flag is OFF.
 */
interface BackendEditContext {
  conversationId: string;
  projectId: string;
  /** Last known dashboard version, for optimistic-concurrency (expected_version). */
  expectedVersion?: number;
}

const backendContexts = new Map<string, BackendEditContext>();

/** Register backend identity for a dashboard. No-op effect while the flag is OFF. */
export function setBackendEditContext(dashboardId: string, context: BackendEditContext): void {
  backendContexts.set(dashboardId, context);
}

/** Serialize the in-memory deltas into the shape the backend save endpoint accepts. */
function editsToDashboardData(edits: DashboardEdits): Record<string, unknown> {
  return { dashboard_edits: { version: EDITS_VERSION, deltas: edits.deltas } };
}

const keyFor = (dashboardId: string) => `${STORAGE_PREFIX}${dashboardId}`;

function readLocal(dashboardId: string): DashboardEdits | null {
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

function writeLocal(dashboardId: string, edits: DashboardEdits): void {
  try {
    localStorage.setItem(keyFor(dashboardId), JSON.stringify({ ...edits, version: EDITS_VERSION }));
  } catch {
    /* quota or disabled storage — ignore */
  }
}

function removeLocal(dashboardId: string): void {
  try {
    localStorage.removeItem(keyFor(dashboardId));
  } catch {
    /* ignore */
  }
}

export async function loadEdits(dashboardId: string): Promise<DashboardEdits | null> {
  // Local cache is always consulted first — it is the offline fallback and the
  // optimistic value the UI already showed. Backend mode does not change this:
  // a backend read could be layered later, but reading local keeps load fast
  // and resilient if the network is down.
  return readLocal(dashboardId);
}

export async function saveEdits(dashboardId: string, edits: DashboardEdits): Promise<void> {
  // Optimistic write-through cache — happens in both modes so the UI and an
  // offline reload always see the latest deltas immediately.
  writeLocal(dashboardId, edits);

  if (!USE_BACKEND_EDITS) return;

  const context = backendContexts.get(dashboardId);
  if (!context) return; // no identity yet — local cache already holds the edits

  const result = await conversationService.saveDashboardData(
    context.conversationId,
    dashboardId,
    context.projectId,
    editsToDashboardData(edits),
    { editSummary: 'Manual chart edits', expectedVersion: context.expectedVersion },
  );

  // On a version conflict, refresh our expected_version from the server so the
  // next save can win; the local cache already retains the user's deltas.
  if (!result.success && result.conflict) {
    try {
      const versions = await conversationService.getDashboardVersions(
        context.conversationId,
        dashboardId,
        context.projectId,
      );
      backendContexts.set(dashboardId, { ...context, expectedVersion: versions.current_version });
    } catch {
      /* leave context as-is; local cache still holds the edits */
    }
  } else if (result.success && context.expectedVersion != null) {
    // Bump our optimistic version so the following save targets the new head.
    backendContexts.set(dashboardId, { ...context, expectedVersion: context.expectedVersion + 1 });
  }
}

export async function clearEdits(dashboardId: string): Promise<void> {
  removeLocal(dashboardId);

  if (!USE_BACKEND_EDITS) return;

  const context = backendContexts.get(dashboardId);
  if (!context) return;

  // Clearing edits = persist an empty delta set so the backend head matches.
  await conversationService.saveDashboardData(
    context.conversationId,
    dashboardId,
    context.projectId,
    editsToDashboardData(makeEmptyEdits(dashboardId)),
    { editSummary: 'Cleared manual chart edits', expectedVersion: context.expectedVersion },
  );
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
