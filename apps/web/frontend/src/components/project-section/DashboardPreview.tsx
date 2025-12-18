import { useState, useEffect, useMemo, useRef } from "react";
import { Responsive, WidthProvider, Layouts, Layout } from "react-grid-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import ChartRenderer from "@/components/charts/ChartRenderer";
import { useDashboard } from "@/hooks/useDashboard";
import { DashboardGenerationRequest, LayoutType, ChartType } from "@/types/dashboard";
import { 
  convertLLMStylingToChartStyling,
  validateChartStyling,
  getDefaultChartStyling,
  applyChartStyling,
  getChartStylingClasses,
  getDashboardBackgroundStyle
} from "@/utils/chartStyling";

interface DashboardPreviewProps {
  dataSource?: string;
  dashboardId?: string;
  className?: string;
  style?: React.CSSProperties;
  processedData?: any;
}

const DashboardPreview = ({ 
  dataSource,
  dashboardId,
  className = "",
  style = {},
  processedData
}: DashboardPreviewProps) => {
  const [activeSection, setActiveSection] = useState("overview");
  const { dashboardState, generateDashboard, refreshDashboard, resetDashboard, updateComponent } = useDashboard(dashboardId);
  const containerRef = useRef<HTMLDivElement>(null);

  // No automatic dashboard generation on mount

  // Normalize incoming data (Morpheus-first format)
  const getDashboardStyling = (data: any) => {
    if (!data?.styling_recommendations) return undefined;
    const converted = convertLLMStylingToChartStyling(data.styling_recommendations);
    const validation = validateChartStyling(converted);
    return validation.isValid ? converted : getDefaultChartStyling();
  };

  const normalizeDashboard = (data: any) => {
    if (!data) return null;
    const components: any[] = [];
    let componentId = 1;

    // Dashboard-level styling (light theme from backend)
    const dashboardStyling = getDashboardStyling(data);
    const dashboardTile: any = (dashboardStyling as any)?.tile;

    // Metrics (Morpheus: name -> title, optional change/trend)
    if (Array.isArray(data.metrics)) {
      data.metrics.forEach((m: any, idx: number) => {
        const prev = m?.time_comparison?.previous_value;
        let change: string | number | undefined = m.change;
        let trend: string | undefined = m.trend;
        if ((change === undefined || change === null) && typeof m.value === 'number' && typeof prev === 'number' && prev !== 0) {
          const pct = ((m.value - prev) / prev) * 100;
          change = `${pct.toFixed(2)}%`;
          trend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable';
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
            timeComparison: m.time_comparison,
            // Convert and merge styling with dashboard defaults
            styling: {
              ...validatedMetricStyling,
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
        const chartLevelStyling = c.styling ? convertLLMStylingToChartStyling(c.styling) : undefined;
        const validatedChartStyling = chartLevelStyling && validateChartStyling(chartLevelStyling).isValid
          ? chartLevelStyling
          : (dashboardStyling || getDefaultChartStyling());
        // merge dashboard tile defaults
        const mergedChartStyling: any = {
          ...validatedChartStyling,
          tile: {
            ...(dashboardTile || {}),
            ...((chartLevelStyling as any)?.tile || {})
          }
        };

        const layout = c?.layout;
        const hasLayout = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.w) && Number.isFinite(layout.h);
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
            description: c.reasoning?.insight || c.description || '',
            axisConfig: c.config || { xKey: 'label', yKey: 'value' },
            datasets: Array.isArray(c.datasets) ? c.datasets : [],
            data: c.data,
            config: {},
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
            columns: Array.isArray(t.columns) ? t.columns : [],
            data: Array.isArray(t.rows) ? t.rows : [],
            // Convert and merge styling with dashboard defaults
            styling: {
              ...validatedTableStyling,
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
      id: 'processed_dashboard',
      layout: { type: 'grid', grid_columns: gridColumns, grid_rows: 20 },
      components
    };
    return dashboardConfig;
  };

  // Apply dashboard-level styling to container
  const dashboardStylingForContainer = useMemo(() => getDashboardStyling(processedData), [processedData]);
  useEffect(() => {
    if (containerRef.current && dashboardStylingForContainer) {
      applyChartStyling(containerRef.current, dashboardStylingForContainer);
    }
  }, [dashboardStylingForContainer]);

  // Grid layout config
  const ResponsiveGridLayout = useMemo(() => WidthProvider(Responsive), []);
  const breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
  const cols = { lg: 24, md: 12, sm: 8, xs: 4, xxs: 2 } as const;
  const margin: [number, number] = [6, 6];
  const containerPadding: [number, number] = [6,6];
  const rowHeight = 30;

  // Build normalized dashboards and active selection
  const normalizedProcessed = useMemo(() => processedData ? normalizeDashboard(processedData) : null, [processedData]);
  const activeDashboard = useMemo(() => {
    if (normalizedProcessed) return normalizedProcessed;
    if (dashboardState.configuration) return dashboardState.configuration as any;
    return null;
  }, [normalizedProcessed, dashboardState.configuration]);

  // Helpers to build layouts per component list
  const getMinSizeForType = (type: string) => {
    if (type === 'metric') return { minW: 2, minH: 2 };
    if (type === 'table') return { minW: 6, minH: 3 };
    return { minW: 4, minH: 4 }; // default for charts
  };

  const componentsToBaseLayout = (components: any[]): Layout[] => {
    return components.map((c: any, index: number) => {
      const typeMin = getMinSizeForType(c.type);
      const src = c.layout || {};
      const x = Number.isFinite(src.x) ? src.x : (Number.isFinite(c.position?.x) ? c.position.x : (index % 12));
      const y = Number.isFinite(src.y) ? src.y : (Number.isFinite(c.position?.y) ? c.position.y : Math.floor(index / 12));
      const w = Number.isFinite(src.w) ? src.w : (Number.isFinite(c.position?.width) ? c.position.width : 4);
      const h = Number.isFinite(src.h) ? src.h : (Number.isFinite(c.position?.height) ? c.position.height : 4);
      // Enforce content-driven minima for first render if provided by backend; otherwise type defaults
      const minW = Number.isFinite(src.minW) ? src.minW : typeMin.minW;
      const minH = Number.isFinite(src.minH) ? src.minH : typeMin.minH;
      return { i: String(c.id), x, y, w, h, minW, minH, static: false } as Layout;
    });
  };

  // Scale a layout from one column system to another while preserving proportions
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

  const buildLayoutsFromComponents = (components: any[] | undefined | null): Layouts => {
    const baseLg = components ? componentsToBaseLayout(components) : [];
    return {
      lg: baseLg,
      md: scaleLayoutForCols(baseLg, 24, 12),
      sm: scaleLayoutForCols(baseLg, 24, 8),
      xs: scaleLayoutForCols(baseLg, 24, 4),
      xxs: scaleLayoutForCols(baseLg, 24, 2)
    } as Layouts;
  };

  const storageKey = useMemo(() => `dashboard_layout_${activeDashboard?.id || 'processed_dashboard'}_v2`,[activeDashboard?.id]);

  const [layouts, setLayouts] = useState<Layouts>({ lg: [], md: [], sm: [], xs: [], xxs: [] });

  // Initialize or update layouts when active dashboard changes
  useEffect(() => {
    if (!activeDashboard) {
      setLayouts({ lg: [], md: [], sm: [], xs: [], xxs: [] });
      return;
    }

    const initial = buildLayoutsFromComponents(activeDashboard.components);

    // If rendering from processedData (fresh dashboard), always use backend defaults first
    if (normalizedProcessed) {
      setLayouts(initial);
      return;
    }

    // Otherwise, try to restore saved layouts for persisted dashboards
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Layouts;
        setLayouts(parsed);
        return;
      }
    } catch (_e) {
      // ignore parse errors and fall back to initial
    }
    setLayouts(initial);
  }, [activeDashboard, storageKey, normalizedProcessed]);

  const handleLayoutChange = (current: Layout[], all: Layouts) => {
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
        styling: processedData.dashboard.styling
      };
    }
    // Fallback to nested structure (if backend wraps it)
    if (processedData?.data?.dashboard) {
      return {
        title: processedData.data.dashboard.title,
        description: processedData.data.dashboard.description,
        styling: processedData.data.dashboard.styling
      };
    }
    return null;
  }, [processedData]);

  return (
    <div
      ref={containerRef}
      id="dashboard-preview-root"
      data-dashboard-root
      className={`h-full overflow-y-auto ${getChartStylingClasses(dashboardStylingForContainer || getDefaultChartStyling() as any)} ${className}`}
      style={{
        ...style,
        ...getDashboardBackgroundStyle(dashboardStylingForContainer || getDefaultChartStyling())
      }}
      data-theme="dashboard-preview"
    >
      {/* Dashboard Header with Title and Description */}
      {dashboardMetadata && (
        <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border-card-color)' }}>
          <h1 
            className="text-3xl font-bold mb-2" 
            style={{ color: 'var(--highlight-color)' }}
          >
            {dashboardMetadata.title}
          </h1>
          {dashboardMetadata.description && (
            <p 
              className="text-base opacity-90" 
              style={{ color: 'var(--description-color)' }}
            >
              {dashboardMetadata.description}
            </p>
          )}
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
        {activeDashboard && (
          <div className="space-y-6">
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
              preventCollision
              isBounded
              compactType={null}
              resizeHandles={['se','e','s', 'w','n']}
              onLayoutChange={handleLayoutChange}
            >
              {activeDashboard.components.map((component: any) => (
                <div key={String(component.id)} className="animate-fade-in">
                  <ChartRenderer
                    component={component}
                    onError={handleComponentError}
                  />
                </div>
              ))}
            </ResponsiveGridLayout>
          </div>
        )}

        {!processedData && !dashboardState.configuration && !dashboardState.loading && !dashboardState.error && (
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
    </div>
  );
};

export default DashboardPreview;