import type { Layout, Layouts } from "react-grid-layout";

/**
 * Pure helpers for the dashboard grid layout pipeline. Extracted from
 * DashboardPreview so the failure modes that keep regressing — stale
 * localStorage items leaking across dashboards, `h < minH` slivers, storageKey
 * collisions — can be locked down with unit tests.
 *
 * No DOM, no React. Anything tricky here should have a test in
 * dashboardLayout.test.ts.
 */

export type ComponentLike = {
  id: string | number;
  type: string;
  layout?: Partial<Layout> & { x?: number; y?: number; w?: number; h?: number; minW?: number; minH?: number };
  position?: { x?: number; y?: number; width?: number; height?: number; minW?: number; minH?: number };
  component_config?: { data?: unknown[] };
};

export type MinSize = { minW: number; minH: number };
export type ComponentLayoutFrame = Pick<Layout, "x" | "y" | "w" | "h"> & Partial<Pick<Layout, "minW" | "minH">>;

export const STORAGE_KEY_VERSION = "v6";
export const GRID_COLS = { lg: 24, md: 12, sm: 8, xs: 4, xxs: 2 } as const;
export const DEFAULT_GRID_COLS: number = GRID_COLS.lg;

/**
 * Per-type minimum width/height in grid units. The 24-col grid uses 30px row
 * height, so chart minH=8 ⇒ 240px floor.
 */
export function getMinSizeForType(type: string): MinSize {
  // Metric cards include title, value, comparison text, and often a sparkline.
  // On the 24-col grid, minW=6 caps a metric row at four cards so Morpheus
  // cannot squeeze 5-6 cards into unreadable tiles.
  if (type === "metric") return { minW: 6, minH: 2 };
  if (type === "table") return { minW: 12, minH: 8 };
  return { minW: 4, minH: 8 }; // charts
}

/**
 * Stable storage key for a dashboard's layout.
 *
 * The previous implementation collapsed every id-less ("processed") dashboard
 * in a project to a single key, so the layout for a 6-chart dashboard would
 * load as the layout for a later 1-chart dashboard. We now derive a hash from
 * the component-id set so distinct dashboards always get distinct keys.
 */
export function computeStorageKey(
  dashboardId: string | undefined | null,
  components: ComponentLike[] | undefined | null,
  projectId: string | undefined | null,
): string {
  if (dashboardId) {
    return `dashboard_layout_${dashboardId}_${STORAGE_KEY_VERSION}`;
  }
  const ids = (components || []).map((c) => String(c.id)).join("|");
  let hash = 0;
  for (let i = 0; i < ids.length; i++) {
    hash = ((hash << 5) - hash + ids.charCodeAt(i)) | 0;
  }
  const projectSuffix = projectId ? `_${projectId}` : "";
  return `dashboard_layout_processed_${Math.abs(hash).toString(36)}${projectSuffix}_${STORAGE_KEY_VERSION}`;
}

/**
 * Filter + clamp a single breakpoint's saved layout against the currently
 * active component set. Two failure modes this guards:
 *
 * 1. Orphan items — a layout entry whose `i` is no longer in the active
 *    components. RGL will still allocate grid space for these, which is what
 *    pushes new charts into a corner.
 *
 * 2. Sliver heights — `h < minH` (often h=1 from a prior corruption) renders
 *    as a 30px-tall strip. Comment in DashboardPreview's old code referred to
 *    this as the "stretched vertical strip" bug.
 */
export function sanitizeBreakpoint(
  items: Layout[] | undefined | null,
  activeComponentIds: ReadonlySet<string>,
  minSizeById: ReadonlyMap<string, MinSize>,
  cols = DEFAULT_GRID_COLS,
): Layout[] {
  if (!Array.isArray(items)) return [];
  const activeItems = items.filter((item) => activeComponentIds.has(item.i));
  return sanitizeLayoutItems(activeItems, minSizeById, cols);
}

/**
 * Clamp a single layout item against the type's minimum size. Used by both
 * the backend-payload path (componentsToBaseLayout) and the localStorage path
 * (sanitizeBreakpoint) — anything that produces a Layout for the grid must
 * route through this, or a stored `h: 1` will render as a 30px sliver.
 */
export function clampLayoutItem<T extends Pick<Layout, "w" | "h"> & Partial<Pick<Layout, "minW" | "minH">>>(
  item: T,
  typeMin: MinSize,
  cols = DEFAULT_GRID_COLS,
): T & Pick<Layout, "minW" | "minH"> {
  const safeCols = normalizePositiveInt(cols, DEFAULT_GRID_COLS);
  const minW = clamp(
    Math.max(normalizePositiveInt(item.minW, typeMin.minW), normalizePositiveInt(typeMin.minW, 1)),
    1,
    safeCols,
  );
  const minH = Math.max(normalizePositiveInt(item.minH, typeMin.minH), normalizePositiveInt(typeMin.minH, 1));
  const w = clamp(Math.max(normalizePositiveInt(item.w, minW), minW), 1, safeCols);
  const h = Math.max(normalizePositiveInt(item.h, minH), minH);
  return { ...item, w, h, minW, minH };
}

/** Build the per-component min size map used by sanitizeBreakpoint. */
export function buildMinSizeMap(components: ComponentLike[]): Map<string, MinSize> {
  const m = new Map<string, MinSize>();
  components.forEach((c) => m.set(String(c.id), getMinSizeForType(c.type)));
  return m;
}

export function scaleMinSizeForCols(
  minSize: MinSize,
  cols: number,
  fromCols = DEFAULT_GRID_COLS,
): MinSize {
  const safeCols = normalizePositiveInt(cols, DEFAULT_GRID_COLS);
  const safeFromCols = normalizePositiveInt(fromCols, DEFAULT_GRID_COLS);
  return {
    minW: clamp(Math.max(1, Math.round((minSize.minW * safeCols) / safeFromCols)), 1, safeCols),
    minH: normalizePositiveInt(minSize.minH, 1),
  };
}

export function buildMinSizeMapForCols(
  components: ComponentLike[],
  cols = DEFAULT_GRID_COLS,
): Map<string, MinSize> {
  const m = new Map<string, MinSize>();
  components.forEach((c) => m.set(String(c.id), scaleMinSizeForCols(getMinSizeForType(c.type), cols)));
  return m;
}

/**
 * Decide whether a freshly-built base layout should treat this dashboard as
 * "sparse" — when there are ≤2 total items and exactly one non-metric, that
 * non-metric should fill the 24-col grid rather than sit at its backend-given
 * width (often 6/24) and leave the right 75% empty.
 */
export function shouldFillSparse(components: ComponentLike[], type: string): boolean {
  if (type === "metric") return false;
  if (components.length > 2) return false;
  const nonMetricCount = components.filter((c) => c.type !== "metric").length;
  return nonMetricCount === 1;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeInt(value: unknown, fallback: number): number {
  return finiteNumber(value) ? Math.round(value) : fallback;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  return Math.max(1, normalizeInt(value, fallback));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolve the grid frame for a component. `position` is authoritative because
 * drag/resize persistence writes the user's latest coordinates there. `layout`
 * remains as compatibility input for raw Morpheus dashboard JSON.
 */
export function getComponentLayoutFrame(component: ComponentLike, index: number): ComponentLayoutFrame {
  const position = component.position || {};
  const layout = component.layout || {};
  return {
    x: finiteNumber(position.x) ? position.x : (finiteNumber(layout.x) ? layout.x : index % 12),
    y: finiteNumber(position.y) ? position.y : (finiteNumber(layout.y) ? layout.y : Math.floor(index / 12)),
    w: finiteNumber(position.width) ? position.width : (finiteNumber(layout.w) ? layout.w : 4),
    h: finiteNumber(position.height) ? position.height : (finiteNumber(layout.h) ? layout.h : 10),
    minW: finiteNumber(position.minW) ? position.minW : (finiteNumber(layout.minW) ? layout.minW : undefined),
    minH: finiteNumber(position.minH) ? position.minH : (finiteNumber(layout.minH) ? layout.minH : undefined),
  };
}

function collides(a: Layout, b: Layout): boolean {
  if (a.i === b.i) return false;
  if (a.x + a.w <= b.x) return false;
  if (a.x >= b.x + b.w) return false;
  if (a.y + a.h <= b.y) return false;
  if (a.y >= b.y + b.h) return false;
  return true;
}

function sortByRowCol(layout: Layout[]): Layout[] {
  return [...layout].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.i.localeCompare(b.i);
  });
}

/**
 * Clamp an item to a finite, in-bounds grid rectangle. This is the horizontal
 * half of the "stretched chart" fix: if a generated item says
 * `{x: 16, w: 8, minW: 12}` on a 24-col grid, width must expand to 12 and x
 * must move back to 12 so the item does not overflow to column 28.
 */
export function sanitizeLayoutItem(
  item: Partial<Layout> & Pick<Layout, "i">,
  typeMin: MinSize,
  cols = DEFAULT_GRID_COLS,
): Layout {
  const safeCols = normalizePositiveInt(cols, DEFAULT_GRID_COLS);
  const clamped = clampLayoutItem(
    {
      ...item,
      w: normalizePositiveInt(item.w, typeMin.minW),
      h: normalizePositiveInt(item.h, typeMin.minH),
      minW: item.minW,
      minH: item.minH,
    },
    typeMin,
    safeCols,
  );
  const x = clamp(normalizeInt(item.x, 0), 0, safeCols - clamped.w);
  const y = Math.max(0, normalizeInt(item.y, 0));
  return {
    ...item,
    i: String(item.i),
    x,
    y,
    w: clamped.w,
    h: clamped.h,
    minW: clamped.minW,
    minH: clamped.minH,
  } as Layout;
}

function moveCollidingItemsDown(layout: Layout[]): Layout[] {
  const placed: Layout[] = [];
  const byId = new Map<string, Layout>();

  sortByRowCol(layout).forEach((item) => {
    let candidate = { ...item };
    while (placed.some((other) => collides(candidate, other))) {
      const nextY = Math.max(
        candidate.y + 1,
        ...placed
          .filter((other) => collides(candidate, other))
          .map((other) => other.y + other.h),
      );
      candidate = { ...candidate, y: nextY };
    }
    placed.push(candidate);
    byId.set(candidate.i, candidate);
  });

  return layout.map((item) => byId.get(item.i) || item);
}

/**
 * Canonical sanitizer for every generated, saved, scaled, or user-edited
 * dashboard layout before RGL receives it or S3 persists it.
 */
export function sanitizeLayoutItems(
  items: Layout[] | undefined | null,
  minSizeById: ReadonlyMap<string, MinSize>,
  cols = DEFAULT_GRID_COLS,
): Layout[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const sanitized = items.map((item) =>
    sanitizeLayoutItem(
      item,
      minSizeById.get(item.i) || { minW: 4, minH: 8 },
      cols,
    ),
  );
  return compactLayoutVertically(moveCollidingItemsDown(sanitized)).map((item) =>
    sanitizeLayoutItem(
      item,
      minSizeById.get(item.i) || { minW: item.minW || 4, minH: item.minH || 8 },
      cols,
    ),
  );
}

export function layoutHasOverflowOrCollision(layout: Layout[], cols = DEFAULT_GRID_COLS): boolean {
  return layout.some((item, index) => {
    if (item.x < 0 || item.y < 0 || item.w < 1 || item.h < 1 || item.x + item.w > cols) return true;
    return layout.slice(index + 1).some((other) => collides(item, other));
  });
}

/**
 * Remove vertical gaps while keeping every item's x/w/h intact. RGL compaction
 * can be disabled during initial render to avoid internal cache churn, so this
 * pure compactor is the canonical step before render/save.
 */
export function compactLayoutVertically(layout: Layout[] | undefined | null): Layout[] {
  if (!Array.isArray(layout) || layout.length === 0) return [];

  const cloned = layout.map((item) => ({ ...item }));
  const byId = new Map(cloned.map((item) => [item.i, item]));
  const placed: Layout[] = cloned.filter((item) => item.static);

  sortByRowCol(cloned)
    .filter((item) => !item.static)
    .forEach((item) => {
      while (item.y > 0) {
        const candidate = { ...item, y: item.y - 1 };
        if (placed.some((other) => collides(candidate, other))) break;
        item.y -= 1;
      }
      placed.push(item);
      byId.set(item.i, item);
    });

  return layout.map((item) => byId.get(item.i) || item);
}

export function compactLayoutsVertically(layouts: Layouts): Layouts {
  return {
    lg: compactLayoutVertically(layouts.lg),
    md: compactLayoutVertically(layouts.md),
    sm: compactLayoutVertically(layouts.sm),
    xs: compactLayoutVertically(layouts.xs),
    xxs: compactLayoutVertically(layouts.xxs),
  };
}

/**
 * Merge the latest RGL Layout entries back into the component list as
 * both `position: {x, y, width, height}` and `layout: {x, y, w, h}`. This is
 * what gets pushed to S3 so the dashboard JSON itself carries the user's
 * layout — no more localStorage as source of truth.
 *
 * Components without a matching layout entry are returned untouched (preserves
 * any pre-existing position/layout fields).
 */
export function mergeLayoutIntoComponents<C extends { id: string | number; position?: Record<string, unknown>; layout?: Record<string, unknown> }>(
  components: C[],
  layout: Layout[] | undefined | null,
): C[] {
  if (!Array.isArray(layout) || layout.length === 0) return components;
  const minSizeById = new Map(
    layout.map((l) => [
      l.i,
      {
        minW: normalizePositiveInt(l.minW, 1),
        minH: normalizePositiveInt(l.minH, 1),
      },
    ]),
  );
  const sanitizedLayout = layout.map((l) =>
    sanitizeLayoutItem(l, minSizeById.get(l.i) || { minW: 1, minH: 1 }, DEFAULT_GRID_COLS),
  );
  const byId = new Map<string, Layout>();
  sanitizedLayout.forEach((l) => byId.set(l.i, l));
  return components.map((c) => {
    const l = byId.get(String(c.id));
    if (!l) return c;
    return {
      ...c,
      position: {
        ...(c.position || {}),
        x: l.x,
        y: l.y,
        width: l.w,
        height: l.h,
        minW: l.minW,
        minH: l.minH,
      },
      layout: {
        ...(c.layout || {}),
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        minW: l.minW,
        minH: l.minH,
      },
    };
  });
}

/**
 * Sanitize every breakpoint at once. Returns the cleaned layouts plus a flag
 * indicating whether the saved layout still fully covers the active component
 * set — callers should fall back to a freshly-built layout when this is false.
 */
export function sanitizeLayouts(
  parsed: Layouts,
  activeComponents: ComponentLike[],
): { layouts: Layouts; fullyCovered: boolean } {
  const activeComponentIds = new Set(activeComponents.map((c) => String(c.id)));
  const layouts: Layouts = {
    lg: sanitizeBreakpoint(parsed.lg, activeComponentIds, buildMinSizeMapForCols(activeComponents, GRID_COLS.lg), GRID_COLS.lg),
    md: sanitizeBreakpoint(parsed.md, activeComponentIds, buildMinSizeMapForCols(activeComponents, GRID_COLS.md), GRID_COLS.md),
    sm: sanitizeBreakpoint(parsed.sm, activeComponentIds, buildMinSizeMapForCols(activeComponents, GRID_COLS.sm), GRID_COLS.sm),
    xs: sanitizeBreakpoint(parsed.xs, activeComponentIds, buildMinSizeMapForCols(activeComponents, GRID_COLS.xs), GRID_COLS.xs),
    xxs: sanitizeBreakpoint(parsed.xxs, activeComponentIds, buildMinSizeMapForCols(activeComponents, GRID_COLS.xxs), GRID_COLS.xxs),
  };
  const savedLgIds = new Set(layouts.lg.map((item) => item.i));
  const fullyCovered =
    layouts.lg.length === activeComponentIds.size &&
    Array.from(activeComponentIds).every((id) => savedLgIds.has(id));
  return { layouts, fullyCovered };
}

/**
 * Render-time guard: does the lg layout contain a layout entry for every
 * current component id?
 *
 * Used to prevent the grid from mounting (or persisting) a layout that does not
 * cover the components being rendered. On a dashboard switch the new components
 * are computed synchronously while `layouts` is updated asynchronously in an
 * effect, so for one render the stale layout lacks the new ids — mounting then
 * makes react-grid-layout assign fallback w=1/h=1 (the "stretched sliver" bug)
 * and even commit that garbage via onLayoutChange. Gating on this synchronously
 * skips that frame entirely.
 */
export function layoutsCoverComponents(
  lgLayout: Layout[] | undefined | null,
  components: Array<{ id: string | number }> | undefined | null,
): boolean {
  if (!components || components.length === 0) return true; // nothing to cover
  if (!lgLayout || lgLayout.length === 0) return false;
  const ids = new Set(lgLayout.map((l) => String(l.i)));
  return components.every((c) => ids.has(String(c.id)));
}
