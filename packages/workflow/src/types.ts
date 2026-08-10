import {
  DataAssetReferenceSchema,
  DashboardConfigurationSchema,
  RESOURCE_LIMITS,
  ResponseTypeSchema,
  type DataAssetReference,
  type DatasetProfile,
  type RunRecord,
  type SandboxAnalysisResult,
  type SandboxProfileResult,
  type ThinkingEvent,
  type WorkflowResponse,
} from "@dreamify/contracts";
import { z } from "zod";

export const EditTargetSchema = z
  .object({
    dashboard_id: z.string().min(1).max(128),
    component_ids: z.array(z.string().min(1).max(128)).min(1).max(16),
  })
  .strict()
  .superRefine((target, context) => {
    if (new Set(target.component_ids).size !== target.component_ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "component IDs must be unique" });
    }
  });

export type EditTarget = z.infer<typeof EditTargetSchema>;

export const RunContextSchema = z
  .object({
    run_id: z.string().min(1).max(128),
    conversation_id: z.string().min(1).max(128),
    project_id: z.string().min(1).max(128),
    owner_id: z.string().min(1).max(128),
    prompt: z.string().min(1).max(RESOURCE_LIMITS.maxPromptCharacters),
    assets: z.array(DataAssetReferenceSchema).max(RESOURCE_LIMITS.maxAssets),
    theme_id: z.string().min(1).max(64).default("default"),
    focus_id: z.string().min(1).max(64).nullable().default(null),
    existing_dashboard: DashboardConfigurationSchema.nullable().default(null),
    edit_target: EditTargetSchema.nullable().default(null),
    conversation_revision_object_id: z.string().min(1).max(128),
  })
  .strict();

export type RunContext = z.infer<typeof RunContextSchema>;

export const ClarificationPlanSchema = z
  .object({
    clarification_id: z.string().min(1).max(128),
    reason_code: z.enum(["asset", "source", "join", "time", "output", "scope", "edit_target"]),
    question: z.string().min(1).max(2_000),
    options: z
      .array(z.object({ id: z.string().min(1).max(128), label: z.string().min(1).max(256) }).strict())
      .max(20),
  })
  .strict();

export const RoutePlanSchema = z
  .object({
    response_type: ResponseTypeSchema,
    requires_data: z.boolean(),
    reasoning: z.string().min(1).max(1_000),
    analysis_code: z.string().max(RESOURCE_LIMITS.maxAnalysisCodeCharacters).nullable(),
    clarification: ClarificationPlanSchema.nullable(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.response_type === "clarification_request" && !plan.clarification) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "clarification payload is required" });
    }
    if (plan.response_type !== "clarification_request" && plan.clarification) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "clarification is only valid for clarification_request" });
    }
    if (plan.requires_data && !plan.analysis_code) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "analysis code is required for a data plan" });
    }
  });

export type RoutePlan = z.infer<typeof RoutePlanSchema>;

export interface ArtifactReference {
  object_id: string;
  kind: "profile" | "analysis" | "response";
  size_bytes: number;
  sha256: string;
}

export interface SandboxLease {
  lease_id: string;
  run_id: string;
  expires_at: string;
}

export interface ProviderCallContext {
  idempotency_key: string;
  signal?: AbortSignal;
}

/** Server-step-only material. Never return this from a Workflow step. */
export type ResolvedProviderCredential =
  | {
      mode: "demo";
      provider: "demo";
      model: "deterministic-v1";
      api_key: null;
    }
  | {
      mode: "byok";
      provider: "openai" | "gemini" | "deepseek";
      model: string;
      api_key: string;
    };

export interface RouteInput {
  context: RunContext;
  profile: SandboxProfileResult | null;
}

export interface RepairCodeInput {
  context: RunContext;
  profile: SandboxProfileResult;
  failed_code: string;
  failure: NonNullable<SandboxAnalysisResult["error"]>;
}

export interface SynthesisInput {
  context: RunContext;
  plan: RoutePlan;
  profile: SandboxProfileResult | null;
  analysis: Record<string, unknown> | null;
}

export interface RepairSynthesisInput extends SynthesisInput {
  invalid_output: unknown;
  validation_error: string;
}

export interface WorkflowExecutionResult {
  run: RunRecord;
  response: WorkflowResponse | null;
  ignored: boolean;
  /**
   * True when a bounded slice intentionally yielded after persisting progress.
   * The Vercel Workflow entry starts another durable step instead of keeping a
   * single function alive for the complete analysis.
   */
  paused?: boolean;
  retry_after_ms?: number;
}

export interface WorkflowDiagnostics {
  provider_calls: number;
  sandbox_commands: number;
  events: ThinkingEvent[];
}

export type { DataAssetReference, DatasetProfile, SandboxAnalysisResult, SandboxProfileResult, WorkflowResponse };
