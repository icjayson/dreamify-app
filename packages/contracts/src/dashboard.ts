import { z } from "zod";
import { RESOURCE_LIMITS } from "./limits.js";

export const CHART_TYPES = [
  "line",
  "bar",
  "stacked_bar",
  "stacked_column",
  "pie",
  "area",
  "scatter",
  "donut",
  "composed",
  "radar",
  "radial_bar",
  "funnel",
  "treemap",
  "sankey",
  "geographic",
] as const;

const JsonScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const IdSchema = z.string().min(1).max(128);

export const DashboardPositionSchema = z
  .object({
    x: z.number().int().min(0).max(23),
    y: z.number().int().min(0).max(10_000),
    width: z.number().int().min(1).max(24),
    height: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((position) => position.x + position.width <= 24, {
    message: "component exceeds the 24-column layout",
  });

export const DataPointSchema = z
  .object({
    label: z.string().max(256),
    value: z.union([z.number().finite(), z.string().max(256)]),
  })
  .strict();

export const DatasetSchema = z
  .object({
    label: z.string().min(1).max(256),
    data: z.array(DataPointSchema).max(RESOURCE_LIMITS.maxPointsPerSeries),
    color: z.string().max(64).optional(),
  })
  .strict();

export const ChartConfigurationSchema = z
  .object({
    id: IdSchema,
    type: z.enum(CHART_TYPES),
    title: z.string().min(1).max(256),
    description: z.string().max(1_000).optional(),
    datasets: z.array(DatasetSchema).min(1).max(RESOURCE_LIMITS.maxSeriesPerChart),
    config: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const MetricConfigurationSchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1).max(256),
    value: z.union([z.string().max(256), z.number().finite()]),
    change: z.union([z.string().max(256), z.number().finite()]).optional(),
    trend: z.enum(["up", "down", "stable"]).optional(),
    data: z.array(DataPointSchema).max(RESOURCE_LIMITS.maxPointsPerSeries).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const TableColumnSchema = z
  .object({
    key: z.string().min(1).max(128),
    label: z.string().min(1).max(256),
    type: z.enum(["string", "number", "currency", "percentage", "date"]),
  })
  .strict();

export const TableConfigurationSchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1).max(256),
    description: z.string().max(1_000).optional(),
    columns: z.array(TableColumnSchema).min(1).max(RESOURCE_LIMITS.maxColumnsPerFile),
    data: z
      .array(z.record(JsonScalarSchema))
      .max(RESOURCE_LIMITS.maxTableRows),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const ComponentBaseSchema = z.object({
  id: IdSchema,
  position: DashboardPositionSchema,
  metadata: z.record(z.unknown()).optional(),
});

export const DashboardComponentSchema = z.discriminatedUnion("type", [
  ComponentBaseSchema.extend({
    type: z.literal("chart"),
    component_config: ChartConfigurationSchema,
  }).strict(),
  ComponentBaseSchema.extend({
    type: z.literal("metric"),
    component_config: MetricConfigurationSchema,
  }).strict(),
  ComponentBaseSchema.extend({
    type: z.literal("table"),
    component_config: TableConfigurationSchema,
  }).strict(),
]);

export const DashboardConfigurationSchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1).max(256),
    description: z.string().max(2_000).optional(),
    theme_id: z.string().min(1).max(64).default("default"),
    layout: z
      .object({
        type: z.enum(["grid", "flex", "custom"]),
        grid_columns: z.number().int().min(1).max(24).default(24),
      })
      .strict(),
    components: z.array(DashboardComponentSchema).max(
      RESOURCE_LIMITS.maxCharts + RESOURCE_LIMITS.maxMetrics + RESOURCE_LIMITS.maxTables,
    ),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((dashboard, context) => {
    const ids = new Set<string>();
    const counts = { chart: 0, metric: 0, table: 0 };
    for (const component of dashboard.components) {
      counts[component.type] += 1;
      if (ids.has(component.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate component id: ${component.id}`,
        });
      }
      ids.add(component.id);
    }
    if (counts.chart > RESOURCE_LIMITS.maxCharts) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "too many chart components" });
    }
    if (counts.metric > RESOURCE_LIMITS.maxMetrics) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "too many metric components" });
    }
    if (counts.table > RESOURCE_LIMITS.maxTables) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "too many table components" });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(dashboard)).byteLength;
    if (bytes > RESOURCE_LIMITS.maxDashboardBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `dashboard exceeds ${RESOURCE_LIMITS.maxDashboardBytes} bytes`,
      });
    }
  });

export type DashboardPosition = z.infer<typeof DashboardPositionSchema>;
export type DashboardComponent = z.infer<typeof DashboardComponentSchema>;
export type DashboardConfiguration = z.infer<typeof DashboardConfigurationSchema>;
