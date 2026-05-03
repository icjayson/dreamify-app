import { useState, useEffect, useMemo, useRef } from "react";
import { Responsive, WidthProvider, Layouts, Layout } from "react-grid-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, AlertCircle, Loader2, ChevronDown, ChevronUp, CalendarIcon, MoreVertical, GripVertical, MessageSquare, ImageDown, Trash2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import ChartRenderer from "@/components/charts/ChartRenderer";
import { useDashboard } from "@/hooks/useDashboard";
import { useChatStore } from "@/chat/useChatStore";
import { DashboardGenerationRequest, LayoutType, ChartType, DashboardConfiguration } from "@/types/dashboard";
import {
  convertLLMStylingToChartStyling,
  validateChartStyling,
  getDefaultChartStyling,
  applyChartStyling,
  getChartStylingClasses,
  getDashboardBackgroundStyle,
  getColorPalette,
  CHART_THEME_COLORS,
  CHART_PRESET_THEMES,
  ChartPresetTheme
} from "@/utils/chartStyling";
import type { ChartChipData } from "@/components/chat/ChartPreviewChip";
import { exportChartAsPng } from "@/utils/exportUtils";

const SELECT_CHART_CONTEXT_EVENT = "dreamify:select-chart-context";

function dashboardComponentToChartChip(component: any): ChartChipData {
  const cfg = component.component_config ?? {};
  const componentId = String(component.id);
  const displayType =
    component.type === "chart"
      ? String(cfg.type ?? "bar")
      : component.type === "metric"
        ? "metric"
        : component.type === "table"
          ? "table"
          : String(cfg.type ?? "bar");
  return {
    id: String(cfg.id ?? component.id),
    componentId,
    title: String(cfg.title ?? "Untitled"),
    type: displayType,
  };
}

interface DashboardPreviewProps {
  dataSource?: string;
  dashboardId?: string;
  className?: string;
  style?: React.CSSProperties;
  processedData?: any;
  staticConfig?: DashboardConfiguration | null;
  isExporting?: boolean;
  onExportLayoutChange?: (didSplit: boolean) => void;
  /** Card ⋮ menu (Fix in chat, …). Only enabled on project workspace; keep false for public preview & exports. */
  showCardActionsMenu?: boolean;
  /** projectId is used to uniquely store layouts for chat-generated (processed) dashboards without a real ID */
  projectId?: string;
}

const DashboardPreview = ({
  dataSource,
  dashboardId,
  className = "",
  style = {},
  processedData,
  staticConfig,
  isExporting = false,
  onExportLayoutChange,
  showCardActionsMenu = false,
  projectId,
}: DashboardPreviewProps) => {
  const [activeSection, setActiveSection] = useState("overview");
  const [expandedInsights, setExpandedInsights] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  // Pass undefined to useDashboard if staticConfig or processedData exists so it doesn't try to fetch
  const { dashboardState, generateDashboard, refreshDashboard, resetDashboard, updateComponent } = useDashboard(staticConfig || processedData ? undefined : dashboardId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Edit feedback loop state from store
  const changedComponentIds = useChatStore((s) => s.changedComponentIds);

  // Track highlight fade-out timer
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [exportingIds, setExportingIds] = useState<Set<string>>(new Set());
  const [removedComponentIds, setRemovedComponentIds] = useState<Set<string>>(new Set());
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  useEffect(() => {
    if (changedComponentIds.size > 0) {
      setHighlightedIds(new Set(changedComponentIds));
      const timer = setTimeout(() => {
        setHighlightedIds(new Set());
        useChatStore.getState().setChangedComponentIds(new Set());
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [changedComponentIds]);

  useEffect(() => {
    if (removedComponentIds.size === 0) return;
    setLayouts(prev => {
      const filterOut = (items: Layout[]) => items.filter(i => !removedComponentIds.has(i.i));
      return { lg: filterOut(prev.lg), md: filterOut(prev.md), sm: filterOut(prev.sm), xs: filterOut(prev.xs), xxs: filterOut(prev.xxs) };
    });
  }, [removedComponentIds]);


  // Determine which configuration to use (static from parent vs fetched from state)
  const configuration = staticConfig || dashboardState.configuration;
  const isLoading = !staticConfig && dashboardState.loading;
  const errorMsg = !staticConfig && dashboardState.error;

  // No automatic dashboard generation on mount

  // Utility function to parse date labels
  const parseDateLabel = (label: string): Date | null => {
    if (!label) return null;
    // Try ISO format first
    const iso = new Date(label);
    if (!isNaN(iso.getTime())) return iso;

    // Try common formats
    const formats = [
      /^(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /^(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
      /^(\d{2})-(\d{2})-(\d{2})$/, // MM-DD-YY
    ];

    for (const format of formats) {
      const match = label.match(format);
      if (match) {
        if (format === formats[0]) {
          // YYYY-MM-DD
          return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        } else if (format === formats[1]) {
          // MM/DD/YYYY
          return new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
        } else if (format === formats[2]) {
          // MM-DD-YY
          const year = parseInt(match[3]) + (parseInt(match[3]) < 50 ? 2000 : 1900);
          return new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));
        }
      }
    }

    return null;
  };

  // Utility function to extract numeric value from formatted string
  const extractNumericValue = (value: string | number): number | null => {
    if (typeof value === 'number') {
      return isFinite(value) ? value : null;
    }
    if (typeof value !== 'string') {
      return null;
    }
    // Remove common formatting: commas, currency symbols, percentage signs, whitespace
    const cleaned = value.replace(/[,\s$€£¥%]/g, '');
    const parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : null;
  };

  // Utility function to extract sparkline data from chart
  const extractSparklineData = (chart: any): Array<{ label: string, value: number }> | undefined => {
    if (!chart) return undefined;

    // Try to get data from first dataset
    if (Array.isArray(chart.datasets) && chart.datasets.length > 0) {
      const firstDataset = chart.datasets[0];
      if (Array.isArray(firstDataset.data) && firstDataset.data.length > 0) {
        return firstDataset.data.map((item: any) => ({
          label: item.label || String(item.label),
          value: typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0
        }));
      }
    }

    return undefined;
  };

  // Utility function to compute time_comparison from sparkline data
  const computeTimeComparisonFromData = (
    sparklineData: Array<{ label: string, value: number }> | undefined,
    currentValue: number | null,
    period: string = 'wow'
  ): { period: string; current_value: number; previous_value: number; percentage_change: number } | null => {
    if (!sparklineData || sparklineData.length < 2) {
      return null;
    }

    // Create a copy and try to sort by date if labels are dates
    let sortedData = [...sparklineData];
    const dates = sortedData.map(item => parseDateLabel(item.label)).filter(d => d !== null);

    if (dates.length === sortedData.length) {
      // All labels are valid dates, sort by date
      sortedData.sort((a, b) => {
        const dateA = parseDateLabel(a.label);
        const dateB = parseDateLabel(b.label);
        if (!dateA || !dateB) return 0;
        return dateA.getTime() - dateB.getTime();
      });
    }

    const latest = sortedData[sortedData.length - 1];
    const previous = sortedData[sortedData.length - 2];

    if (!latest || !previous || typeof latest.value !== 'number' || typeof previous.value !== 'number') {
      return null;
    }

    const current = currentValue !== null && isFinite(currentValue) ? currentValue : latest.value;
    const prev = previous.value;

    if (prev === 0 || !isFinite(current) || !isFinite(prev)) {
      return null;
    }

    const percentageChange = ((current - prev) / prev) * 100;

    return {
      period,
      current_value: current,
      previous_value: prev,
      percentage_change: percentageChange
    };
  };

  // Utility function to find matching chart for metric
  const findMatchingChartForMetric = (metricTitle: string, charts: any[]): any | null => {
    if (!metricTitle || !Array.isArray(charts) || charts.length === 0) return null;

    // Normalize metric title
    const normalizedMetric = metricTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Keywords that might appear in both metric and chart titles
    const keywords = ['revenue', 'users', 'orders', 'sales', 'stickiness', 'active', 'total', 'average', 'count'];

    for (const chart of charts) {
      if (!chart.title) continue;

      const normalizedChart = chart.title.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check if chart has time-series data
      const hasTimeSeriesData = Array.isArray(chart.datasets) &&
        chart.datasets.length > 0 &&
        Array.isArray(chart.datasets[0]?.data) &&
        chart.datasets[0].data.length > 0;

      if (!hasTimeSeriesData) continue;

      // Check for keyword matches
      for (const keyword of keywords) {
        if (normalizedMetric.includes(keyword) && normalizedChart.includes(keyword)) {
          return chart;
        }
      }

      // Check if metric title is a substring of chart title or vice versa
      if (normalizedMetric.length > 3 && (normalizedChart.includes(normalizedMetric) || normalizedMetric.includes(normalizedChart))) {
        return chart;
      }
    }

    return null;
  };

  // Utility function to filter data by date range
  const filterDataByDateRange = (data: any, dateRange: DateRange | undefined): any => {
    if (!dateRange || !dateRange.from || !dateRange.to || !data) {
      return data;
    }

    const filtered = JSON.parse(JSON.stringify(data)); // Deep clone

    // Filter charts
    if (Array.isArray(filtered.charts)) {
      filtered.charts = filtered.charts.map((chart: any) => {
        if (!Array.isArray(chart.datasets)) return chart;

        const filteredChart = { ...chart };
        filteredChart.datasets = chart.datasets.map((dataset: any) => {
          if (!Array.isArray(dataset.data)) return dataset;

          const filteredDataset = { ...dataset };
          filteredDataset.data = dataset.data.filter((item: any) => {
            const itemDate = parseDateLabel(item.label || String(item.label));
            if (!itemDate) return true; // Keep items without valid dates
            return itemDate >= dateRange.from! && itemDate <= dateRange.to!;
          });

          return filteredDataset;
        });

        return filteredChart;
      });
    }

    // Recalculate metrics from filtered chart data
    if (Array.isArray(filtered.metrics)) {
      filtered.metrics = filtered.metrics.map((metric: any) => {
        // Try to find related chart
        let relatedChart = null;
        if (metric.related_chart_id) {
          relatedChart = filtered.charts?.find((c: any) => c.id === metric.related_chart_id);
        } else {
          relatedChart = findMatchingChartForMetric(metric.title || metric.name, filtered.charts || []);
        }

        if (relatedChart && Array.isArray(relatedChart.datasets) && relatedChart.datasets.length > 0) {
          const dataset = relatedChart.datasets[0];
          if (Array.isArray(dataset.data) && dataset.data.length > 0) {
            const values = dataset.data.map((item: any) => {
              const val = typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0;
              return val;
            }).filter((v: number) => !isNaN(v));

            if (values.length > 0) {
              // Recalculate metric value (sum for totals, average for averages)
              const metricTitleLower = (metric.title || metric.name || '').toLowerCase();
              let newValue: number;

              if (metricTitleLower.includes('total') || metricTitleLower.includes('sum')) {
                newValue = values.reduce((sum: number, val: number) => sum + val, 0);
              } else if (metricTitleLower.includes('average') || metricTitleLower.includes('avg') || metricTitleLower.includes('mean')) {
                newValue = values.reduce((sum: number, val: number) => sum + val, 0) / values.length;
              } else {
                // Default to sum
                newValue = values.reduce((sum: number, val: number) => sum + val, 0);
              }

              // Format the value similar to original
              const originalValue = metric.value;
              if (typeof originalValue === 'string' && originalValue.includes('$')) {
                metric.value = `$${newValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              } else if (typeof originalValue === 'string' && originalValue.includes('%')) {
                metric.value = `${newValue.toFixed(2)}%`;
              } else {
                metric.value = newValue.toLocaleString('en-US');
              }
            }
          }
        }

        return metric;
      });
    }

    return filtered;
  };

  const selectedTemplate = useChatStore((s) => s.selectedTemplate);
  const isTemplatePending = useChatStore((s) => s.isTemplatePending);

  // Normalize incoming data (Morpheus-first format)
  const getDashboardStyling = (data: any) => {
    // A pending template is queued for the NEXT generation (toolbar pre-run pick).
    // It must NOT affect the current dashboard's visual theme — only a post-run
    // template change (isTemplatePending=false) should override the theme here.
    const effectiveTemplate = isTemplatePending ? null : selectedTemplate;

    // Materialise styling_recommendations if absent so template override is never silently lost.
    // This covers dashboards generated before styling_recommendations became required.
    if (data && !data.styling_recommendations) {
      data.styling_recommendations = { theme: effectiveTemplate?.suggestedTheme ?? 'monochrome' };
    }
    if (data?.styling_recommendations) {
      // Template theme always takes precedence — the AI may return a generic/default
      // theme when processing @chart updates (no template context in that prompt),
      // so we enforce the chosen template's theme on every render.
      if (effectiveTemplate?.suggestedTheme) {
        data.styling_recommendations.theme = effectiveTemplate.suggestedTheme;
      }

      const converted = convertLLMStylingToChartStyling(data.styling_recommendations);
      const validation = validateChartStyling(converted);

      if (validation.isValid) {
        // Ensure background matches the theme if AI didn't explicitly provide one
        if (!data.styling_recommendations.dashboardBackground && effectiveTemplate?.suggestedTheme) {
          const bg = CHART_THEME_COLORS[effectiveTemplate.suggestedTheme as ChartPresetTheme]?.['bg-dashboard-color'];
          if (bg) converted.dashboardBackground = bg;
        }
        return converted;
      }
    }

    // Fallback to effective template's theme if AI didn't return one or it's invalid
    if (effectiveTemplate?.suggestedTheme) {
      return getDefaultChartStyling(effectiveTemplate.suggestedTheme as ChartPresetTheme);
    }

    return getDefaultChartStyling(CHART_PRESET_THEMES.DEFAULT);
  };

  // Common key aliases for label (category/name) and value (numeric)
  const LABEL_KEYS = ['label', 'name', 'Category', 'Name', 'Label', 'category', 'key', 'Key'];
  const VALUE_KEYS = ['value', 'Value', 'Revenue', 'Amount', 'Count', 'revenue', 'amount', 'count', 'Total'];

  const inferLabelFromPoint = (point: any): string => {
    for (const k of LABEL_KEYS) {
      if (point[k] != null && typeof point[k] === 'string') return String(point[k]);
    }
    for (const [k, v] of Object.entries(point)) {
      if (v != null && typeof v === 'string' && k !== 'metadata') return String(v);
    }
    return '';
  };

  const inferValueFromPoint = (point: any): number => {
    for (const k of VALUE_KEYS) {
      const v = point[k];
      if (typeof v === 'number') return v;
      if (v != null && typeof v === 'string' && !Number.isNaN(parseFloat(v))) return parseFloat(v);
    }
    for (const [k, v] of Object.entries(point)) {
      if (typeof v === 'number') return v;
      if (v != null && typeof v === 'string' && !Number.isNaN(parseFloat(v))) return parseFloat(v);
    }
    return 0;
  };

  const normalizeChartDataPoints = (dataPoints: any[], chartType: string): any[] => {
    // For all chart types, ensure we have label and value keys
    return dataPoints.map(point => ({
      ...point,
      label: point.label ?? point.name ?? inferLabelFromPoint(point),
      value: point.value !== undefined && point.value !== null
        ? (typeof point.value === 'number' ? point.value : parseFloat(String(point.value)) || 0)
        : inferValueFromPoint(point)
    }));
  };

  const normalizeChartDatasets = (datasets: any[], chartType: string, config: any): any[] => {
    if (!Array.isArray(datasets) || datasets.length === 0) return [];

    return datasets.map((dataset: any) => {
      // Handle treemap: convert children array to data array
      if (chartType === 'treemap' && Array.isArray(dataset.children)) {
        return {
          ...dataset,
          data: dataset.children.map((child: any) => ({
            label: child.name || child.label || '',
            value: typeof child.value === 'number' ? child.value : parseFloat(String(child.value)) || 0
          }))
        };
      }

      // Handle radar: convert numeric array to objects with label/value
      if (chartType === 'radar' && Array.isArray(dataset.data)) {
        const labels = config?.labels || [];
        // Check if data is array of numbers (not objects)
        if (dataset.data.length > 0 && typeof dataset.data[0] === 'number') {
          return {
            ...dataset,
            data: dataset.data.map((value: number, index: number) => ({
              label: labels[index] || `Label ${index + 1}`,
              value: typeof value === 'number' ? value : parseFloat(String(value)) || 0
            }))
          };
        }
      }

      // Normalize data points for all chart types that have a data array
      if (Array.isArray(dataset.data)) {
        return {
          ...dataset,
          data: normalizeChartDataPoints(dataset.data, chartType)
        };
      }

      // Default: return dataset as-is
      return dataset;
    });
  };

  const normalizeDashboard = (data: any, overrideId?: string) => {
    if (!data) return null;
    const components: any[] = [];
    let componentId = 1;

    // Dashboard-level styling (light theme from backend)
    const dashboardStyling = getDashboardStyling(data);
    const dashboardTile: any = (dashboardStyling as any)?.tile;
    // Template always wins — override every component's presetTheme with the dashboard-level value
    const resolvedPresetTheme: string | undefined = (dashboardStyling as any)?.presetTheme;

    // Metrics (Morpheus: name -> title, optional change/trend)
    if (Array.isArray(data.metrics)) {
      data.metrics.forEach((m: any, idx: number) => {
        // Extract numeric value from formatted string
        const numericValue = extractNumericValue(m.value);

        // Extract sparkline data first (needed for time_comparison computation)
        let sparklineData: Array<{ label: string, value: number }> | undefined;

        // Priority 1: Direct sparkline data from LLM
        if (m.sparkline_data && Array.isArray(m.sparkline_data)) {
          sparklineData = m.sparkline_data.map((item: any) => ({
            label: item.label || String(item.label),
            value: typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0
          }));
        }
        // Priority 2: Related chart ID
        else if (m.related_chart_id) {
          const relatedChart = data.charts?.find((c: any) => c.id === m.related_chart_id);
          if (relatedChart) {
            sparklineData = extractSparklineData(relatedChart);
          }
        }
        // Priority 3: Heuristic matching (fallback)
        else {
          const matchingChart = findMatchingChartForMetric(m.title || m.name, data.charts || []);
          if (matchingChart) {
            sparklineData = extractSparklineData(matchingChart);
          }
        }

        // Compute time_comparison if missing
        let timeComparison = m.time_comparison;
        if (!timeComparison && sparklineData && sparklineData.length >= 2) {
          const computed = computeTimeComparisonFromData(sparklineData, numericValue, m.time_comparison?.period);
          if (computed) {
            timeComparison = computed;
          }
        }

        // Derive change and trend from time_comparison or existing logic
        const prev = timeComparison?.previous_value;
        let change: string | number | undefined = m.change;
        let trend: string | undefined = m.trend;

        // Priority 1: Use time_comparison.percentage_change if available
        if (timeComparison?.percentage_change !== undefined && timeComparison.percentage_change !== null) {
          const pct = timeComparison.percentage_change;
          change = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
          trend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable';
        }
        // Priority 2: Compute from time_comparison values if available
        else if (numericValue !== null && typeof prev === 'number' && prev !== 0) {
          const pct = ((numericValue - prev) / prev) * 100;
          change = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
          trend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable';
        }
        // Priority 3: Use provided change/trend if available
        else if (change === undefined || change === null) {
          // Keep change and trend as undefined if we can't compute
        }

        const layout = m?.layout;
        const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);
        // Convert metric styling if it has theme property
        const metricStyling = m.styling ? convertLLMStylingToChartStyling(m.styling) : undefined;
        const validatedMetricStyling = metricStyling && validateChartStyling(metricStyling).isValid
          ? metricStyling
          : (dashboardStyling || getDefaultChartStyling());

        components.push({
          id: `metric_${componentId++}`,
          type: 'metric',
          position: hasLayout
            ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
            : { x: (idx % 4) * 3, y: Math.floor(idx / 4) * 2, width: 3, height: 2 },
          layout: hasLayout ? { ...layout } : undefined,
          component_config: {
            id: m.id || `metric_${idx + 1}`,
            title: m.title || m.name || 'Metric',
            value: m.value,
            change,
            trend,
            data: sparklineData,
            dataKey: 'value',
            timeComparison: timeComparison,
            // Convert and merge styling with dashboard defaults
            styling: {
              ...validatedMetricStyling,
              ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
              tile: {
                ...(dashboardTile || {}),
                ...((validatedMetricStyling as any)?.tile || {})
              }
            }
          }
        });
      });
    }

    // Charts (Morpheus: chart_type + config axis)
    const typeMap: Record<string, string> = {
      // Direct mappings for current LLM output
      line: 'line',
      bar: 'bar',
      stacked_bar: 'stacked_bar',
      stacked_column: 'stacked_column',
      pie: 'pie',
      area: 'area',
      scatter: 'scatter',
      composed: 'composed',
      radar: 'radar',
      radial_bar: 'radial_bar',
      funnel: 'funnel',
      treemap: 'treemap',
      sankey: 'sankey',
      donut: 'donut',
      geographic: 'geographic',
      table: 'table',
      metric: 'metric',

      // Legacy mappings for backward compatibility
      line_chart: 'line',
      bar_chart: 'bar',
      pie_chart: 'pie',
      area_chart: 'area',
      scatter_chart: 'scatter',
      composed_chart: 'composed',
      radar_chart: 'radar',
      radial_bar_chart: 'radial_bar',
      funnel_chart: 'funnel',
      treemap_chart: 'treemap',
      sankey_chart: 'sankey',
      donut_chart: 'donut'
    };
    if (Array.isArray(data.charts)) {
      data.charts.forEach((c: any, idx: number) => {
        const mappedType = typeMap[(c.chart_type || '').toLowerCase()] || 'line';

        // Handle tables in charts array - they need special processing
        if (mappedType === 'table') {
          const tableStyling = c.styling ? convertLLMStylingToChartStyling(c.styling) : undefined;
          const validatedTableStyling = tableStyling && validateChartStyling(tableStyling).isValid
            ? tableStyling
            : (dashboardStyling || getDefaultChartStyling());

          const layout = c?.layout;
          const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);

          components.push({
            id: `table_${componentId++}`,
            type: 'table',
            position: hasLayout
              ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
              : { x: 0, y: Math.floor(idx / 2) * 6 + 6, width: 12, height: 3 },
            layout: hasLayout ? { ...layout } : undefined,
            component_config: {
              id: c.id || `table_${idx + 1}`,
              title: c.title || 'Table',
              description: c.description || '',
              columns: Array.isArray(c.columns) ? c.columns : [],
              data: Array.isArray(c.data) ? c.data : (Array.isArray(c.rows) ? c.rows : []),
              styling: {
                ...validatedTableStyling,
                ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
                tile: {
                  ...(dashboardTile || {}),
                  ...((validatedTableStyling as any)?.tile || {})
                }
              }
            }
          });
          return; // Skip chart processing for tables
        }

        // Regular chart processing
        const chartLevelStyling = c.styling ? convertLLMStylingToChartStyling(c.styling) : undefined;
        const validatedChartStyling = chartLevelStyling && validateChartStyling(chartLevelStyling).isValid
          ? chartLevelStyling
          : (dashboardStyling || getDefaultChartStyling());
        // merge dashboard tile defaults; template presetTheme always wins
        const mergedChartStyling: any = {
          ...validatedChartStyling,
          ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
          tile: {
            ...(dashboardTile || {}),
            ...((chartLevelStyling as any)?.tile || {})
          }
        };

        const layout = c?.layout;
        const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);

        // Normalize datasets based on chart type
        const normalizedDatasets = Array.isArray(c.datasets)
          ? normalizeChartDatasets(c.datasets, mappedType, c.config || {})
          : [];

        components.push({
          id: `chart_${componentId++}`,
          type: 'chart',
          position: hasLayout
            ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
            : { x: (idx % 2) * 6, y: Math.floor(idx / 2) * 4 + 2, width: 6, height: 4 },
          layout: hasLayout ? { ...layout } : undefined,
          component_config: {
            id: c.id || `chart_${idx + 1}`,
            type: mappedType,
            title: c.title || 'Chart',
            description: c.description || '',
            insight: c.reasoning?.insight || '',
            axisConfig: c.config || { xKey: 'label', yKey: 'value' },
            datasets: normalizedDatasets,
            data: c.data,
            config: c.config || {},
            styling: mergedChartStyling
          }
        });
      });
    }

    // Tables (Morpheus: columns string[] + rows objects)
    // Check both top-level and nested data.tables
    const tablesToProcess = Array.isArray(data.tables) ? data.tables :
      (data.data && Array.isArray(data.data.tables)) ? data.data.tables : [];

    if (tablesToProcess.length > 0) {
      tablesToProcess.forEach((t: any, idx: number) => {
        const layout = t?.layout;
        const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);
        // Convert table styling if it has theme property
        const tableStyling = t.styling ? convertLLMStylingToChartStyling(t.styling) : undefined;
        const validatedTableStyling = tableStyling && validateChartStyling(tableStyling).isValid
          ? tableStyling
          : (dashboardStyling || getDefaultChartStyling());

        components.push({
          id: `table_${componentId++}`,
          type: 'table',
          position: hasLayout
            ? { x: layout.x, y: layout.y, width: layout.w, height: layout.h }
            : { x: 0, y: Math.floor(idx / 2) * 6 + 6, width: 12, height: 3 },
          layout: hasLayout ? { ...layout } : undefined,
          component_config: {
            id: t.id || `table_${idx + 1}`,
            title: t.title || 'Table',
            description: t.description || '',
            columns: Array.isArray(t.columns) ? t.columns : [],
            data: Array.isArray(t.data) ? t.data : (Array.isArray(t.rows) ? t.rows : []),
            // Convert and merge styling with dashboard defaults; template presetTheme always wins
            styling: {
              ...validatedTableStyling,
              ...(resolvedPresetTheme ? { presetTheme: resolvedPresetTheme } : {}),
              tile: {
                ...(dashboardTile || {}),
                ...((validatedTableStyling as any)?.tile || {})
              }
            }
          }
        });
      });
    }

    const gridColumns = data?.layout?.recommended_grid?.length ? 12 : 12;
    const dashboardConfig = {
      id: overrideId || 'processed_dashboard',
      layout: { type: 'grid', grid_columns: gridColumns, grid_rows: 20 },
      components
    };
    return dashboardConfig;
  };

  // Apply dashboard-level styling to container
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dashboardStylingForContainer = useMemo(() => getDashboardStyling(processedData), [processedData, selectedTemplate]);

  const effectiveStyling = useMemo(() => {
    const base = dashboardStylingForContainer || getDefaultChartStyling();
    // Static config preview (template gallery) — derive theme from config components
    if (staticConfig && !processedData) {
      const configTheme = (staticConfig.components[0]?.component_config as any)?.styling?.presetTheme;
      if (configTheme && CHART_THEME_COLORS[configTheme as ChartPresetTheme]) {
        return getDefaultChartStyling(configTheme as ChartPresetTheme);
      }
    }
    return base;
  }, [dashboardStylingForContainer, staticConfig, processedData]);

  useEffect(() => {
    if (containerRef.current && effectiveStyling) {
      applyChartStyling(containerRef.current, effectiveStyling);
    }
  }, [effectiveStyling]);

  // Helper function to get dashboard theme styles as inline CSS properties
  const getDashboardThemeStyles = (styling: any): React.CSSProperties => {
    if (!styling) return {};
    const theme = styling.presetTheme as ChartPresetTheme;
    const themeColors = CHART_THEME_COLORS[theme] || CHART_THEME_COLORS.monochrome;
    return {
      backgroundColor: themeColors['bg-card-color'],
      borderColor: themeColors['border-card-color'],
      color: themeColors['title-color'],
    };
  };

  // Filter processedData by date range
  const filteredProcessedData = useMemo(() => {
    const dataToFilter = processedData || (configuration && !configuration.components ? configuration : null);
    if (!dataToFilter) return null;
    return filterDataByDateRange(dataToFilter, dateRange);
  }, [processedData, configuration, dateRange]);

  // Grid layout config
  const ResponsiveGridLayout = useMemo(() => WidthProvider(Responsive), []);
  const breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
  const cols = { lg: 24, md: 12, sm: 8, xs: 4, xxs: 2 } as const;
  const margin: [number, number] = [6, 6];
  const containerPadding: [number, number] = [6, 6];
  const rowHeight = 30;

  // Build normalized dashboards and active selection
  const normalizedProcessed = useMemo(() => filteredProcessedData ? normalizeDashboard(filteredProcessedData, dashboardId) : null, [filteredProcessedData, dashboardId]);
  const activeDashboard = useMemo(() => {
    if (normalizedProcessed) return normalizedProcessed;
    if (configuration && configuration.components) return configuration as any;
    return null;
  }, [normalizedProcessed, configuration]);

  const displayComponents = useMemo(() => {
    if (!activeDashboard?.components) return [];
    // Static config already has theme applied per-component via applyVisualSpec — don't override
    const base = (staticConfig && !processedData)
      ? activeDashboard.components
      : (() => {
          const theme = effectiveStyling?.presetTheme;
          if (!theme) return activeDashboard.components;
          // Derive a fresh palette from the current theme so stored palettes from old/different
          // themes (e.g. light-gray colors from the old dark default) don't become invisible.
          const palette = getColorPalette(theme as ChartPresetTheme, 10);
          return activeDashboard.components.map((comp: any) => ({
            ...comp,
            component_config: {
              ...comp.component_config,
              styling: {
                ...comp.component_config?.styling,
                presetTheme: theme,
                colorPalette: palette,
              }
            }
          }));
        })();
    return base.filter((c: any) => !removedComponentIds.has(String(c.id)));
  }, [activeDashboard?.components, effectiveStyling, staticConfig, processedData, removedComponentIds]);

  // Helpers to build layouts per component list
  const getMinSizeForType = (type: string) => {
    if (type === 'metric') return { minW: 2, minH: 2 };
    if (type === 'table') return { minW: 12, minH: 8 };
    return { minW: 4, minH: 8 }; // default for charts
  };

  const componentsToBaseLayout = (components: any[]): Layout[] => {
    return components.map((c: any, index: number) => {
      const typeMin = getMinSizeForType(c.type);
      const src = c.layout || {};
      const x = Number.isFinite(src.x) ? src.x : (Number.isFinite(c.position?.x) ? c.position.x : (index % 12));
      const y = Number.isFinite(src.y) ? src.y : (Number.isFinite(c.position?.y) ? c.position.y : Math.floor(index / 12));
      const w = Number.isFinite(src.w) ? src.w : (Number.isFinite(c.position?.width) ? c.position.width : 4);

      // Calculate dynamic height for tables if not explicitly provided
      let h = Number.isFinite(src.h) ? src.h : (Number.isFinite(c.position?.height) ? c.position.height : 10);

      if (c.type === 'table' && c.component_config?.data) {
        const rowCount = Array.isArray(c.component_config.data) ? c.component_config.data.length : 0;
        if (rowCount > 0) {
          // Base overhead (header, title, padding) ~ 6 units
          // Each row ~ 1.5 units
          // Cap at 21 (approx 10 rows)
          const calculatedH = Math.ceil(6 + (Math.min(rowCount, 10) * 1.5));
          // Use calculated height if it's larger than provided height, or if no height provided
          // This ensures we show up to 10 rows by default while respecting larger user overrides if they exist
          h = Number.isFinite(src.h) ? Math.max(src.h, calculatedH) : (Number.isFinite(c.position?.height) ? Math.max(c.position.height, calculatedH) : calculatedH);
        }
      }

      // Enforce content-driven minima for first render if provided by backend; otherwise type defaults
      const minW = Number.isFinite(src.minW) ? src.minW : typeMin.minW;
      const minH = Number.isFinite(src.minH) ? src.minH : typeMin.minH;
      return { i: String(c.id), x, y, w, h, minW, minH, static: false } as Layout;
    });
  };

  const scaleLayoutForCols = (layout: Layout[], fromCols: number, toCols: number): Layout[] => {
    return layout.map((item) => {
      const scaledW = Math.max(1, Math.round((item.w * toCols) / fromCols));
      let scaledX = Math.round((item.x * toCols) / fromCols);
      // clamp to ensure the item fits within the target column count
      if (scaledX + scaledW > toCols) {
        scaledX = Math.max(0, toCols - scaledW);
      }
      const scaledMinW = item.minW ? Math.max(1, Math.round((item.minW * toCols) / fromCols)) : item.minW;
      return { ...item, x: scaledX, w: scaledW, minW: scaledMinW } as Layout;
    });
  };

  const reformatLayoutForExport = (layout: Layout[]): { reformatted: Layout[], didSplit: boolean } => {
    // Logic for splitting into 2 columns has been removed.
    // Return original layout as a single vertical column.
    return { reformatted: layout, didSplit: false };
  };

  const buildLayoutsFromComponents = (components: any[] | undefined | null, isExportingMode: boolean): { layouts: Layouts, didSplit: boolean } => {
    let baseLg = components ? componentsToBaseLayout(components) : [];
    let didSplit = false;

    if (isExportingMode) {
      const result = reformatLayoutForExport(baseLg);
      baseLg = result.reformatted;
      didSplit = result.didSplit;
    }

    return {
      layouts: {
        lg: baseLg,
        md: scaleLayoutForCols(baseLg, 24, 12),
        sm: scaleLayoutForCols(baseLg, 24, 8),
        xs: scaleLayoutForCols(baseLg, 24, 4),
        xxs: scaleLayoutForCols(baseLg, 24, 2)
      } as Layouts,
      didSplit
    };
  };

  // Bump version when grid behavior changes (e.g. compactType) so we don't reuse
  // layouts saved under older compaction logic.
  const storageKey = useMemo(() => {
    const baseId = activeDashboard?.id || 'processed_dashboard';
    // Append projectId for "processed_dashboard" to prevent layout collisions between different projects
    const suffix = (baseId === 'processed_dashboard' && projectId) ? `_${projectId}` : '';
    return `dashboard_layout_${baseId}${suffix}_v5`;
  }, [activeDashboard?.id, projectId]);

  const [layouts, setLayouts] = useState<Layouts>({ lg: [], md: [], sm: [], xs: [], xxs: [] });
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  // Compaction is what makes RGL "pack" tiles upward.
  // We suppress compaction when applying a brand-new dashboard layout (e.g. chart edits coming from chat),
  // because that can re-pack other tiles and break top KPI positions.
  // Once the user manually drags/resizes, we restore compaction so drag/drop behaves normally.
  const [compactTypeMode, setCompactTypeMode] = useState<"none" | "vertical">("vertical");

  // Initialize or update layouts when active dashboard changes
  useEffect(() => {
    setIsLayoutReady(false);
    if (!activeDashboard) {
      setLayouts({ lg: [], md: [], sm: [], xs: [], xxs: [] });
      return;
    }

    const initialResult = buildLayoutsFromComponents(activeDashboard.components, isExporting);
    // New layout coming from backend/chat: suppress compaction during this render.
    setCompactTypeMode("none");

    // Skip local storage layouts entirely if exporting to force our reflow layout
    if (isExporting) {
      setLayouts(initialResult.layouts);
      if (onExportLayoutChange) {
        onExportLayoutChange(initialResult.didSplit);
      }
      setIsLayoutReady(true);
      return;
    }

    // Try to restore saved layouts for persisted dashboards (even processed ones with a legitimate ID)
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Layouts;

        // Validation: Verify if the saved layouts still match the components we have.
        // If the LLM generates 5 totally new charts but the saved layout has 2 layout boxes, we must use initial.
        // Compare the keys in the 'lg' array.
        const activeComponentIds = new Set(activeDashboard.components.map((c: any) => String(c.id)));
        const savedComponentIds = new Set(parsed.lg?.map((item) => item.i));

        // Check if there's significant overlap. Fast heuristic: do they differ in size, or missing required IDs?
        let isValid = true;
        for (const id of activeComponentIds) {
          if (!savedComponentIds.has(id)) {
            isValid = false;
            break;
          }
        }

        if (isValid) {
          setLayouts(parsed);
          setIsLayoutReady(true);
          return;
        }
      }
    } catch (_e) {
      // ignore parse errors and fall back to initial
    }

    // Default to the backend's generated layout if storage fails or layout is deemed invalidated.
    setLayouts(initialResult.layouts);
    setIsLayoutReady(true);
  }, [activeDashboard, storageKey, isExporting]);

  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('lg');

  const handleLayoutChange = (current: Layout[], all: Layouts) => {
    if (!isLayoutReady) return;
    setLayouts(all);
    // Persist per dashboard id
    try {
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch (_e) { /* ignore */ }

    // Sync back to dashboard state only when using real configuration
    if (!processedData && dashboardState.configuration && updateComponent) {
      const byId = new Map(current.map((item) => [item.i, item]));
      dashboardState.configuration.components.forEach((comp) => {
        const l = byId.get(String(comp.id));
        if (l) {
          updateComponent(comp.id, { position: { x: l.x, y: l.y, width: l.w, height: l.h, minW: l.minW, minH: l.minH } });
        }
      });
    }
  };

  const handleDragResizeStop = (current: Layout[], oldItem: any, newItem: any) => {
    if (!isLayoutReady) return;
    const currentCols = cols[currentBreakpoint as keyof typeof cols] || 24;
    const scaledAll = { ...layouts };

    scaledAll.lg = currentBreakpoint === 'lg' ? current : scaleLayoutForCols(current, currentCols, cols.lg);
    scaledAll.md = currentBreakpoint === 'md' ? current : scaleLayoutForCols(current, currentCols, cols.md);
    scaledAll.sm = currentBreakpoint === 'sm' ? current : scaleLayoutForCols(current, currentCols, cols.sm);
    scaledAll.xs = currentBreakpoint === 'xs' ? current : scaleLayoutForCols(current, currentCols, cols.xs);
    scaledAll.xxs = currentBreakpoint === 'xxs' ? current : scaleLayoutForCols(current, currentCols, cols.xxs);

    setLayouts(scaledAll);
    try {
      localStorage.setItem(storageKey, JSON.stringify(scaledAll));
    } catch (_e) { /* ignore */ }
  };

  const handleBreakpointChange = (newBreakpoint: string) => {
    setCurrentBreakpoint(newBreakpoint);
  };

  // Handle refresh
  const handleRefresh = async () => {
    if (dashboardState.configuration) {
      await refreshDashboard({
        dashboard_id: dashboardState.configuration.id,
        force_refresh: true
      });
    } else {
      // Regenerate dashboard
      const request: DashboardGenerationRequest = {
        data_source: dataSource,
        layout_preference: LayoutType.GRID,
        chart_types: [ChartType.LINE, ChartType.BAR, ChartType.METRIC, ChartType.TABLE, ChartType.GEOGRAPHIC],
        metadata: {
          title: "eCommerce Sales Dashboard",
        }
      };
      generateDashboard(request);
    }
  };

  // Handle component refresh
  const handleComponentRefresh = async (componentId: string) => {
    if (dashboardState.configuration) {
      await refreshDashboard({
        dashboard_id: dashboardState.configuration.id,
        force_refresh: true
      });
    }
  };

  // Handle component error
  const handleComponentError = (error: Error, component: any) => {
    console.error('Chart component error:', error, component);
  };

  // Extract dashboard metadata (handle both nested and top-level dashboard object)
  const dashboardMetadata = useMemo(() => {
    // Try top-level first (correct structure)
    if (processedData?.dashboard) {
      return {
        title: processedData.dashboard.title,
        description: processedData.dashboard.description,
        styling: processedData.dashboard.styling,
        insights: processedData.insights || []
      };
    }
    // Fallback to nested structure (if backend wraps it)
    if (processedData?.data?.dashboard) {
      return {
        title: processedData.data.dashboard.title,
        description: processedData.data.dashboard.description,
        styling: processedData.data.dashboard.styling,
        insights: processedData.data.insights || processedData.insights || []
      };
    }
    return null;
  }, [processedData]);

  return (
    <div
      ref={containerRef}
      id={isExporting ? "dashboard-export-inner-root" : "dashboard-preview-root"}
      data-dashboard-root
      className={`h-full overflow-y-auto relative chat-scrollbar-hide ${getChartStylingClasses(effectiveStyling || getDefaultChartStyling() as any)} ${className}`}
      style={{
        ...style,
        ...getDashboardBackgroundStyle(effectiveStyling || getDefaultChartStyling())
      }}
      data-theme="dashboard-preview"
    >
      {/* Dashboard Header with Title and Description */}
      {dashboardMetadata && (
        <div className="px-6 pt-6 pb-4" style={{ borderColor: 'var(--border-card-color)' }}>
          <div className="flex flex-col gap-2">
            {/* Row 1: Title and Controls */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1 w-full">
                <h1
                  className="text-2xl md:text-3xl font-bold"
                  style={{ color: 'var(--highlight-color)' }}
                >
                  {dashboardMetadata.title}
                </h1>
                {dashboardMetadata.description && (
                  <p
                    className="text-sm md:text-base opacity-90 mt-1"
                    style={{ color: 'var(--description-color)' }}
                  >
                    {dashboardMetadata.description}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-start gap-2 flex-shrink-0 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
                {/* Date Picker - Hide when exporting */}
                {!isExporting && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="flex items-center gap-2 px-3 py-1.5 h-9 text-sm rounded-md border hover:opacity-80 transition-opacity"
                        style={{
                          color: 'var(--highlight-color)',
                          backgroundColor: 'var(--bg-card-color)',
                          borderColor: 'var(--border-card-color)'
                        }}
                      >
                        <CalendarIcon className="w-4 h-4" />
                        <span>
                          {dateRange?.from ? (
                            dateRange.to ? (
                              <>
                                {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
                              </>
                            ) : (
                              format(dateRange.from, "MMM dd, yyyy")
                            )
                          ) : (
                            "Select Dates"
                          )}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className={`w-auto p-0 [&]:!bg-[var(--bg-card-color)] ${getChartStylingClasses(effectiveStyling || getDefaultChartStyling() as any)}`}
                      align="end"
                      style={getDashboardThemeStyles(effectiveStyling)}
                    >
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={dateRange?.from}
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                        themeStyles={getDashboardThemeStyles(effectiveStyling)}
                      />
                    </PopoverContent>
                  </Popover>
                )}
                {/* Key Insights Button - Hide when exporting */}
                {!isExporting && dashboardMetadata.insights && dashboardMetadata.insights.length > 0 && (
                  <button
                    onClick={() => setExpandedInsights(!expandedInsights)}
                    className="flex items-center justify-start gap-2 px-3 py-1.5 h-9 text-sm rounded-md border hover:opacity-80 transition-opacity flex-shrink-0"
                    style={{
                      color: 'var(--highlight-color)',
                      backgroundColor: 'var(--bg-card-color)',
                      borderColor: 'var(--border-card-color)'
                    }}
                  >
                    <span className="text-sm font-medium">Key Insights</span>
                    {expandedInsights ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
            {/* Expanded Insights List - Always show when exporting */}
            {dashboardMetadata?.insights && dashboardMetadata.insights.length > 0 && (expandedInsights || isExporting) && (
              <div className="w-full mt-2">
                <h2
                  className="text-lg font-medium mb-2"
                  style={{ color: 'var(--description-color)' }}
                >
                  Key Insights
                </h2>
                <ul className="space-y-2">
                  {dashboardMetadata.insights.map((insight: string, index: number) => (
                    <li
                      key={index}
                      className="flex items-start gap-2"
                    >
                      <span
                        className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: 'var(--highlight-color)' }}
                      />
                      <span
                        className="text-sm"
                        style={{ color: 'var(--highlight-color)' }}
                      >
                        {insight}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}


      {/* Main Dashboard Content */}
      <div className="p-6">
        {/* Loading State */}
        {dashboardState.loading && !dashboardState.configuration && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-4">
              <Loader2 className="h-8 w-8 animate-spin mx-auto" />
              <p className="text-muted-foreground">Generating dashboard...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {dashboardState.error && !dashboardState.configuration && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {dashboardState.error}
            </AlertDescription>
          </Alert>
        )}

        {/* Responsive Drag & Resize Grid */}
        {activeDashboard && isLayoutReady && (
          <div className="space-y-6">
            {isExporting ? (
              <Responsive
                className="layout"
                layouts={layouts}
                breakpoints={breakpoints}
                cols={{ lg: 24, md: 24, sm: 24, xs: 24, xxs: 24 }} // Force a 24-col grid for a single vertical page
                margin={margin}
                containerPadding={containerPadding}
                rowHeight={rowHeight}
                width={typeof window !== 'undefined' ? Math.max(window.innerWidth, 1200) : 1200} // Single screen width
                isDraggable={false}
                isResizable={false}
                preventCollision
                isBounded
                compactType={null}
              >
                {displayComponents.map((component: any) => (
                  <div key={String(component.id)} className="animate-fade-in">
                    <ChartRenderer
                      component={component}
                      onError={handleComponentError}
                    />
                  </div>
                ))}
              </Responsive>
            ) : (
              <ResponsiveGridLayout
                className="layout"
                layouts={layouts}
                breakpoints={breakpoints}
                cols={cols}
                margin={margin}
                containerPadding={containerPadding}
                rowHeight={rowHeight}
                isDraggable
                isResizable
                compactType={compactTypeMode === "none" ? null : "vertical"}
                resizeHandles={['se', 'e', 's', 'w', 'n']}
                {...(showCardActionsMenu ? { draggableCancel: ".dashboard-card-menu-trigger" } : {})}
                onLayoutChange={handleLayoutChange}
                onBreakpointChange={handleBreakpointChange}
                onDragStart={() => setCompactTypeMode("vertical")}
                onResizeStart={() => setCompactTypeMode("vertical")}
                onDragStop={handleDragResizeStop}
                onResizeStop={handleDragResizeStop}
              >
                {displayComponents.map((component: any) => {
                  const compId = component.component_config?.id || component.id;
                  const isHighlighted = highlightedIds.has(String(compId)) || highlightedIds.has(String(component.id));
                  const cellKey = String(component.id);
                  return (
                    <div key={cellKey} className={`animate-fade-in h-full min-h-0 ${isHighlighted ? 'dashboard-component-highlight' : ''}`}>
                      <div className="relative h-full min-h-0 rounded-md group/card transition-all duration-200 hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_4px_16px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_4px_16px_rgba(0,0,0,0.25)]" data-chart-id={cellKey}>
                        {showCardActionsMenu && (
                          <div
                            className="absolute left-2 top-2 z-20 opacity-0 group-hover/card:opacity-40 transition-opacity duration-150 pointer-events-none"
                            aria-hidden="true"
                          >
                            <GripVertical className="h-3.5 w-3.5 text-white" strokeWidth={2} />
                          </div>
                        )}
                        {showCardActionsMenu && (
                          <div
                            className="dashboard-card-menu-trigger absolute right-2 top-2 z-20 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150"
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Card actions"
                                  className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/50 dark:border-white/10 dark:bg-black/30 text-foreground/80 dark:text-white/80 backdrop-blur-sm outline-none transition-colors hover:bg-muted dark:hover:bg-black/55 hover:text-foreground dark:hover:text-white focus-visible:ring-2 focus-visible:ring-primary/30"
                                >
                                  <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                sideOffset={6}
                                className="min-w-[11rem] rounded-xl border border-border dark:border-white/10 bg-popover/95 dark:bg-[#161616]/95 backdrop-blur-md text-popover-foreground dark:text-white shadow-xl"
                              >
                                <DropdownMenuItem
                                  className="cursor-pointer gap-2 py-2 focus:bg-muted dark:focus:bg-white/10 focus:text-foreground dark:focus:text-white"
                                  onSelect={() => {
                                    window.dispatchEvent(
                                      new CustomEvent(SELECT_CHART_CONTEXT_EVENT, {
                                        detail: dashboardComponentToChartChip(component),
                                      })
                                    );
                                  }}
                                >
                                  <MessageSquare className="h-4 w-4 shrink-0 text-purple-400" />
                                  Fix in chat
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="cursor-pointer gap-2 py-2 focus:bg-muted dark:focus:bg-white/10 focus:text-foreground dark:focus:text-white"
                                  disabled={exportingIds.has(cellKey)}
                                  onSelect={async () => {
                                    const cardEl = document.querySelector<HTMLElement>(
                                      `[data-chart-id="${cellKey}"]`
                                    );
                                    if (!cardEl) return;
                                    setExportingIds(prev => new Set(prev).add(cellKey));
                                    try {
                                      const chartTitle = component.component_config?.title || 'chart';
                                      await exportChartAsPng(cardEl, chartTitle);
                                    } finally {
                                      setExportingIds(prev => {
                                        const next = new Set(prev);
                                        next.delete(cellKey);
                                        return next;
                                      });
                                    }
                                  }}
                                >
                                  {exportingIds.has(cellKey)
                                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                                    : <ImageDown className="h-4 w-4 shrink-0 text-emerald-400" />}
                                  Export to PNG
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-border dark:bg-white/10" />
                                <DropdownMenuItem
                                  className="cursor-pointer gap-2 py-2 text-red-400 focus:bg-red-500/15 focus:text-red-400"
                                  onSelect={() => setConfirmRemoveId(cellKey)}
                                >
                                  <Trash2 className="h-4 w-4 shrink-0" />
                                  Remove chart
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                        <ChartRenderer
                          component={component}
                          onError={handleComponentError}
                        />
                      </div>
                    </div>
                  );
                })}
              </ResponsiveGridLayout>
            )}
          </div>
        )}

        {!processedData && !configuration && !dashboardState.loading && !dashboardState.error && (
          <div className="space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No dashboard configuration available. Generate a dashboard or upload data to get started.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
      <AlertDialog open={confirmRemoveId !== null} onOpenChange={(open) => { if (!open) setConfirmRemoveId(null); }}>
        <AlertDialogContent className="border-border dark:border-white/15 bg-background dark:bg-[#1a1a1a] text-foreground dark:text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove chart?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground dark:text-white/60">
              This chart will be removed from the dashboard. This cannot be undone in the current session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border dark:border-white/15 bg-transparent text-foreground dark:text-white hover:bg-black/5 dark:hover:bg-white/10 font-medium">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (confirmRemoveId) {
                  setRemovedComponentIds(prev => new Set(prev).add(confirmRemoveId));
                  setConfirmRemoveId(null);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DashboardPreview;