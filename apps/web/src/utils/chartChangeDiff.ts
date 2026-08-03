/**
 * Field-level diff between two chart configurations.
 *
 * Complements dashboardDiff.ts (which answers "which components changed?") by
 * describing *how* a single chart changed: type swap, series add/remove, style
 * (color/theme) tweaks, axis/filter changes. Pure + exported so later phases
 * (e.g. the Phase 7 diff view) can reuse it.
 */

export type EditDiffKind = 'type' | 'series' | 'style' | 'filter' | 'other';

export interface EditDiffEntry {
  field: string;
  before?: string;
  after?: string;
  kind: EditDiffKind;
}

/**
 * A chart config is the loosely-typed object Morpheus stores per chart
 * (chart_type, datasets, styling, config/axis, filters …). We accept `unknown`
 * shapes and read defensively.
 */
type ChartConfigLike = Record<string, unknown> | null | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function readChartType(config: Record<string, unknown>): string | undefined {
  return asString(config.chart_type) ?? asString(config.type);
}

function readDatasetLabels(config: Record<string, unknown>): string[] {
  const datasets = config.datasets;
  if (!Array.isArray(datasets)) return [];
  return datasets
    .map((dataset, index) => asString(asRecord(dataset).label) ?? `Series ${index + 1}`)
    .filter((label): label is string => label.length > 0);
}

function readFilters(config: Record<string, unknown>): string[] {
  const filters = config.filters;
  if (Array.isArray(filters)) {
    return filters.map((filter) => asString(filter) ?? JSON.stringify(filter));
  }
  if (filters && typeof filters === 'object') {
    return Object.entries(filters).map(([key, value]) => `${key}: ${asString(value) ?? JSON.stringify(value)}`);
  }
  return [];
}

function readTheme(config: Record<string, unknown>): string | undefined {
  const styling = asRecord(config.styling);
  return asString(styling.theme) ?? asString(styling.presetTheme) ?? asString(config.theme);
}

function diffStringArrays(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((item) => !beforeSet.has(item)),
    removed: before.filter((item) => !afterSet.has(item)),
  };
}

/**
 * Produce field-level diff entries describing how `after` differs from `before`.
 * Returns an empty array when nothing meaningful changed.
 */
export function diffChartConfigs(before: ChartConfigLike, after: ChartConfigLike): EditDiffEntry[] {
  const beforeConfig = asRecord(before);
  const afterConfig = asRecord(after);
  const entries: EditDiffEntry[] = [];

  const typeBefore = readChartType(beforeConfig);
  const typeAfter = readChartType(afterConfig);
  if (typeBefore !== typeAfter) {
    entries.push({ field: 'Chart type', before: typeBefore, after: typeAfter, kind: 'type' });
  }

  const seriesDiff = diffStringArrays(readDatasetLabels(beforeConfig), readDatasetLabels(afterConfig));
  for (const label of seriesDiff.added) {
    entries.push({ field: 'Series', after: label, kind: 'series' });
  }
  for (const label of seriesDiff.removed) {
    entries.push({ field: 'Series', before: label, kind: 'series' });
  }

  const themeBefore = readTheme(beforeConfig);
  const themeAfter = readTheme(afterConfig);
  if (themeBefore !== themeAfter) {
    entries.push({ field: 'Theme', before: themeBefore, after: themeAfter, kind: 'style' });
  }

  const filterDiff = diffStringArrays(readFilters(beforeConfig), readFilters(afterConfig));
  for (const filter of filterDiff.added) {
    entries.push({ field: 'Filter', after: filter, kind: 'filter' });
  }
  for (const filter of filterDiff.removed) {
    entries.push({ field: 'Filter', before: filter, kind: 'filter' });
  }

  return entries;
}
