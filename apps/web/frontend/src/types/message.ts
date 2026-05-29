import type { DashboardComponent } from "@/types/dashboard";

export type AssetSelectionMode = "none" | "explicit" | "all";
export const EXPLICIT_PROMPT_THEME_SOURCE = "explicit_prompt_selection";

export type ClarificationReasonCode =
  | "missing_data_context"
  | "multiple_matching_assets"
  | "analysis_context"
  | "chart_target"
  | "dashboard_update_scope"
  | "join_strategy"
  | "time_or_metric_definition"
  | "output_mode"
  | string;

export interface ClarificationOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  impact?: string;
  metadata?: {
    asset_ids?: string[];
    asset_selection?: AssetSelectionMode;
    [key: string]: unknown;
  };
}

export interface ClarificationRequest {
  clarification_id: string;
  reason_code: ClarificationReasonCode;
  question: string;
  options: ClarificationOption[];
  allow_free_text?: boolean;
  required?: boolean;
}

export interface ClarificationResolution {
  clarification_id: string;
  status: "no_answer";
  question: string;
  resolved_at?: string;
}

/** One answered clarification, collected client-side before a single submit. */
export interface ClarificationAnswer {
  request: ClarificationRequest;
  option: ClarificationOption;
  freeText?: string;
}

export interface ThinkingEvent {
  id: string;
  run_id: string;
  sequence: number;
  phase: "queued" | "context" | "routing" | "analysis" | "tool" | "synthesis" | "validation" | "final" | "error" | string;
  status: "pending" | "active" | "completed" | "error" | string;
  title: string;
  summary?: string | null;
  detail?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isError?: boolean;
  isInsufficientCredits?: boolean;
  attachment?: {
    kind: "csv" | "file";
    name: string;
    mime?: string;
    sourceType?: string;
    accountName?: string;
    propertyName?: string;
    syncVersionName?: string;
    files?: Array<{
      id: string;
      name: string;
      ext?: string;
      sourceType?: string;
      accountName?: string;
      propertyName?: string;
      syncVersionName?: string;
    }>;
  };
  /** Charts referenced via @chart mention */
  chartMentions?: Array<{
    title: string;
    type: string;
    componentId: string;
  }>;
  template?: {
    id: string;
    title: string;
    description: string;
    image?: string;
    category: string;
    suggestedTheme?: string;
    analysisFocusId?: string;
    analysisFocusName?: string;
  };
  dashboardCard?: {
    sourceFileName: string;
    dashboardId: string;
    dashboardTitle?: string;
    accountName?: string;
    sourceType?: string;
  };
  visualArtifacts?: Array<{
    id: string;
    kind: "chart" | "table";
    title: string;
    description?: string;
    component: DashboardComponent;
  }>;
  todoTasks?: Array<{
    id: string;
    text: string;
  }>;
  clarificationRequests?: ClarificationRequest[];
  clarificationResolution?: ClarificationResolution;
  thinkingTrace?: ThinkingEvent[];
}
