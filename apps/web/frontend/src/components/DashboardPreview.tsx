import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import ChartRenderer from "@/components/charts/ChartRenderer";
import { useDashboard } from "@/hooks/useDashboard";
import { DashboardGenerationRequest, LayoutType, ChartType } from "@/types/dashboard";

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

  // No automatic dashboard generation on mount

  // Normalize incoming data (Morpheus-first format)
  const normalizeDashboard = (data: any) => {
    if (!data) return null;
    const components: any[] = [];
    let componentId = 1;

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
            timeComparison: m.time_comparison
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
        components.push({
          id: `chart_${componentId++}`,
          type: 'chart',
          position: { x: (idx % 2) * 6, y: Math.floor(idx / 2) * 4 + 2, width: 6, height: 4 },
          component_config: {
            id: c.id || `chart_${idx + 1}`,
            type: mappedType,
            title: c.title || 'Chart',
            description: c.reasoning?.insight || c.description || '',
            axisConfig: c.config,
            data: c.data,
            config: {},
            styling: undefined
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
            data: Array.isArray(t.rows) ? t.rows : []
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
    <div className={`h-full overflow-y-auto bg-background/50 ${className}`} style={style}>
      {/* Dashboard Header */}
      <div className="p-6 border-b border-border/50 glass-panel">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold mb-1">
              {dashboardState.configuration?.title || "eCommerce Sales Dashboard"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {dashboardState.configuration?.description || "Real-time analytics with AI insights"}
            </p>
          </div>
        </div>
        
        
      </div>

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
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Processed Data Dashboard</h2>
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                Generated by Morpheus
              </Badge>
            </div>
            
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
                    onRefresh={handleComponentRefresh}
                    onError={handleComponentError}
                    showRefreshButton={true}
                    autoRefresh={false}
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
                    onRefresh={handleComponentRefresh}
                    onError={handleComponentError}
                    showRefreshButton={true}
                    autoRefresh={false}
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