import {
  DashboardConfigurationSchema,
  SandboxProfileResultSchema,
  type DataAssetReference,
  type DashboardConfiguration,
  type SandboxAnalysisResult,
  type SandboxProfileResult,
} from "@dreamify/contracts";
import { RunContextSchema, type RunContext } from "@dreamify/workflow";

export const SALES_ASSET: DataAssetReference = {
  asset_id: "asset-demo-sales",
  object_id: "object-demo-sales",
  file_name: "sales.csv",
  format: "csv",
  media_type: "text/csv",
  size_bytes: 175,
  sha256: "2a98d8a182d041158df24b435ba01b1317d1e544b86b9131c1fa0345103c53fe",
  relative_path: "input/sales.csv",
};

export const SALES_RUN_CONTEXT: RunContext = RunContextSchema.parse({
  run_id: "run-demo-sales",
  conversation_id: "conversation-demo",
  project_id: "project-demo",
  owner_id: "demo_user",
  prompt: "Analyze all sales data and build a dashboard",
  assets: [SALES_ASSET],
  theme_id: "default",
  focus_id: null,
  existing_dashboard: null,
  conversation_revision_object_id: "conversation-revision-demo",
});

export const SALES_PROFILE: SandboxProfileResult = SandboxProfileResultSchema.parse({
  schema_version: "1",
  run_id: SALES_RUN_CONTEXT.run_id,
  datasets: [
    {
      asset_id: SALES_ASSET.asset_id,
      file_name: SALES_ASSET.file_name,
      format: SALES_ASSET.format,
      sheet_name: null,
      row_count: 6,
      column_count: 4,
      columns: [
        {
          name: "date",
          data_type: "temporal",
          non_null_count: 6,
          missing_count: 0,
          unique_count: 6,
          minimum: "2026-01-01",
          maximum: "2026-03-01",
          mean: null,
          sample_values: ["2026-01-01", "2026-01-15"],
        },
        {
          name: "region",
          data_type: "categorical",
          non_null_count: 6,
          missing_count: 0,
          unique_count: 2,
          minimum: null,
          maximum: null,
          mean: null,
          sample_values: ["North", "South"],
        },
        {
          name: "revenue",
          data_type: "numeric",
          non_null_count: 6,
          missing_count: 0,
          unique_count: 6,
          minimum: 900,
          maximum: 1500,
          mean: 1183.33,
          sample_values: [1000, 1200, 900],
        },
        {
          name: "orders",
          data_type: "numeric",
          non_null_count: 6,
          missing_count: 0,
          unique_count: 6,
          minimum: 9,
          maximum: 15,
          mean: 11.83,
          sample_values: [10, 12, 9],
        },
      ],
      sample_rows: [
        { date: "2026-01-01", region: "North", revenue: 1000, orders: 10 },
        { date: "2026-01-15", region: "South", revenue: 1200, orders: 12 },
      ],
    },
  ],
});

export const DEMO_DASHBOARD: DashboardConfiguration = DashboardConfigurationSchema.parse({
  id: "dashboard-demo",
  title: "Sales overview",
  theme_id: "default",
  layout: { type: "grid", grid_columns: 24 },
  components: [
    {
      id: "metric-revenue",
      type: "metric",
      position: { x: 0, y: 0, width: 6, height: 2 },
      component_config: {
        id: "metric-revenue-config",
        title: "Total revenue",
        value: 7100,
        trend: "up",
      },
    },
    {
      id: "chart-revenue",
      type: "chart",
      position: { x: 0, y: 2, width: 12, height: 8 },
      component_config: {
        id: "chart-revenue-config",
        type: "line",
        title: "Revenue trend",
        datasets: [
          {
            label: "Revenue",
            data: [
              { label: "2026-01", value: 2200 },
              { label: "2026-02", value: 2400 },
              { label: "2026-03", value: 2500 },
            ],
          },
        ],
      },
    },
  ],
});

export const FAILED_ANALYSIS: SandboxAnalysisResult = {
  schema_version: "1",
  run_id: SALES_RUN_CONTEXT.run_id,
  ok: false,
  result: null,
  error: {
    code: "CODE_ERROR",
    message: "Unknown column: sales_total",
    retryable: false,
  },
  stdout: "",
  stderr: "Unknown column: sales_total",
};
