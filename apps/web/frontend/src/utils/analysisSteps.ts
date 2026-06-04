import type { ActivityItem, AnalysisStep } from "@/types/chartEdit";
import type { ThinkingEvent } from "@/types/message";

interface ExecutionMetadata {
  python?: unknown;
  output?: unknown;
  step_index?: unknown;
}

/**
 * Phases worth surfacing in the Activity timeline. Mirrors ChatInterface's
 * in-chat `ThinkingProcess` filter but additionally keeps `"execution"` so the
 * code-running steps appear in the rich Activity tab. Re-declared here (rather than
 * imported from the chat component) to keep this pure util free of UI deps.
 */
export const MEANINGFUL_ACTIVITY_PHASES = new Set<string>([
  "context",
  "routing",
  "analysis",
  "tool",
  "execution",
  "synthesis",
  "validation",
  "final",
  "error",
]);

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (value == null) return undefined;
  return String(value);
}

function readStepIndex(metadata: ExecutionMetadata): number | null {
  if (typeof metadata.step_index === "number") return metadata.step_index;
  if (typeof metadata.step_index === "string" && metadata.step_index.trim()) {
    const parsed = Number(metadata.step_index);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isExecutionPhase(phase?: string): boolean {
  return phase === "execution";
}

function eventSortKey(event: ThinkingEvent): number {
  if (typeof event.sequence === "number") return event.sequence;
  const started = event.started_at ? new Date(event.started_at).getTime() : 0;
  return Number.isFinite(started) ? started : 0;
}

function itemFromEvent(event: ThinkingEvent): ActivityItem {
  const metadata = (event.metadata ?? {}) as ExecutionMetadata;
  return {
    key: event.id,
    title: event.title,
    explanation: event.summary ?? "",
    status: event.status,
    phase: event.phase,
    stepIndex: readStepIndex(metadata),
    python: asString(metadata.python),
    output: asString(metadata.output),
    durationMs: event.duration_ms ?? undefined,
  };
}

function itemFromAnalysisStep(step: AnalysisStep): ActivityItem {
  return {
    key: `analysis-step-${step.index}`,
    title: step.title,
    explanation: step.explanation ?? "",
    status: step.status,
    phase: "execution",
    python: step.python,
    output: step.output,
    durationMs: step.durationMs,
  };
}

/**
 * Index analysis steps for enrichment lookup: a map keyed by `step.index` (for
 * `step_index` matching) plus an ordered list (for positional fallback). The
 * persisted analysis steps are the fuller record, so their Python/output/
 * explanation win over the live event's inline metadata.
 */
function enrichExecutionItems(
  items: ActivityItem[],
  analysisSteps: AnalysisStep[],
): ActivityItem[] {
  const byIndex = new Map<number, AnalysisStep>();
  analysisSteps.forEach((step) => byIndex.set(step.index, step));
  const ordered = [...analysisSteps].sort((a, b) => a.index - b.index);

  let positionalExecutionIndex = 0;
  return items.map((item) => {
    if (!isExecutionPhase(item.phase)) return item;
    const match =
      typeof item.stepIndex === "number"
        ? byIndex.get(item.stepIndex)
        : ordered[positionalExecutionIndex++];
    if (!match) return item;
    return {
      ...item,
      python: match.python ?? item.python,
      output: match.output ?? item.output,
      explanation: match.explanation?.trim() ? match.explanation : item.explanation,
    };
  });
}

/**
 * Build the unified Activity timeline shown in the Activity tab.
 *
 * Base = live `thinkingEvents` filtered to {@link MEANINGFUL_ACTIVITY_PHASES}
 * (covers generation, edit, and Q&A reasoning), sorted by sequence/started_at.
 * Execution rows are then enriched with the persisted `analysisSteps`
 * (preferring their fuller Python/output/explanation) — matched by
 * `step_index`, falling back to positional order among execution rows.
 *
 * When there are no live events but persisted steps exist (e.g. a reload that
 * hasn't restored the event stream), the timeline is synthesized from the
 * analysis steps alone so the proof still shows. Empty inputs yield `[]`.
 */
export function buildActivityTimeline(
  thinkingEvents?: ThinkingEvent[] | null,
  analysisSteps?: AnalysisStep[] | null,
): ActivityItem[] {
  const events = thinkingEvents ?? [];
  const steps = analysisSteps ?? [];

  const meaningful = events
    .filter((event) => MEANINGFUL_ACTIVITY_PHASES.has(event.phase))
    .sort((a, b) => eventSortKey(a) - eventSortKey(b));

  if (meaningful.length > 0) {
    const items = meaningful.map(itemFromEvent);
    return steps.length > 0 ? enrichExecutionItems(items, steps) : items;
  }

  if (steps.length > 0) {
    return [...steps].sort((a, b) => a.index - b.index).map(itemFromAnalysisStep);
  }

  return [];
}
