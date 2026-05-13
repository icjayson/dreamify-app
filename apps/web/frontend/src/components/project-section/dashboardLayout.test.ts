import { describe, expect, it } from "vitest";
import type { Layout, Layouts } from "react-grid-layout";
import {
  clampLayoutItem,
  computeStorageKey,
  getMinSizeForType,
  mergeLayoutIntoComponents,
  sanitizeBreakpoint,
  sanitizeLayouts,
  shouldFillSparse,
  buildMinSizeMap,
  type ComponentLike,
} from "./dashboardLayout";

/**
 * These tests guard the three failure modes that keep re-introducing the
 * "stretched chart in a corner" bug:
 *
 * 1. localStorage stores a layout from a previous dashboard, and orphan grid
 *    items leak into a new dashboard.
 * 2. A saved item has h < minH (the "stretched vertical strip" 30px sliver).
 * 3. Two distinct dashboards collapse onto the same storageKey and share state.
 *
 * If any of these fire again, one of the tests below should fail first — so
 * the regression is caught in CI, not in a user screenshot.
 */

const emptyLayouts: Layouts = { lg: [], md: [], sm: [], xs: [], xxs: [] };

function mkLayout(partial: Partial<Layout> & Pick<Layout, "i">): Layout {
  return { x: 0, y: 0, w: 4, h: 8, ...partial };
}

describe("getMinSizeForType", () => {
  it("returns chart defaults for unknown types", () => {
    expect(getMinSizeForType("chart")).toEqual({ minW: 4, minH: 8 });
    expect(getMinSizeForType("scatter")).toEqual({ minW: 4, minH: 8 });
  });

  it("returns metric mins", () => {
    expect(getMinSizeForType("metric")).toEqual({ minW: 2, minH: 2 });
  });

  it("returns table mins", () => {
    expect(getMinSizeForType("table")).toEqual({ minW: 12, minH: 8 });
  });
});

describe("computeStorageKey", () => {
  it("uses the real dashboard id when present", () => {
    expect(computeStorageKey("abc-123", [], "proj-1")).toBe(
      "dashboard_layout_abc-123_v5",
    );
  });

  it("does not include projectId when id is present (real id is already globally unique)", () => {
    const a = computeStorageKey("abc-123", [], "proj-1");
    const b = computeStorageKey("abc-123", [], "proj-2");
    expect(a).toBe(b);
  });

  it("hashes the component-id set when id is missing — two dashboards with different components must NOT collide", () => {
    const six: ComponentLike[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      type: "chart",
    }));
    const one: ComponentLike[] = [{ id: "c0", type: "chart" }];
    const k6 = computeStorageKey(undefined, six, "proj-1");
    const k1 = computeStorageKey(undefined, one, "proj-1");
    expect(k6).not.toBe(k1);
  });

  it("hashes deterministically — same components ⇒ same key", () => {
    const comps: ComponentLike[] = [
      { id: "a", type: "chart" },
      { id: "b", type: "metric" },
    ];
    expect(computeStorageKey(undefined, comps, "p")).toBe(
      computeStorageKey(undefined, comps, "p"),
    );
  });

  it("scopes the hashed key by projectId so two projects with same component ids don't collide", () => {
    const comps: ComponentLike[] = [{ id: "a", type: "chart" }];
    expect(computeStorageKey(undefined, comps, "p1")).not.toBe(
      computeStorageKey(undefined, comps, "p2"),
    );
  });
});

describe("sanitizeBreakpoint — orphan filter (the dominant 'corner stretched' cause)", () => {
  const activeIds = new Set(["a", "b"]);
  const minMap = buildMinSizeMap([
    { id: "a", type: "chart" },
    { id: "b", type: "chart" },
  ]);

  it("drops items whose id is no longer in the active component set", () => {
    const input: Layout[] = [
      mkLayout({ i: "a" }),
      mkLayout({ i: "ghost-from-previous-dashboard" }),
      mkLayout({ i: "b" }),
    ];
    const result = sanitizeBreakpoint(input, activeIds, minMap);
    expect(result.map((l) => l.i).sort()).toEqual(["a", "b"]);
  });

  it("returns [] for malformed input", () => {
    expect(sanitizeBreakpoint(undefined, activeIds, minMap)).toEqual([]);
    expect(sanitizeBreakpoint(null, activeIds, minMap)).toEqual([]);
    // @ts-expect-error - intentionally bad input
    expect(sanitizeBreakpoint("not-an-array", activeIds, minMap)).toEqual([]);
  });
});

describe("sanitizeBreakpoint — minH/minW clamp (the 'vertical strip' sliver)", () => {
  const activeIds = new Set(["chart_1", "metric_1", "table_1"]);
  const minMap = buildMinSizeMap([
    { id: "chart_1", type: "chart" },
    { id: "metric_1", type: "metric" },
    { id: "table_1", type: "table" },
  ]);

  it("clamps h=1 chart up to minH=8 (no 30px sliver)", () => {
    const result = sanitizeBreakpoint(
      [mkLayout({ i: "chart_1", h: 1, w: 1 })],
      activeIds,
      minMap,
    );
    expect(result[0].h).toBe(8);
    expect(result[0].w).toBe(4);
    expect(result[0].minH).toBe(8);
    expect(result[0].minW).toBe(4);
  });

  it("clamps undefined h/w to type minimums", () => {
    const item = { i: "chart_1", x: 0, y: 0 } as unknown as Layout;
    const result = sanitizeBreakpoint([item], activeIds, minMap);
    expect(result[0].h).toBeGreaterThanOrEqual(8);
    expect(result[0].w).toBeGreaterThanOrEqual(4);
  });

  it("does not shrink an already-large layout", () => {
    const result = sanitizeBreakpoint(
      [mkLayout({ i: "chart_1", h: 16, w: 24 })],
      activeIds,
      minMap,
    );
    expect(result[0].h).toBe(16);
    expect(result[0].w).toBe(24);
  });

  it("clamps even when a corrupt save has minH set below the type floor", () => {
    const result = sanitizeBreakpoint(
      [mkLayout({ i: "chart_1", h: 2, w: 2, minH: 1, minW: 1 })],
      activeIds,
      minMap,
    );
    expect(result[0].h).toBe(8);
    expect(result[0].w).toBe(4);
    expect(result[0].minH).toBe(8);
    expect(result[0].minW).toBe(4);
  });

  it("applies table minimums (minW=12, minH=8)", () => {
    const result = sanitizeBreakpoint(
      [mkLayout({ i: "table_1", h: 1, w: 1 })],
      activeIds,
      minMap,
    );
    expect(result[0].h).toBe(8);
    expect(result[0].w).toBe(12);
  });

  it("applies metric minimums (minW=2, minH=2)", () => {
    const result = sanitizeBreakpoint(
      [mkLayout({ i: "metric_1", h: 1, w: 1 })],
      activeIds,
      minMap,
    );
    expect(result[0].h).toBe(2);
    expect(result[0].w).toBe(2);
  });
});

describe("sanitizeLayouts — fullyCovered guards the fallback to backend layout", () => {
  const components: ComponentLike[] = [
    { id: "a", type: "chart" },
    { id: "b", type: "chart" },
  ];

  it("flags fullyCovered=false when saved layout is missing an active item (forces fallback)", () => {
    const saved: Layouts = {
      ...emptyLayouts,
      lg: [mkLayout({ i: "a" })],
    };
    const { fullyCovered } = sanitizeLayouts(saved, components);
    expect(fullyCovered).toBe(false);
  });

  it("flags fullyCovered=true when every active component has a layout entry", () => {
    const saved: Layouts = {
      ...emptyLayouts,
      lg: [mkLayout({ i: "a" }), mkLayout({ i: "b" })],
    };
    const { fullyCovered } = sanitizeLayouts(saved, components);
    expect(fullyCovered).toBe(true);
  });

  it("ignores orphans when computing coverage — leak from a previous dashboard does NOT make a partial save look valid", () => {
    const saved: Layouts = {
      ...emptyLayouts,
      lg: [
        mkLayout({ i: "a" }),
        mkLayout({ i: "ghost-1" }),
        mkLayout({ i: "ghost-2" }),
        mkLayout({ i: "ghost-3" }),
      ],
    };
    const { fullyCovered, layouts } = sanitizeLayouts(saved, components);
    expect(fullyCovered).toBe(false);
    expect(layouts.lg.map((l) => l.i)).toEqual(["a"]);
  });

  it("sanitizes every breakpoint, not just lg", () => {
    const saved: Layouts = {
      lg: [mkLayout({ i: "a" }), mkLayout({ i: "b" })],
      md: [mkLayout({ i: "a", h: 1 }), mkLayout({ i: "b" })],
      sm: [mkLayout({ i: "ghost" }), mkLayout({ i: "a" }), mkLayout({ i: "b" })],
      xs: [mkLayout({ i: "a" }), mkLayout({ i: "b" })],
      xxs: [mkLayout({ i: "a" }), mkLayout({ i: "b" })],
    };
    const { layouts } = sanitizeLayouts(saved, components);
    expect(layouts.md.find((l) => l.i === "a")!.h).toBe(8);
    expect(layouts.sm.map((l) => l.i).sort()).toEqual(["a", "b"]);
  });
});

describe("shouldFillSparse — the 1-chart-in-the-corner case (R5)", () => {
  it("widens a sole chart when total ≤ 2 and exactly one non-metric exists", () => {
    const comps: ComponentLike[] = [
      { id: "m", type: "metric" },
      { id: "c", type: "chart" },
    ];
    expect(shouldFillSparse(comps, "chart")).toBe(true);
    expect(shouldFillSparse(comps, "metric")).toBe(false);
  });

  it("does NOT widen when the dashboard has > 2 components", () => {
    const comps: ComponentLike[] = [
      { id: "m1", type: "metric" },
      { id: "m2", type: "metric" },
      { id: "c", type: "chart" },
    ];
    expect(shouldFillSparse(comps, "chart")).toBe(false);
  });

  it("does NOT widen when there are multiple non-metrics (their backend widths should win)", () => {
    const comps: ComponentLike[] = [
      { id: "c1", type: "chart" },
      { id: "c2", type: "chart" },
    ];
    expect(shouldFillSparse(comps, "chart")).toBe(false);
  });

  it("widens a sole non-metric even with no metrics around it", () => {
    const comps: ComponentLike[] = [{ id: "c", type: "chart" }];
    expect(shouldFillSparse(comps, "chart")).toBe(true);
  });
});

describe("clampLayoutItem — the universal floor used on BOTH backend and localStorage paths", () => {
  it("clamps backend-shipped h=1 chart up to chart minH=8 (the 'F5 still shows stretched chart' case)", () => {
    const out = clampLayoutItem({ w: 24, h: 1 }, { minW: 4, minH: 8 });
    expect(out.h).toBe(8);
    expect(out.w).toBe(24);
    expect(out.minH).toBe(8);
    expect(out.minW).toBe(4);
  });

  it("clamps backend-shipped minH=1 even when it's set explicitly (corrupt payload)", () => {
    const out = clampLayoutItem({ w: 4, h: 2, minW: 1, minH: 1 }, { minW: 4, minH: 8 });
    expect(out.h).toBe(8);
    expect(out.w).toBe(4);
    expect(out.minH).toBe(8);
    expect(out.minW).toBe(4);
  });

  it("does not shrink a generously-sized item", () => {
    const out = clampLayoutItem({ w: 24, h: 16, minW: 12, minH: 12 }, { minW: 4, minH: 8 });
    expect(out.h).toBe(16);
    expect(out.w).toBe(24);
    expect(out.minH).toBe(12);
    expect(out.minW).toBe(12);
  });

  it("synthesizes w/h from minimums when missing", () => {
    const out = clampLayoutItem(
      { w: NaN, h: NaN } as unknown as { w: number; h: number },
      { minW: 4, minH: 8 },
    );
    expect(out.h).toBe(8);
    expect(out.w).toBe(4);
  });
});

describe("mergeLayoutIntoComponents — the bridge from RGL layout to S3 dashboard JSON (R6)", () => {
  type Comp = { id: string | number; type?: string; position?: Record<string, unknown> };

  it("writes x/y/w/h/minW/minH into each matching component's position", () => {
    const components: Comp[] = [
      { id: "a", position: { existing: "field" } },
      { id: "b" },
    ];
    const layout = [
      mkLayout({ i: "a", x: 0, y: 0, w: 12, h: 10, minW: 4, minH: 8 }),
      mkLayout({ i: "b", x: 12, y: 0, w: 12, h: 10 }),
    ];
    const out = mergeLayoutIntoComponents(components, layout);
    expect(out[0].position).toMatchObject({
      x: 0, y: 0, width: 12, height: 10, minW: 4, minH: 8,
      existing: "field", // preserves pre-existing fields
    });
    expect(out[1].position).toMatchObject({ x: 12, y: 0, width: 12, height: 10 });
  });

  it("returns components untouched when layout is null/empty", () => {
    const components: Comp[] = [{ id: "a", position: { x: 1 } }];
    expect(mergeLayoutIntoComponents(components, null)).toBe(components);
    expect(mergeLayoutIntoComponents(components, [])).toBe(components);
  });

  it("leaves a component's position untouched when no matching layout entry exists", () => {
    const components: Comp[] = [
      { id: "a", position: { x: 99 } },
      { id: "b" },
    ];
    const out = mergeLayoutIntoComponents(components, [mkLayout({ i: "a", x: 1, y: 2 })]);
    expect(out[0].position).toMatchObject({ x: 1, y: 2 });
    expect(out[1].position).toBeUndefined();
  });

  it("matches by stringified id (handles numeric component ids)", () => {
    const components: Comp[] = [{ id: 42 }];
    const out = mergeLayoutIntoComponents(components, [mkLayout({ i: "42", x: 5, y: 5 })]);
    expect(out[0].position).toMatchObject({ x: 5, y: 5 });
  });
});

describe("end-to-end scenario: stale layout from previous dashboard", () => {
  it("does NOT accept a 6-chart layout as valid for a 1-chart dashboard (the dominant production bug)", () => {
    const prevDashboardSavedLayout: Layouts = {
      ...emptyLayouts,
      lg: Array.from({ length: 6 }, (_, i) =>
        mkLayout({ i: `old_chart_${i}`, w: 8, h: 10, x: (i % 3) * 8, y: Math.floor(i / 3) * 10 }),
      ),
    };
    const newDashboardComponents: ComponentLike[] = [
      { id: "new_chart_1", type: "chart" },
    ];
    const { fullyCovered, layouts } = sanitizeLayouts(
      prevDashboardSavedLayout,
      newDashboardComponents,
    );
    // The caller will see fullyCovered=false and fall back to a freshly-built
    // layout instead of trying to render the new chart inside a corrupt grid.
    expect(fullyCovered).toBe(false);
    expect(layouts.lg).toEqual([]);
  });

  it("does NOT accept a corrupted h=1 save (the 'vertical strip' bug) — it gets clamped before rendering", () => {
    const saved: Layouts = {
      ...emptyLayouts,
      lg: [mkLayout({ i: "c1", h: 1, w: 1, minH: 1, minW: 1 })],
    };
    const { layouts, fullyCovered } = sanitizeLayouts(saved, [
      { id: "c1", type: "chart" },
    ]);
    expect(fullyCovered).toBe(true);
    expect(layouts.lg[0].h).toBeGreaterThanOrEqual(8);
    expect(layouts.lg[0].w).toBeGreaterThanOrEqual(4);
  });
});
