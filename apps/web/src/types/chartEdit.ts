import type { ChartChipData } from "@/components/chat/ChartPreviewChip";

export type { ChartChipData };

export type QuickEditAction = "change_type" | "recolor" | "filter_range";

/**
 * Detail payload for the `dreamify:select-chart-context` custom event.
 *
 * It extends {@link ChartChipData} so existing dispatchers that send a plain
 * chip stay valid. The optional `intent` / `promptSeed` fields are added by the
 * inline quick-edit flow to pre-fill the composer.
 */
export type SelectChartContextDetail = ChartChipData & {
  intent?: QuickEditAction;
  promptSeed?: string;
};

interface QuickEditActionMeta {
  label: string;
  promptSeed: string;
}

export const QUICK_EDIT_ACTIONS: Record<QuickEditAction, QuickEditActionMeta> = {
  change_type: { label: "Change type", promptSeed: "Change this chart to a " },
  recolor: { label: "Recolor / theme", promptSeed: "Recolor this chart using " },
  filter_range: { label: "Filter range", promptSeed: "Filter this chart to " },
};

/**
 * Structured "what changed" summary returned by the backend after a chart edit.
 *
 * Mirrors the optional `change_summary` field on the GET
 * `/api/v1/conversation/{id}/dashboard` response. Null/absent for normal
 * full-dashboard generation; present only after an edit.
 */
export interface ChartChangeSummary {
  change_type?: string[];
  chart_type_from?: string | null;
  chart_type_to?: string | null;
  series_added?: string[];
  series_removed?: string[];
  filters_applied?: string[];
  human_summary?: string | null;
}

/**
 * Edit provenance: the actual Python the edit ran plus its outputs.
 *
 * Mirrors the optional `computed_values` field on the dashboard response and
 * stays available for the Activity/audit path.
 */
export interface EditDataProvenance {
  python_code?: string[];
  computed_values?: Record<string, unknown>;
  notes?: string | null;
}

/**
 * One step in the "How this was calculated" activity timeline. Mirrors the
 * optional `analysis_steps` entries on the dashboard response and the live SSE
 * `phase:"execution"` thinking events. All fields beyond `index`/`title` are
 * optional so partial/live steps render gracefully.
 */
export interface AnalysisStep {
  index: number;
  title: string;
  python?: string;
  output?: string;
  explanation?: string;
  status?: string;
  durationMs?: number;
}

/**
 * One row in the unified Activity timeline. Built by `buildActivityTimeline`
 * from live `thinkingEvents` (the full reasoning trace) enriched with the
 * persisted `analysisSteps` (the fuller Python/output record). Unlike
 * {@link AnalysisStep} this covers every meaningful phase — not just execution —
 * so Q&A / reasoning-only flows still render a timeline. `python` is present
 * only on steps that ran code.
 */
export interface ActivityItem {
  key: string;
  title: string;
  explanation?: string;
  status?: string;
  phase?: string;
  stepIndex?: number | null;
  python?: string;
  output?: string;
  durationMs?: number;
}
