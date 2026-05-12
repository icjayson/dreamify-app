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
  position?: { x?: number; y?: number; width?: number; height?: number };
  component_config?: { data?: unknown[] };
};

export type MinSize = { minW: number; minH: number };

export const STORAGE_KEY_VERSION = "v5";

/**
 * Per-type minimum width/height in grid units. The 24-col grid uses 30px row
 * height, so chart minH=8 ⇒ 240px floor.
 */
export function getMinSizeForType(type: string): MinSize {
  if (type === "metric") return { minW: 2, minH: 2 };
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
): Layout[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => activeComponentIds.has(item.i))
    .map((item) => clampLayoutItem(item, minSizeById.get(item.i) || { minW: 4, minH: 8 }));
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
): T & Pick<Layout, "minW" | "minH"> {
  const minW = Math.max(
    Number.isFinite(item.minW as number) ? (item.minW as number) : typeMin.minW,
    typeMin.minW,
  );
  const minH = Math.max(
    Number.isFinite(item.minH as number) ? (item.minH as number) : typeMin.minH,
    typeMin.minH,
  );
  const w = Math.max(Number.isFinite(item.w) ? item.w : minW, minW);
  const h = Math.max(Number.isFinite(item.h) ? item.h : minH, minH);
  return { ...item, w, h, minW, minH };
}

/** Build the per-component min size map used by sanitizeBreakpoint. */
export function buildMinSizeMap(components: ComponentLike[]): Map<string, MinSize> {
  const m = new Map<string, MinSize>();
  components.forEach((c) => m.set(String(c.id), getMinSizeForType(c.type)));
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
  const minSizeById = buildMinSizeMap(activeComponents);
  const layouts: Layouts = {
    lg: sanitizeBreakpoint(parsed.lg, activeComponentIds, minSizeById),
    md: sanitizeBreakpoint(parsed.md, activeComponentIds, minSizeById),
    sm: sanitizeBreakpoint(parsed.sm, activeComponentIds, minSizeById),
    xs: sanitizeBreakpoint(parsed.xs, activeComponentIds, minSizeById),
    xxs: sanitizeBreakpoint(parsed.xxs, activeComponentIds, minSizeById),
  };
  const savedLgIds = new Set(layouts.lg.map((item) => item.i));
  const fullyCovered =
    layouts.lg.length === activeComponentIds.size &&
    Array.from(activeComponentIds).every((id) => savedLgIds.has(id));
  return { layouts, fullyCovered };
}
