import { z } from "zod";
import { DashboardConfigurationSchema } from "./dashboard.js";

const IdSchema = z.string().min(1).max(128);
const MessageSchema = z.string().min(1).max(20_000);

const VisualArtifactSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(["chart", "table"]),
    title: z.string().min(1).max(256),
    data: z.unknown(),
  })
  .strict();

export const WorkflowResponseSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("message"),
      content: MessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("answer_with_visual"),
      content: MessageSchema,
      visual_artifacts: z.array(VisualArtifactSchema).min(1).max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("dashboard_config"),
      content: MessageSchema,
      dashboard: DashboardConfigurationSchema,
      analysis_steps: z
        .array(
          z
            .object({
              title: z.string().min(1).max(160),
              explanation: z.string().max(1_500),
              code: z.string().max(1_500).optional(),
              output: z.string().max(1_500).optional(),
            })
            .strict(),
        )
        .max(12)
        .default([]),
    })
    .strict(),
  z
    .object({
      type: z.literal("chart_modification"),
      content: MessageSchema,
      dashboard: DashboardConfigurationSchema,
      edit_note: z.string().max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("clarification_request"),
      content: MessageSchema,
      clarification_id: IdSchema,
      reason_code: z.enum(["asset", "source", "join", "time", "output", "scope", "edit_target"]),
      options: z
        .array(
          z.object({ id: IdSchema, label: z.string().min(1).max(256) }).strict(),
        )
        .max(20)
        .default([]),
    })
    .strict(),
]);

export type WorkflowResponse = z.infer<typeof WorkflowResponseSchema>;
