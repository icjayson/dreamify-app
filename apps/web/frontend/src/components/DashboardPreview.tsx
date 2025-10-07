import { useState, useEffect, useMemo, useRef } from "react";
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
  getChartStylingClasses
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
  const { dashboardState, generateDashboard, refreshDashboard, resetDashboard } = useDashboard(dashboardId);
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
        components.push({
          id: `metric_${componentId++}`,
          type: 'metric',
          position: { x: (idx % 4) * 3, y: Math.floor(idx / 4) * 2, width: 3, height: 2 },
          component_config: {
            id: m.id || `metric_${idx + 1}`,
            title: m.title || m.name || 'Metric',
            value: m.value,
            change,
            trend,
            timeComparison: m.time_comparison,
            // merge dashboard tile defaults into metric styling if missing
            styling: {
              ...(m.styling || {}),
              tile: {
                ...(dashboardTile || {}),
                ...((m.styling && (m.styling as any).tile) || {})
              }
            }
          }
        });
      });
    }

    // Charts (Morpheus: chart_type + config axis)
    const typeMap: Record<string, string> = {
      line_chart: 'line',
      bar_chart: 'bar',
      pie_chart: 'pie',
      area_chart: 'area',
      scatter_chart: 'scatter',
      composed_chart: 'composed',
      geographic: 'geographic',
      table: 'table'
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

        components.push({
          id: `chart_${componentId++}`,
          type: 'chart',
          position: { x: (idx % 2) * 6, y: Math.floor(idx / 2) * 4 + 2, width: 6, height: 4 },
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
    if (Array.isArray(data.tables)) {
      data.tables.forEach((t: any, idx: number) => {
        components.push({
          id: `table_${componentId++}`,
          type: 'table',
          position: { x: 0, y: Math.floor(idx / 2) * 6 + 6, width: 12, height: 3 },
          component_config: {
            id: t.id || `table_${idx + 1}`,
            title: t.title || 'Table',
            columns: Array.isArray(t.columns) ? t.columns : [],
            data: Array.isArray(t.rows) ? t.rows : [],
            styling: {
              ...(t.styling || {}),
              tile: {
                ...(dashboardTile || {}),
                ...((t.styling || {}).tile || {})
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

  // Apply dashboard-level styling to container to decouple from global theme
  const dashboardStylingForContainer = useMemo(() => getDashboardStyling(processedData), [processedData]);
  useEffect(() => {
    if (containerRef.current && dashboardStylingForContainer) {
      applyChartStyling(containerRef.current, dashboardStylingForContainer);
    }
  }, [dashboardStylingForContainer]);

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

  return (
    <div
      ref={containerRef}
      className={`h-full overflow-y-auto ${getChartStylingClasses(dashboardStylingForContainer || getDefaultChartStyling() as any)} ${className}`}
      style={style}
      data-theme="dashboard-preview"
    >
      {/* Header removed as per request */}

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

        {/* Processed Data Dashboard */}
        {processedData && normalizeDashboard(processedData) && (
          <div className="space-y-6">
            {/* Removed Processed Data Dashboard title and badge */}
            
            {/* Dynamic Grid Layout for Processed Data */}
            <div 
              className="grid gap-6"
              style={{
                gridTemplateColumns: `repeat(${normalizeDashboard(processedData)?.layout.grid_columns || 12}, 1fr)`
              }}
            >
              {normalizeDashboard(processedData)?.components.map((component) => (
                <div
                  key={component.id}
                  className="animate-fade-in"
                  style={{
                    gridColumn: `span ${component.position.width}`,
                    gridRow: `span ${component.position.height}`
                  }}
                >
                  <ChartRenderer
                    component={component}
                    onError={handleComponentError}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dynamic Dashboard Grid */}
        {!processedData && dashboardState.configuration && (
          <div className="space-y-6">
            {/* Dynamic Grid Layout */}
            <div 
              className="grid gap-6"
              style={{
                gridTemplateColumns: `repeat(${dashboardState.configuration.layout.grid_columns || 12}, 1fr)`
              }}
            >
              {dashboardState.configuration.components.map((component) => (
                <div
                  key={component.id}
                  className="animate-fade-in"
                  style={{
                    gridColumn: `span ${component.position.width}`,
                    gridRow: `span ${component.position.height}`
                  }}
                >
                  <ChartRenderer
                    component={component}
                    onError={handleComponentError}
                  />
                </div>
              ))}
            </div>
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