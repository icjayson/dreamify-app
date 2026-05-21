type DashboardDateRange = {
  from?: Date;
  to?: Date;
};

type MetricLike = {
  id?: string;
  title?: string;
  name?: string;
  label?: string;
  value?: string | number;
  sparkline_data?: Array<Record<string, unknown>>;
  related_chart_id?: string;
  [key: string]: unknown;
};

type DatasetLike = {
  label?: string;
  data?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type ChartLike = {
  id?: string;
  title?: string;
  datasets?: DatasetLike[];
  [key: string]: unknown;
};

type DashboardLike = {
  metrics?: MetricLike[];
  charts?: ChartLike[];
  [key: string]: unknown;
};

export type MetricDataPoint = { label: string; value: number };

export function parseDateLabel(label: string): Date | null {
  if (!label) return null;

  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})/,
    /^(\d{2})\/(\d{2})\/(\d{4})/,
    /^(\d{2})-(\d{2})-(\d{2})$/,
  ];

  for (const format of formats) {
    const match = label.match(format);
    if (!match) continue;

    if (format === formats[0]) {
      return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    }
    if (format === formats[1]) {
      return new Date(parseInt(match[3], 10), parseInt(match[1], 10) - 1, parseInt(match[2], 10));
    }

    const year = parseInt(match[3], 10) + (parseInt(match[3], 10) < 50 ? 2000 : 1900);
    return new Date(year, parseInt(match[1], 10) - 1, parseInt(match[2], 10));
  }

  const iso = new Date(label);
  if (!Number.isNaN(iso.getTime())) return iso;

  return null;
}

export function extractNumericValue(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/[,\s$€£¥%]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLookupKey(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function metricLookupKeys(metric?: MetricLike): Set<string> {
  const keys = new Set<string>();
  const candidates = [metric?.title, metric?.name, metric?.label, metric?.id];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeLookupKey(candidate);
    if (!normalized || /^metric\d+$/i.test(normalized)) continue;
    keys.add(normalized);

    String(candidate)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => keys.add(normalizeLookupKey(part)));
  }

  return keys;
}

function normalizePoint(point: Record<string, unknown>): MetricDataPoint {
  const rawLabel = point.label ?? point.name ?? point.date ?? "";
  const rawValue = point.value ?? point.Value ?? point.count ?? point.Count ?? point.amount ?? point.Amount ?? 0;
  return {
    label: String(rawLabel),
    value: typeof rawValue === "number" ? rawValue : parseFloat(String(rawValue)) || 0,
  };
}

function normalizeDatasetData(dataset?: DatasetLike): MetricDataPoint[] | undefined {
  if (!Array.isArray(dataset?.data) || dataset.data.length === 0) return undefined;
  return dataset.data.map(normalizePoint);
}

export function extractSparklineData(chart: ChartLike | null | undefined, metric?: MetricLike): MetricDataPoint[] | undefined {
  if (!chart || !Array.isArray(chart.datasets) || chart.datasets.length === 0) {
    return undefined;
  }

  const keys = metricLookupKeys(metric);
  if (keys.size > 0) {
    const exactMatch = chart.datasets.find((dataset) => keys.has(normalizeLookupKey(dataset.label)));
    const exactData = normalizeDatasetData(exactMatch);
    if (exactData) return exactData;

    const containsMatch = chart.datasets.find((dataset) => {
      const datasetKey = normalizeLookupKey(dataset.label);
      return datasetKey.length >= 3 && Array.from(keys).some((key) => key.includes(datasetKey) || datasetKey.includes(key));
    });
    const containsData = normalizeDatasetData(containsMatch);
    if (containsData) return containsData;
  }

  if (chart.datasets.length === 1) {
    return normalizeDatasetData(chart.datasets[0]);
  }

  return undefined;
}

export function resolveMetricSparklineData(metric: MetricLike, charts: ChartLike[] = []): MetricDataPoint[] | undefined {
  if (Array.isArray(metric.sparkline_data) && metric.sparkline_data.length > 0) {
    return metric.sparkline_data.map(normalizePoint);
  }

  if (metric.related_chart_id) {
    const relatedChart = charts.find((chart) => chart.id === metric.related_chart_id);
    const relatedData = extractSparklineData(relatedChart, metric);
    if (relatedData) return relatedData;
  }

  const metricKey = normalizeLookupKey(metric.title || metric.name || "");
  if (!metricKey) return undefined;

  for (const chart of charts) {
    const chartKey = normalizeLookupKey(chart.title || "");
    if (chartKey && (chartKey.includes(metricKey) || metricKey.includes(chartKey))) {
      const data = extractSparklineData(chart, metric);
      if (data) return data;
    }
  }

  return undefined;
}

export function getMetricAggregationMode(metric: MetricLike): "sum" | "average" | "latest" {
  const label = String(metric.title || metric.name || "").toLowerCase();
  if (/\b(average|avg|mean)\b/.test(label)) return "average";
  if (/\b(total|sum)\b/.test(label)) return "sum";
  return "latest";
}

function sortDataByDateWhenPossible(data: MetricDataPoint[]): MetricDataPoint[] {
  const parsedDates = data.map((item) => parseDateLabel(item.label));
  if (parsedDates.some((date) => !date)) return data;

  return [...data].sort((a, b) => {
    const dateA = parseDateLabel(a.label);
    const dateB = parseDateLabel(b.label);
    return (dateA?.getTime() ?? 0) - (dateB?.getTime() ?? 0);
  });
}

export function aggregateMetricSeries(metric: MetricLike, series: MetricDataPoint[]): number | null {
  const values = series.map((item) => item.value).filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;

  const mode = getMetricAggregationMode(metric);
  if (mode === "sum") {
    return values.reduce((sum, value) => sum + value, 0);
  }
  if (mode === "average") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  const sorted = sortDataByDateWhenPossible(series);
  return sorted.length > 0 ? sorted[sorted.length - 1].value : null;
}

export function formatMetricValue(originalValue: unknown, nextValue: number): string {
  if (typeof originalValue === "string" && originalValue.includes("$")) {
    return `$${nextValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (typeof originalValue === "string" && originalValue.includes("%")) {
    return `${nextValue.toFixed(2)}%`;
  }

  const decimalMatch = typeof originalValue === "string" ? originalValue.match(/\.(\d+)/) : null;
  const fractionDigits = decimalMatch ? Math.min(decimalMatch[1].length, 4) : 0;
  return nextValue.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function filterSeriesByDate(data: MetricDataPoint[], dateRange: DashboardDateRange): MetricDataPoint[] {
  if (!dateRange.from || !dateRange.to) return data;

  return data.filter((item) => {
    const itemDate = parseDateLabel(item.label);
    if (!itemDate) return true;
    return itemDate >= dateRange.from! && itemDate <= dateRange.to!;
  });
}

export function filterDashboardDataByDateRange<T>(data: T, dateRange: DashboardDateRange | undefined): T {
  if (!dateRange?.from || !dateRange?.to || !data) {
    return data;
  }

  const filtered = JSON.parse(JSON.stringify(data)) as DashboardLike;

  if (Array.isArray(filtered.charts)) {
    filtered.charts = filtered.charts.map((chart) => {
      if (!Array.isArray(chart.datasets)) return chart;

      return {
        ...chart,
        datasets: chart.datasets.map((dataset) => {
          if (!Array.isArray(dataset.data)) return dataset;
          return {
            ...dataset,
            data: filterSeriesByDate(dataset.data.map(normalizePoint), dateRange),
          };
        }),
      };
    });
  }

  if (Array.isArray(filtered.metrics)) {
    filtered.metrics = filtered.metrics.map((metric) => {
      const sparklineData = Array.isArray(metric.sparkline_data) && metric.sparkline_data.length > 0
        ? filterSeriesByDate(metric.sparkline_data.map(normalizePoint), dateRange)
        : resolveMetricSparklineData(metric, filtered.charts || []);
      if (!sparklineData || sparklineData.length === 0) return metric;

      const nextValue = aggregateMetricSeries(metric, sparklineData);
      if (nextValue === null) return metric;

      return {
        ...metric,
        value: formatMetricValue(metric.value, nextValue),
        sparkline_data: sparklineData,
      };
    });
  }

  return filtered as T;
}

export function shouldApplyDashboardDateRange(datePreset: string, dateRange: DashboardDateRange | undefined): boolean {
  return datePreset !== "full_range" && Boolean(dateRange?.from && dateRange?.to);
}
