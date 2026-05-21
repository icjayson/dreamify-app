import type { ClarificationOption, Message } from "@/types/message";

export type ClarificationKeyboardAction =
  | "previous"
  | "next"
  | "submit"
  | "dismiss"
  | "none";

export interface ClarificationKeyboardInput {
  key: string;
  isNoteFocused?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export function getDefaultClarificationOptionId(options: ClarificationOption[]): string | undefined {
  return options.find((option) => option.recommended)?.id ?? options[0]?.id;
}

export function moveClarificationSelection(
  options: ClarificationOption[],
  selectedId: string | undefined,
  delta: -1 | 1,
): string | undefined {
  if (options.length === 0) return undefined;
  const currentIndex = Math.max(0, options.findIndex((option) => option.id === selectedId));
  const nextIndex = (currentIndex + delta + options.length) % options.length;
  return options[nextIndex]?.id;
}

export function getClarificationKeyboardAction(input: ClarificationKeyboardInput): ClarificationKeyboardAction {
  if (input.key === "ArrowUp") return "previous";
  if (input.key === "ArrowDown") return "next";
  if (input.key === "Escape") return "dismiss";
  if (input.key === "Enter" && (!input.isNoteFocused || input.metaKey || input.ctrlKey)) {
    return "submit";
  }
  return "none";
}

export function getClarificationOptionDetails(option: ClarificationOption): string[] {
  const details: string[] = [];
  const metadata = option.metadata ?? {};
  if (option.description) details.push(option.description);
  if (option.impact) details.push(`Impact: ${option.impact}`);
  if (metadata.asset_selection) details.push(`Data scope: ${metadata.asset_selection}`);
  if (Array.isArray(metadata.asset_ids) && metadata.asset_ids.length > 0) {
    details.push(`${metadata.asset_ids.length} selected data source${metadata.asset_ids.length === 1 ? "" : "s"}`);
  }
  if (metadata.route_mode) {
    const routeLabels: Record<string, string> = {
      dashboard: "Saved dashboard",
      qa_visual: "Inline visual answer",
      qa: "Text answer",
    };
    details.push(`Output: ${routeLabels[String(metadata.route_mode)] ?? String(metadata.route_mode)}`);
  }
  if (metadata.chart_title || metadata.target_chart_id) {
    details.push(`Target chart: ${String(metadata.chart_title ?? metadata.target_chart_id)}`);
  }
  if (metadata.target_dashboard_id) {
    details.push(`Dashboard: ${String(metadata.target_dashboard_id)}`);
  }
  if (metadata.date_column) {
    details.push(`Date column: ${String(metadata.date_column)}`);
  }
  if (metadata.time_grain) {
    details.push(`Time grain: ${String(metadata.time_grain)}`);
  }
  if (metadata.metric_column) {
    details.push(`Metric: ${String(metadata.metric_column)}`);
  }
  if (metadata.aggregation) {
    details.push(`Aggregation: ${String(metadata.aggregation)}`);
  }
  if (metadata.join_strategy) {
    const joinLabels: Record<string, string> = {
      auto: "Infer best join",
      separate: "Analyze separately",
      left_join_first: "Use first file as base",
    };
    details.push(`Join strategy: ${joinLabels[String(metadata.join_strategy)] ?? String(metadata.join_strategy)}`);
  }
  if (metadata.update_scope) {
    const scopeLabels: Record<string, string> = {
      current: "Update current dashboard",
      new: "Create new dashboard",
    };
    details.push(`Scope: ${scopeLabels[String(metadata.update_scope)] ?? String(metadata.update_scope)}`);
  }
  if (metadata.next_action) {
    const actionLabels: Record<string, string> = {
      provide_data: "Add or connect data first",
    };
    details.push(`Next: ${actionLabels[String(metadata.next_action)] ?? String(metadata.next_action)}`);
  }
  if (metadata.context_request) {
    const contextLabels: Record<string, string> = {
      metric_scope: "Metric, period, or segment",
    };
    details.push(`Context: ${contextLabels[String(metadata.context_request)] ?? String(metadata.context_request)}`);
  }
  Object.entries(metadata).forEach(([key, value]) => {
    if ([
      "asset_selection",
      "asset_ids",
      "asset",
      "assets",
      "route_mode",
      "target_chart_id",
      "target_dashboard_id",
      "chart_title",
      "chart_type",
      "date_column",
      "time_grain",
      "metric_column",
      "aggregation",
      "join_strategy",
      "update_scope",
      "next_action",
      "context_request",
    ].includes(key)) return;
    if (value === null || value === undefined || typeof value === "object") return;
    details.push(`${key}: ${String(value)}`);
  });
  return details;
}

export function getLatestPendingClarificationMessage(
  messages: Message[],
  dismissedClarificationIds: Set<string> = new Set(),
): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return null;
    const clarificationId = message.clarificationRequest?.clarification_id;
    if (
      message.role === "assistant"
      && message.clarificationRequest
      && clarificationId
      && !message.clarificationResolution
      && !dismissedClarificationIds.has(clarificationId)
    ) {
      return message;
    }
  }
  return null;
}
