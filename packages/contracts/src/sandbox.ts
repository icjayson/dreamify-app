import { z } from "zod";
import { DashboardConfigurationSchema } from "./dashboard.js";
import { RESOURCE_LIMITS, SUPPORTED_ASSET_FORMATS } from "./limits.js";

const IdSchema = z.string().min(1).max(128);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const DataAssetReferenceSchema = z
  .object({
    asset_id: IdSchema,
    object_id: IdSchema,
    file_name: z.string().min(1).max(255),
    format: z.enum(SUPPORTED_ASSET_FORMATS),
    media_type: z.string().min(1).max(128),
    size_bytes: z.number().int().positive().max(RESOURCE_LIMITS.maxFileBytes),
    sha256: Sha256Schema,
    relative_path: z.string().min(1).max(512),
    sheet_name: z.string().min(1).max(128).optional(),
  })
  .strict();

export const SandboxProfileRequestSchema = z
  .object({
    schema_version: z.literal("1"),
    run_id: IdSchema,
    assets: z.array(DataAssetReferenceSchema).min(1).max(RESOURCE_LIMITS.maxAssets),
  })
  .strict()
  .superRefine((request, context) => {
    const total = request.assets.reduce((sum, asset) => sum + asset.size_bytes, 0);
    if (total > RESOURCE_LIMITS.maxAggregateFileBytes) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "aggregate asset size exceeded" });
    }
  });

export const ColumnProfileSchema = z
  .object({
    name: z.string().min(1).max(128),
    data_type: z.enum(["numeric", "categorical", "temporal", "boolean", "text"]),
    non_null_count: z.number().int().nonnegative(),
    missing_count: z.number().int().nonnegative(),
    unique_count: z.number().int().nonnegative(),
    minimum: z.union([z.number().finite(), z.string().max(256)]).nullable(),
    maximum: z.union([z.number().finite(), z.string().max(256)]).nullable(),
    mean: z.number().finite().nullable(),
    sample_values: z.array(z.union([z.number().finite(), z.string().max(256), z.boolean()])).max(5),
  })
  .strict();

export const DatasetProfileSchema = z
  .object({
    asset_id: IdSchema,
    file_name: z.string().min(1).max(255),
    format: z.enum(SUPPORTED_ASSET_FORMATS),
    sheet_name: z.string().max(128).nullable(),
    row_count: z.number().int().nonnegative().max(RESOURCE_LIMITS.maxRowsPerFile),
    column_count: z.number().int().positive().max(RESOURCE_LIMITS.maxColumnsPerFile),
    columns: z.array(ColumnProfileSchema).max(RESOURCE_LIMITS.maxColumnsPerFile),
    sample_rows: z.array(z.record(z.unknown())).max(5),
  })
  .strict();

export const SandboxProfileResultSchema = z
  .object({
    schema_version: z.literal("1"),
    run_id: IdSchema,
    datasets: z.array(DatasetProfileSchema).min(1).max(RESOURCE_LIMITS.maxAssets),
  })
  .strict();

export const SandboxAnalysisRequestSchema = z
  .object({
    schema_version: z.literal("1"),
    run_id: IdSchema,
    assets: z.array(DataAssetReferenceSchema).min(1).max(RESOURCE_LIMITS.maxAssets),
    code: z.string().min(1).max(RESOURCE_LIMITS.maxAnalysisCodeCharacters),
  })
  .strict();

export const SandboxAnalysisResultSchema = z
  .object({
    schema_version: z.literal("1"),
    run_id: IdSchema,
    ok: z.boolean(),
    result: z.record(z.unknown()).nullable(),
    error: z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(1_000),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
    stdout: z.string().max(64 * 1024),
    stderr: z.string().max(64 * 1024),
  })
  .strict();

export const SandboxDashboardValidationRequestSchema = z
  .object({
    schema_version: z.literal("1"),
    run_id: IdSchema,
    dashboard: DashboardConfigurationSchema,
  })
  .strict();

export type DataAssetReference = z.infer<typeof DataAssetReferenceSchema>;
export type SandboxProfileRequest = z.infer<typeof SandboxProfileRequestSchema>;
export type DatasetProfile = z.infer<typeof DatasetProfileSchema>;
export type SandboxProfileResult = z.infer<typeof SandboxProfileResultSchema>;
export type SandboxAnalysisRequest = z.infer<typeof SandboxAnalysisRequestSchema>;
export type SandboxAnalysisResult = z.infer<typeof SandboxAnalysisResultSchema>;
