import { describe, expect, it } from "vitest";
import type { Layout, Layouts } from "react-grid-layout";
import {
  clampLayoutItem,
  compactLayoutVertically,
  compactLayoutsVertically,
  computeStorageKey,
  GRID_COLS,
  getMinSizeForType,
  getComponentLayoutFrame,
  layoutHasOverflowOrCollision,
  mergeLayoutIntoComponents,
  sanitizeBreakpoint,
  sanitizeLayoutItem,
  sanitizeLayoutItems,
  sanitizeLayouts,
  shouldFillSparse,
  buildMinSizeMap,
  buildMinSizeMapForCols,
  layoutsCoverComponents,
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
    expect(getMinSizeForType("metric")).toEqual({ minW: 6, minH: 2 });
  });

  it("returns table mins", () => {
    expect(getMinSizeForType("table")).toEqual({ minW: 12, minH: 8 });
  });
});

describe("computeStorageKey", () => {
  it("uses the real dashboard id when present", () => {
    expect(computeStorageKey("abc-123", [], "proj-1")).toBe(
      "dashboard_layout_abc-123_v6",
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

  it("applies metric minimums (minW=6, minH=2)", () => {
    const result = sanitizeBreakpoint(
      [mkLayout({ i: "metric_1", h: 1, w: 1 })],
      activeIds,
      minMap,
    );
    expect(result[0].h).toBe(2);
    expect(result[0].w).toBe(6);
  });

  it("keeps a row of generated metric cards readable by enforcing the wider floor", () => {
    const metrics: ComponentLike[] = Array.from({ length: 6 }, (_, i) => ({
      id: `metric_${i}`,
      type: "metric",
    }));
    const metricIds = new Set(metrics.map((metric) => String(metric.id)));
    const metricMinMap = buildMinSizeMap(metrics);
    const result = sanitizeBreakpoint(
      metrics.map((metric, index) =>
        mkLayout({ i: String(metric.id), x: index * 4, w: 4, h: 2 }),
      ),
      metricIds,
      metricMinMap,
    );
    expect(result.every((item) => item.w >= 6 && item.minW === 6)).toBe(true);
  });
});

describe("sanitizeLayoutItem / sanitizeLayoutItems — horizontal overflow repair", () => {
  it("repairs the exact bad Morpheus layout: x=16, w=8, minW=12 cannot overflow a 24-col grid", () => {
    const out = sanitizeLayoutItem(
      mkLayout({ i: "chart_002", x: 16, y: 4, w: 8, h: 12, minW: 12, minH: 12 }),
      { minW: 4, minH: 8 },
      GRID_COLS.lg,
    );

    expect(out).toMatchObject({ x: 12, w: 12, minW: 12 });
    expect(out.x + out.w).toBeLessThanOrEqual(GRID_COLS.lg);
  });

  it("caps minW and w at the active breakpoint column count", () => {
    const out = sanitizeLayoutItem(
      mkLayout({ i: "wide", x: 6, y: 0, w: 12, h: 8, minW: 12 }),
      { minW: 12, minH: 8 },
      GRID_COLS.xs,
    );

    expect(out).toMatchObject({ x: 0, w: GRID_COLS.xs, minW: GRID_COLS.xs });
    expect(out.x + out.w).toBeLessThanOrEqual(GRID_COLS.xs);
  });

  it("scales type minimum widths for responsive breakpoints", () => {
    const minMap = buildMinSizeMapForCols([{ id: "metric_1", type: "metric" }], GRID_COLS.md);
    const out = sanitizeLayoutItems(
      [mkLayout({ i: "metric_1", x: 0, y: 0, w: 3, h: 2, minW: 3, minH: 2 })],
      minMap,
      GRID_COLS.md,
    );

    expect(out[0]).toMatchObject({ w: 3, minW: 3 });
  });

  it("moves later items down when width clamping would create collisions", () => {
    const minMap = new Map<string, { minW: number; minH: number }>([
      ["chart_001", { minW: 4, minH: 8 }],
      ["chart_002", { minW: 12, minH: 12 }],
      ["chart_003", { minW: 4, minH: 8 }],
    ]);
    const out = sanitizeLayoutItems(
      [
        mkLayout({ i: "chart_001", x: 0, y: 4, w: 16, h: 12 }),
        mkLayout({ i: "chart_002", x: 16, y: 4, w: 8, h: 12, minW: 12, minH: 12 }),
        mkLayout({ i: "chart_003", x: 0, y: 16, w: 24, h: 12 }),
      ],
      minMap,
      GRID_COLS.lg,
    );

    expect(layoutHasOverflowOrCollision(out, GRID_COLS.lg)).toBe(false);
    expect(out.find((item) => item.i === "chart_002")).toMatchObject({ x: 12, w: 12, y: 12 });
    expect(out.find((item) => item.i === "chart_003")!.y).toBeGreaterThanOrEqual(24);
  });

  it("sanitizes a saved/localStorage layout with x+w beyond the grid", () => {
    const activeIds = new Set(["chart_1"]);
    const minMap = buildMinSizeMap([{ id: "chart_1", type: "chart" }]);
    const out = sanitizeBreakpoint(
      [mkLayout({ i: "chart_1", x: 22, y: 0, w: 8, h: 8 })],
      activeIds,
      minMap,
      GRID_COLS.lg,
    );

    expect(out[0].x + out[0].w).toBeLessThanOrEqual(GRID_COLS.lg);
    expect(layoutHasOverflowOrCollision(out, GRID_COLS.lg)).toBe(false);
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
  type Comp = { id: string | number; type?: string; position?: Record<string, unknown>; layout?: Record<string, unknown> };

  it("writes x/y/w/h/minW/minH into each matching component's position and layout", () => {
    const components: Comp[] = [
      { id: "a", position: { existing: "field" }, layout: { existingLayout: "field" } },
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
    expect(out[0].layout).toMatchObject({
      x: 0, y: 0, w: 12, h: 10, minW: 4, minH: 8,
      existingLayout: "field",
    });
    expect(out[1].layout).toMatchObject({ x: 12, y: 0, w: 12, h: 10 });
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

  it("persists sanitized x/y/w/h/minW/minH so S3 cannot re-save overflowing geometry", () => {
    const components: Comp[] = [{ id: "chart_002" }];
    const out = mergeLayoutIntoComponents(components, [
      mkLayout({ i: "chart_002", x: 16, y: 4, w: 8, h: 12, minW: 12, minH: 12 }),
    ]);

    expect(out[0].position).toMatchObject({ x: 12, y: 4, width: 12, height: 12, minW: 12, minH: 12 });
    expect(out[0].layout).toMatchObject({ x: 12, y: 4, w: 12, h: 12, minW: 12, minH: 12 });
  });
});

describe("getComponentLayoutFrame — position wins over stale layout", () => {
  it("uses position when both position and layout exist but disagree", () => {
    const frame = getComponentLayoutFrame(
      {
        id: "chart_1",
        type: "chart",
        position: { x: 8, y: 9, width: 10, height: 11, minW: 5, minH: 6 },
        layout: { x: 1, y: 2, w: 3, h: 4, minW: 1, minH: 2 },
      },
      0,
    );
    expect(frame).toEqual({ x: 8, y: 9, w: 10, h: 11, minW: 5, minH: 6 });
  });

  it("falls back to layout for raw Morpheus dashboard JSON without position", () => {
    const frame = getComponentLayoutFrame(
      {
        id: "chart_1",
        type: "chart",
        layout: { x: 1, y: 2, w: 3, h: 4, minW: 1, minH: 2 },
      },
      0,
    );
    expect(frame).toEqual({ x: 1, y: 2, w: 3, h: 4, minW: 1, minH: 2 });
  });
});

describe("compactLayoutVertically — removes empty rows after drag/drop", () => {
  it("pulls items upward without changing x/w/h", () => {
    const input: Layout[] = [
      mkLayout({ i: "top", x: 0, y: 0, w: 12, h: 4 }),
      mkLayout({ i: "bottom", x: 0, y: 20, w: 12, h: 6 }),
    ];
    const out = compactLayoutVertically(input);
    expect(out.find((item) => item.i === "bottom")).toMatchObject({
      x: 0,
      y: 4,
      w: 12,
      h: 6,
    });
  });

  it("keeps horizontal placement and preserves original array order", () => {
    const input: Layout[] = [
      mkLayout({ i: "right", x: 12, y: 10, w: 12, h: 4 }),
      mkLayout({ i: "left", x: 0, y: 10, w: 12, h: 4 }),
    ];
    const out = compactLayoutVertically(input);
    expect(out.map((item) => item.i)).toEqual(["right", "left"]);
    expect(out[0]).toMatchObject({ x: 12, y: 0, w: 12, h: 4 });
    expect(out[1]).toMatchObject({ x: 0, y: 0, w: 12, h: 4 });
  });

  it("does not move an item through a blocking item in the same columns", () => {
    const input: Layout[] = [
      mkLayout({ i: "top", x: 0, y: 0, w: 12, h: 6 }),
      mkLayout({ i: "bottom", x: 0, y: 20, w: 12, h: 6 }),
    ];
    const out = compactLayoutVertically(input);
    expect(out.find((item) => item.i === "bottom")).toMatchObject({ y: 6 });
  });

  it("treats static items as blockers and leaves them in place", () => {
    const input: Layout[] = [
      mkLayout({ i: "static", x: 0, y: 10, w: 12, h: 4, static: true }),
      mkLayout({ i: "movable", x: 0, y: 20, w: 12, h: 4 }),
    ];
    const out = compactLayoutVertically(input);
    expect(out.find((item) => item.i === "static")).toMatchObject({ y: 10 });
    expect(out.find((item) => item.i === "movable")).toMatchObject({ y: 14 });
  });

  it("compacts every breakpoint in a responsive layouts object", () => {
    const layouts: Layouts = {
      ...emptyLayouts,
      lg: [
        mkLayout({ i: "a", x: 0, y: 0, w: 12, h: 4 }),
        mkLayout({ i: "b", x: 0, y: 20, w: 12, h: 4 }),
      ],
      md: [mkLayout({ i: "a", x: 0, y: 10, w: 12, h: 4 })],
    };
    const out = compactLayoutsVertically(layouts);
    expect(out.lg.find((item) => item.i === "b")).toMatchObject({ y: 4 });
    expect(out.md[0]).toMatchObject({ y: 0 });
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

describe("layoutsCoverComponents (stretch-on-switch guard)", () => {
  const lg = (ids: string[]): Layout[] =>
    ids.map((i, idx) => ({ i, x: 0, y: idx, w: 6, h: 8 }));

  it("returns true when every component id has a layout entry", () => {
    expect(
      layoutsCoverComponents(lg(["a", "b", "c"]), [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ]),
    ).toBe(true);
  });

  it("returns false when the layout is from a different (previous) dashboard", () => {
    // Stale switch frame: layout holds OLD ids, components are the NEW dashboard.
    expect(
      layoutsCoverComponents(lg(["old1", "old2"]), [
        { id: "new1" },
        { id: "new2" },
      ]),
    ).toBe(false);
  });

  it("returns false when at least one current component is missing from the layout", () => {
    // "c" has no layout entry -> not covered.
    expect(
      layoutsCoverComponents(lg(["a", "b"]), [{ id: "a" }, { id: "b" }, { id: "c" }]),
    ).toBe(false);
  });

  it("returns true when there are no components to cover", () => {
    expect(layoutsCoverComponents(lg(["a"]), [])).toBe(true);
    expect(layoutsCoverComponents([], [])).toBe(true);
    expect(layoutsCoverComponents(null, null)).toBe(true);
  });

  it("returns false when the layout is empty but components exist", () => {
    expect(layoutsCoverComponents([], [{ id: "a" }])).toBe(false);
    expect(layoutsCoverComponents(null, [{ id: "a" }])).toBe(false);
  });

  it("matches ids by string (numeric vs string ids)", () => {
    expect(layoutsCoverComponents(lg(["1", "2"]), [{ id: 1 }, { id: 2 }])).toBe(true);
  });
});
