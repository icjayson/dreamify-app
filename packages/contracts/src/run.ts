import { z } from "zod";

export const RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_user_input",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
] as const;

export const WORKFLOW_STEPS = [
  "accepted",
  "context",
  "clarification",
  "capacity",
  "profiling",
  "routing",
  "analysis",
  "synthesis",
  "validation",
  "persist",
  "done",
] as const;

export const RESPONSE_TYPES = [
  "message",
  "answer_with_visual",
  "dashboard_config",
  "chart_modification",
  "clarification_request",
] as const;

export const RunStatusSchema = z.enum(RUN_STATUSES);
export const WorkflowStepSchema = z.enum(WORKFLOW_STEPS);
export const ResponseTypeSchema = z.enum(RESPONSE_TYPES);

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type ResponseType = z.infer<typeof ResponseTypeSchema>;

const IdSchema = z.string().min(1).max(128);
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const RunErrorSchema = z
  .object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    failed_step: WorkflowStepSchema.optional(),
  })
  .strict();

export const RunResultReferenceSchema = z
  .object({
    message_id: IdSchema.optional(),
    dashboard_id: IdSchema.optional(),
    artifact_ids: z.array(IdSchema).max(16).optional(),
    response_type: ResponseTypeSchema,
  })
  .strict();

export const RunRecordSchema = z
  .object({
    run_id: IdSchema,
    conversation_id: IdSchema,
    project_id: IdSchema,
    owner_id: IdSchema,
    parent_run_id: IdSchema.nullable().default(null),
    workflow_run_id: IdSchema.nullable().default(null),
    status: RunStatusSchema,
    current_step: WorkflowStepSchema,
    response_type: ResponseTypeSchema.nullable().default(null),
    cancel_requested: z.boolean().default(false),
    cancel_reason: z.string().max(256).nullable().default(null),
    version: z.number().int().nonnegative(),
    result: RunResultReferenceSchema.nullable().default(null),
    error: RunErrorSchema.nullable().default(null),
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
    started_at: IsoTimestampSchema.nullable().default(null),
    completed_at: IsoTimestampSchema.nullable().default(null),
  })
  .strict();

export const AcceptedRunResponseSchema = z
  .object({
    conversation_id: IdSchema,
    project_id: IdSchema,
    run_id: IdSchema,
    status: z.literal("accepted"),
    links: z
      .object({
        status: z.string().min(1),
        events: z.string().min(1),
        stream: z.string().min(1),
        cancel: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type RunError = z.infer<typeof RunErrorSchema>;
export type RunResultReference = z.infer<typeof RunResultReferenceSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
export type AcceptedRunResponse = z.infer<typeof AcceptedRunResponseSchema>;

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "awaiting_user_input",
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}
