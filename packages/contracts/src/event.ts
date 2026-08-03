import { z } from "zod";
import { RESOURCE_LIMITS } from "./limits.js";

export const EVENT_PHASES = [
  "queued",
  "context",
  "clarification",
  "capacity",
  "profiling",
  "routing",
  "analysis",
  "tool",
  "synthesis",
  "validation",
  "persist",
  "final",
  "error",
] as const;

export const EVENT_STATUSES = ["active", "completed", "error"] as const;

export const EventPhaseSchema = z.enum(EVENT_PHASES);
export const EventStatusSchema = z.enum(EVENT_STATUSES);

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const ThinkingEventSchema = z
  .object({
    id: z.string().min(1).max(256),
    run_id: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    event_key: z.string().min(1).max(128),
    phase: EventPhaseSchema,
    status: EventStatusSchema,
    title: z.string().min(1).max(160),
    summary: z.string().max(1_000).nullable(),
    detail: z.string().max(4_000).nullable(),
    started_at: IsoTimestampSchema,
    completed_at: IsoTimestampSchema.nullable(),
    duration_ms: z.number().int().nonnegative().nullable(),
    metadata: z.record(z.unknown()),
  })
  .strict()
  .superRefine((event, context) => {
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (bytes > RESOURCE_LIMITS.maxEventBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event exceeds ${RESOURCE_LIMITS.maxEventBytes} bytes`,
      });
    }
  });

export type EventPhase = z.infer<typeof EventPhaseSchema>;
export type EventStatus = z.infer<typeof EventStatusSchema>;
export type ThinkingEvent = z.infer<typeof ThinkingEventSchema>;

export type NewThinkingEvent = Omit<ThinkingEvent, "id" | "sequence">;
