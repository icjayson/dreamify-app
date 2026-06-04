import { describe, expect, it, vi } from "vitest";

import { WORKSPACE_NEWS_ITEMS } from "@/components/workspace/workspaceNewsContent";
import {
  getWorkspaceNewsLegacyLastShownKey,
  getWorkspaceNewsRotationKey,
  selectWorkspaceNewsItem,
  WORKSPACE_NEWS_COOLDOWN_MS,
  WORKSPACE_NEWS_ROTATION_VERSION,
} from "@/components/workspace/workspaceNewsSelection";

function createLocalStorageStub(initialValues: Record<string, string> = {}): Storage {
  const values = new Map<string, string>(Object.entries(initialValues));

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("selectWorkspaceNewsItem", () => {
  const userId = "user_123";
  const baseNow = WORKSPACE_NEWS_COOLDOWN_MS * 10;

  it("prevents showing during cooldown without mutating the rotation queue", () => {
    const rotationKey = getWorkspaceNewsRotationKey(userId);
    const initialState = JSON.stringify({
      version: WORKSPACE_NEWS_ROTATION_VERSION,
      lastShownAt: baseNow,
      lastShownId: "data-connectors",
      remainingIds: ["templates", "dashboard-shared-link"],
    });
    const storage = createLocalStorageStub({ [rotationKey]: initialState });

    const selected = selectWorkspaceNewsItem({
      userId,
      storage,
      now: baseNow + WORKSPACE_NEWS_COOLDOWN_MS - 1,
      random: () => 0.99,
    });

    expect(selected).toBeNull();
    expect(storage.getItem(rotationKey)).toBe(initialState);
  });

  it("selects every workspace news item once before any item repeats", () => {
    const storage = createLocalStorageStub();
    const selectedIds: string[] = [];

    for (let index = 0; index < WORKSPACE_NEWS_ITEMS.length; index += 1) {
      const selected = selectWorkspaceNewsItem({
        userId,
        storage,
        now: baseNow + index * (WORKSPACE_NEWS_COOLDOWN_MS + 1),
        random: () => 0.99,
      });

      expect(selected).not.toBeNull();
      selectedIds.push(selected!.id);
    }

    expect(new Set(selectedIds).size).toBe(WORKSPACE_NEWS_ITEMS.length);
  });

  it("avoids repeating the prior item when a new rotation cycle starts", () => {
    const rotationKey = getWorkspaceNewsRotationKey(userId);
    const storage = createLocalStorageStub({
      [rotationKey]: JSON.stringify({
        version: WORKSPACE_NEWS_ROTATION_VERSION,
        lastShownAt: baseNow - WORKSPACE_NEWS_COOLDOWN_MS - 1,
        lastShownId: "schedule-syncs",
        remainingIds: ["multi-file-analyze"],
      }),
    });

    const lastInCycle = selectWorkspaceNewsItem({
      userId,
      storage,
      now: baseNow,
      random: () => 0.99,
    });
    const firstInNextCycle = selectWorkspaceNewsItem({
      userId,
      storage,
      now: baseNow + WORKSPACE_NEWS_COOLDOWN_MS + 1,
      random: () => 0.99,
    });

    expect(lastInCycle?.id).toBe("multi-file-analyze");
    expect(firstInNextCycle?.id).not.toBe(lastInCycle?.id);
  });

  it("recovers from malformed rotation storage", () => {
    const rotationKey = getWorkspaceNewsRotationKey(userId);
    const storage = createLocalStorageStub({ [rotationKey]: "{not-json" });

    const selected = selectWorkspaceNewsItem({
      userId,
      storage,
      now: baseNow,
      random: () => 0.99,
    });
    const nextState = JSON.parse(storage.getItem(rotationKey) ?? "{}");

    expect(selected?.id).toBe("multi-file-analyze");
    expect(nextState.version).toBe(WORKSPACE_NEWS_ROTATION_VERSION);
    expect(nextState.lastShownId).toBe("multi-file-analyze");
  });

  it("resets stale-version queues against the current news content", () => {
    const rotationKey = getWorkspaceNewsRotationKey(userId);
    const storage = createLocalStorageStub({
      [rotationKey]: JSON.stringify({
        version: "workspace-news-old",
        lastShownAt: baseNow - WORKSPACE_NEWS_COOLDOWN_MS - 1,
        lastShownId: "dashboard-shared-link",
        remainingIds: ["schedule-syncs"],
      }),
    });

    const selected = selectWorkspaceNewsItem({
      userId,
      storage,
      now: baseNow,
      random: () => 0.99,
    });

    expect(selected?.id).toBe("multi-file-analyze");
  });

  it("respects the legacy last-shown timestamp during first migration", () => {
    const rotationKey = getWorkspaceNewsRotationKey(userId);
    const legacyKey = getWorkspaceNewsLegacyLastShownKey(userId);
    const storage = createLocalStorageStub({
      [legacyKey]: String(baseNow),
    });

    const selected = selectWorkspaceNewsItem({
      userId,
      storage,
      now: baseNow + WORKSPACE_NEWS_COOLDOWN_MS - 1,
      random: () => 0.99,
    });

    expect(selected).toBeNull();
    expect(storage.getItem(rotationKey)).toBeNull();
  });

  it("handles a single-item rotation", () => {
    const storage = createLocalStorageStub();
    const oneItem = WORKSPACE_NEWS_ITEMS.slice(0, 1);

    const first = selectWorkspaceNewsItem({
      userId,
      items: oneItem,
      storage,
      now: baseNow,
      random: () => 0.99,
    });
    const second = selectWorkspaceNewsItem({
      userId,
      items: oneItem,
      storage,
      now: baseNow + WORKSPACE_NEWS_COOLDOWN_MS + 1,
      random: () => 0.99,
    });

    expect(first?.id).toBe(oneItem[0].id);
    expect(second?.id).toBe(oneItem[0].id);
  });
});
