import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearEdits,
  loadEdits,
  makeEmptyEdits,
  removeDelta,
  saveEdits,
  upsertDelta,
} from "./dashboardEditsStorage";

function createLocalStorageStub(): Storage {
  const values = new Map<string, string>();
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

describe("dashboardEditsStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists dashboard edits through the local fallback cache", async () => {
    const edits = upsertDelta(makeEmptyEdits("dash_1"), "chart_1", {
      title: "Revenue Trend",
    });

    await saveEdits("dash_1", edits);

    expect(await loadEdits("dash_1")).toEqual(edits);
  });

  it("ignores malformed or wrong-dashboard local records", async () => {
    localStorage.setItem(
      "dreamify_dashboard_edits_dash_1",
      JSON.stringify({ dashboardId: "dash_2", version: 1, deltas: {} })
    );

    expect(await loadEdits("dash_1")).toBeNull();

    localStorage.setItem("dreamify_dashboard_edits_dash_1", "{not-json");
    expect(await loadEdits("dash_1")).toBeNull();
  });

  it("deep-merges repeated component deltas and replaces arrays intentionally", () => {
    const first = upsertDelta(makeEmptyEdits("dash_1"), "chart_1", {
      config: { showLegend: true },
      datasets: [{ label: "Revenue" }],
    });
    const second = upsertDelta(first, "chart_1", {
      config: { showGrid: false },
      datasets: [{ label: "Cost" }],
    });

    expect(second.deltas.chart_1.edits).toEqual({
      config: { showLegend: true, showGrid: false },
      datasets: [{ label: "Cost" }],
    });
  });

  it("removes deltas and clears persisted edits", async () => {
    const edits = upsertDelta(makeEmptyEdits("dash_1"), "chart_1", {
      title: "Revenue",
    });

    const removed = removeDelta(edits, "chart_1");
    expect(removed.deltas).toEqual({});

    await saveEdits("dash_1", edits);
    await clearEdits("dash_1");

    expect(await loadEdits("dash_1")).toBeNull();
  });
});
