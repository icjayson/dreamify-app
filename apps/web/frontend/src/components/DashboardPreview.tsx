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
}

const DashboardPreview = ({ 
  dataSource = "sample_data",
  dashboardId,
  className = "",
  style = {}
}: DashboardPreviewProps) => {
  const [activeSection, setActiveSection] = useState("overview");
  const { dashboardState, generateDashboard, refreshDashboard, resetDashboard } = useDashboard(dashboardId);

  // Generate dashboard on mount if no dashboardId provided
  useEffect(() => {
    if (!dashboardId && !dashboardState.configuration && !dashboardState.loading) {
      const request: DashboardGenerationRequest = {
        data_source: dataSource,
        layout_preference: LayoutType.GRID,
        chart_types: [ChartType.LINE, ChartType.BAR, ChartType.METRIC, ChartType.TABLE, ChartType.GEOGRAPHIC],
        metadata: {
          title: "eCommerce Sales Dashboard",
          description: "Real-time analytics with AI insights"
        }
      };
      generateDashboard(request);
    }
  }, [dashboardId, dataSource, dashboardState.configuration, dashboardState.loading, generateDashboard]);

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
          description: "Real-time analytics with AI insights"
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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-success border-success/30 bg-success/10">
              ● Live Data
            </Badge>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleRefresh}
              disabled={dashboardState.loading}
            >
              {dashboardState.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button variant="outline" size="sm">
              Share
            </Button>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <div className="flex gap-1">
          {["Overview", "Revenue", "Customers", "Products"].map((tab) => (
            <Button
              key={tab}
              variant={activeSection === tab.toLowerCase() ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveSection(tab.toLowerCase())}
              className="text-xs"
            >
              {tab}
            </Button>
          ))}
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

        {/* Dynamic Dashboard Grid */}
        {dashboardState.configuration && (
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

        {/* Fallback to hardcoded dashboard if no configuration */}
        {!dashboardState.configuration && !dashboardState.loading && !dashboardState.error && (
          <div className="space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No dashboard configuration available. Using fallback layout.
              </AlertDescription>
            </Alert>
            
            {/* Fallback hardcoded layout */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <div className="h-32 bg-muted rounded-lg flex items-center justify-center">
                  <p className="text-muted-foreground">Revenue Chart</p>
                </div>
              </div>
              <div>
                <div className="h-32 bg-muted rounded-lg flex items-center justify-center">
                  <p className="text-muted-foreground">Projections Chart</p>
                </div>
              </div>
              <div>
                <div className="h-32 bg-muted rounded-lg flex items-center justify-center">
                  <p className="text-muted-foreground">Geographic Chart</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPreview;