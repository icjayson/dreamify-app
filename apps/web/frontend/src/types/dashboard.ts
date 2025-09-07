/**
 * Dashboard configuration types for dynamic dashboard generation.
 */

export enum ChartType {
  LINE = "line",
  BAR = "bar",
  PIE = "pie",
  AREA = "area",
  SCATTER = "scatter",
  DONUT = "donut",
  METRIC = "metric",
  TABLE = "table",
  GEOGRAPHIC = "geographic",
  ACTIVITY_FEED = "activity_feed"
}

export enum LayoutType {
  GRID = "grid",
  FLEX = "flex",
  CUSTOM = "custom"
}

export enum MetricTrend {
  UP = "up",
  DOWN = "down",
  STABLE = "stable"
}

export interface ChartDataPoint {
  label: string;
  value: number | string;
  metadata?: Record<string, any>;
}

export interface ChartDataset {
  label: string;
  data: ChartDataPoint[];
  color?: string;
  metadata?: Record<string, any>;
}

export interface ChartConfiguration {
  id: string;
  type: ChartType;
  title: string;
  description?: string;
  datasets: ChartDataset[];
  config?: Record<string, any>;
  layout?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface MetricConfiguration {
  id: string;
  title: string;
  value: string | number;
  change: string;
  trend: MetricTrend;
  metadata?: Record<string, any>;
}

export interface TableColumn {
  key: string;
  label: string;
  type: "string" | "number" | "currency" | "percentage" | "date";
  width?: string;
  align?: "left" | "center" | "right";
}

export interface TableConfiguration {
  id: string;
  title: string;
  description?: string;
  columns: TableColumn[];
  data: Record<string, any>[];
  pagination?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface DashboardLayout {
  type: LayoutType;
  grid_columns?: number;
  breakpoints?: Record<string, number>;
  spacing?: string;
  metadata?: Record<string, any>;
}

export interface DashboardComponent {
  id: string;
  type: "chart" | "metric" | "table" | "custom";
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  component_config: ChartConfiguration | MetricConfiguration | TableConfiguration | Record<string, any>;
  metadata?: Record<string, any>;
}

export interface DashboardConfiguration {
  id: string;
  title: string;
  description?: string;
  layout: DashboardLayout;
  components: DashboardComponent[];
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardGenerationRequest {
  data_source: string;
  requirements?: Record<string, any>;
  layout_preference?: LayoutType;
  chart_types?: ChartType[];
  metadata?: Record<string, any>;
}

export interface DashboardGenerationResponse {
  success: boolean;
  dashboard_config?: DashboardConfiguration;
  processing_time?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface DashboardRefreshRequest {
  dashboard_id: string;
  data_source?: string;
  force_refresh?: boolean;
}

export interface DashboardRefreshResponse {
  success: boolean;
  dashboard_config?: DashboardConfiguration;
  refresh_time?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ChartDataRequest {
  chart_id: string;
  filters?: Record<string, any>;
  aggregation?: string;
  time_range?: Record<string, any>;
}

export interface ChartDataResponse {
  success: boolean;
  data?: ChartDataPoint[];
  error?: string;
  metadata?: Record<string, any>;
}

// Dashboard state management types
export interface DashboardState {
  configuration: DashboardConfiguration | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
}

export interface DashboardHook {
  dashboardState: DashboardState;
  generateDashboard: (request: DashboardGenerationRequest) => Promise<void>;
  refreshDashboard: (request: DashboardRefreshRequest) => Promise<void>;
  updateComponent: (componentId: string, config: any) => void;
  resetDashboard: () => void;
}
