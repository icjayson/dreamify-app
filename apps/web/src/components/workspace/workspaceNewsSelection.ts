import {
  WORKSPACE_NEWS_ITEMS,
  type WorkspaceNewsItem,
} from "@/components/workspace/workspaceNewsContent";

export const WORKSPACE_NEWS_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const WORKSPACE_NEWS_ROTATION_VERSION = "workspace-news-hobby-demo-2026-08-03";

type WorkspaceNewsItemId = WorkspaceNewsItem["id"];

export interface WorkspaceNewsRotationState {
  version: string;
  lastShownAt: number;
  lastShownId: WorkspaceNewsItemId | null;
  remainingIds: WorkspaceNewsItemId[];
}

interface SelectWorkspaceNewsOptions {
  userId: string;
  items?: readonly WorkspaceNewsItem[];
  storage?: Storage;
  now?: number;
  random?: () => number;
  respectCooldown?: boolean;
}

function getDefaultStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}

export function getWorkspaceNewsLegacyLastShownKey(userId: string): string {
  return `dreamify:workspace:news:last-shown:${userId}`;
}

export function getWorkspaceNewsRotationKey(userId: string): string {
  return `dreamify:workspace:news:rotation:${userId}`;
}

function safeGetItem(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSetItem(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseLegacyLastShownAt(storage: Storage | undefined, userId: string): number {
  const value = Number(safeGetItem(storage, getWorkspaceNewsLegacyLastShownKey(userId)) ?? "0");
  return Number.isFinite(value) ? value : 0;
}

function reconcileIds(ids: unknown, validIds: Set<string>): WorkspaceNewsItemId[] {
  if (!Array.isArray(ids)) return [];

  const seen = new Set<string>();
  return ids.filter((id): id is WorkspaceNewsItemId => {
    if (typeof id !== "string" || !validIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function parseRotationState(
  raw: string | null,
  validIds: Set<string>,
  legacyLastShownAt: number
): WorkspaceNewsRotationState {
  if (!raw) {
    return { version: "", lastShownAt: legacyLastShownAt, lastShownId: null, remainingIds: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceNewsRotationState>;
    const lastShownId = typeof parsed.lastShownId === "string" && validIds.has(parsed.lastShownId)
      ? parsed.lastShownId
      : null;

    return {
      version: typeof parsed.version === "string" ? parsed.version : "",
      lastShownAt: toFiniteNumber(parsed.lastShownAt, legacyLastShownAt),
      lastShownId,
      remainingIds: reconcileIds(parsed.remainingIds, validIds),
    };
  } catch {
    return { version: "", lastShownAt: legacyLastShownAt, lastShownId: null, remainingIds: [] };
  }
}

function shuffleIds(ids: WorkspaceNewsItemId[], random: () => number): WorkspaceNewsItemId[] {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const normalizedRandom = Math.min(Math.max(random(), 0), 0.999999999999999);
    const swapIndex = Math.floor(normalizedRandom * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function avoidImmediateRepeat(
  ids: WorkspaceNewsItemId[],
  lastShownId: WorkspaceNewsItemId | null
): WorkspaceNewsItemId[] {
  if (!lastShownId || ids.length < 2 || ids[0] !== lastShownId) return ids;

  const alternateIndex = ids.findIndex((id) => id !== lastShownId);
  if (alternateIndex <= 0) return ids;

  const adjusted = [...ids];
  [adjusted[0], adjusted[alternateIndex]] = [adjusted[alternateIndex], adjusted[0]];
  return adjusted;
}

function persistRotationState(
  storage: Storage | undefined,
  userId: string,
  state: WorkspaceNewsRotationState
) {
  safeSetItem(storage, getWorkspaceNewsRotationKey(userId), JSON.stringify(state));
  safeSetItem(storage, getWorkspaceNewsLegacyLastShownKey(userId), String(state.lastShownAt));
}

export function selectWorkspaceNewsItem({
  userId,
  items = WORKSPACE_NEWS_ITEMS,
  storage = getDefaultStorage(),
  now = Date.now(),
  random = Math.random,
  respectCooldown = true,
}: SelectWorkspaceNewsOptions): WorkspaceNewsItem | null {
  if (!userId || items.length === 0) return null;

  const validIds = new Set(items.map((item) => item.id));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const rawState = safeGetItem(storage, getWorkspaceNewsRotationKey(userId));
  const legacyLastShownAt = parseLegacyLastShownAt(storage, userId);
  const state = parseRotationState(rawState, validIds, legacyLastShownAt);

  if (respectCooldown && now - state.lastShownAt < WORKSPACE_NEWS_COOLDOWN_MS) {
    return null;
  }

  const allIds = items.map((item) => item.id);
  const queuedIds = state.version === WORKSPACE_NEWS_ROTATION_VERSION ? state.remainingIds : [];
  const nextQueue = queuedIds.length > 0
    ? queuedIds
    : avoidImmediateRepeat(shuffleIds(allIds, random), state.lastShownId);
  const nextId = nextQueue[0];
  const nextItem = itemById.get(nextId);
  if (!nextItem) return null;

  persistRotationState(storage, userId, {
    version: WORKSPACE_NEWS_ROTATION_VERSION,
    lastShownAt: now,
    lastShownId: nextId,
    remainingIds: nextQueue.slice(1),
  });

  return nextItem;
}
