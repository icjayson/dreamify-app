import { describe, expect, it } from "vitest";
import type { ClarificationOption, Message } from "@/types/message";
import {
  getClarificationKeyboardAction,
  getClarificationOptionDetails,
  getDefaultClarificationOptionId,
  getLatestPendingClarificationMessage,
  moveClarificationSelection,
} from "./clarificationOverlayUtils";

const options: ClarificationOption[] = [
  {
    id: "asset:ga4",
    label: "GA4 Web Visitors",
    description: "Matches web visitor trend",
    recommended: true,
    impact: "Uses sessions and active users from GA4",
    metadata: {
      asset_ids: ["ga4_asset"],
      asset_selection: "explicit",
      source: "GA4",
    },
  },
  {
    id: "asset:ads",
    label: "Google Ads",
    description: "Use campaign traffic instead",
    metadata: {
      asset_ids: ["ads_asset"],
      asset_selection: "explicit",
    },
  },
  {
    id: "none",
    label: "No data yet",
    metadata: {
      asset_selection: "none",
    },
  },
];

const createMessage = (
  id: string,
  role: Message["role"],
  overrides: Partial<Message> = {},
): Message => ({
  id,
  role,
  content: "",
  timestamp: new Date("2026-05-16T00:00:00Z"),
  ...overrides,
});

describe("clarification overlay option helpers", () => {
  it("selects the recommended option by default", () => {
    expect(getDefaultClarificationOptionId(options)).toBe("asset:ga4");
  });

  it("falls back to the first option when none is recommended", () => {
    expect(getDefaultClarificationOptionId(options.map((option) => ({ ...option, recommended: false })))).toBe(
      "asset:ga4",
    );
  });

  it("moves selection with wraparound", () => {
    expect(moveClarificationSelection(options, "asset:ga4", 1)).toBe("asset:ads");
    expect(moveClarificationSelection(options, "asset:ga4", -1)).toBe("none");
    expect(moveClarificationSelection(options, undefined, 1)).toBe("asset:ads");
  });

  it("builds tooltip details from description, impact, and metadata", () => {
    expect(getClarificationOptionDetails(options[0])).toEqual([
      "Matches web visitor trend",
      "Impact: Uses sessions and active users from GA4",
      "Data scope: explicit",
      "1 selected data source",
      "source: GA4",
    ]);
  });

  it("renders agentic non-asset decision metadata as readable details", () => {
    expect(getClarificationOptionDetails({
      id: "inline_visual",
      label: "Inline visual answer",
      description: "Answer in chat",
      impact: "Fastest visual path",
      metadata: {
        route_mode: "qa_visual",
        target_chart_id: "chart_1",
        chart_title: "Revenue Trend",
        date_column: "created_at",
        time_grain: "weekly",
        metric_column: "revenue",
        aggregation: "sum",
        join_strategy: "auto",
        update_scope: "current",
        next_action: "provide_data",
        context_request: "metric_scope",
      },
    })).toEqual([
      "Answer in chat",
      "Impact: Fastest visual path",
      "Output: Inline visual answer",
      "Target chart: Revenue Trend",
      "Date column: created_at",
      "Time grain: weekly",
      "Metric: revenue",
      "Aggregation: sum",
      "Join strategy: Infer best join",
      "Scope: Update current dashboard",
      "Next: Add or connect data first",
      "Context: Metric, period, or segment",
    ]);
  });
});

describe("clarification overlay keyboard helpers", () => {
  it("maps arrow keys, enter, and escape", () => {
    expect(getClarificationKeyboardAction({ key: "ArrowUp" })).toBe("previous");
    expect(getClarificationKeyboardAction({ key: "ArrowDown" })).toBe("next");
    expect(getClarificationKeyboardAction({ key: "Enter" })).toBe("submit");
    expect(getClarificationKeyboardAction({ key: "Escape" })).toBe("dismiss");
  });

  it("does not submit from the note field unless command or control is held", () => {
    expect(getClarificationKeyboardAction({ key: "Enter", isNoteFocused: true })).toBe("none");
    expect(getClarificationKeyboardAction({ key: "Enter", isNoteFocused: true, metaKey: true })).toBe("submit");
    expect(getClarificationKeyboardAction({ key: "Enter", isNoteFocused: true, ctrlKey: true })).toBe("submit");
  });
});

describe("pending clarification detection", () => {
  it("returns the latest unresolved assistant clarification", () => {
    const pendingAssistant = createMessage("assistant_1", "assistant", {
      clarificationRequests: [{
        clarification_id: "clarify_1",
        reason_code: "missing_data_context",
        question: "Choose the data context",
        options,
      }],
    });

    expect(getLatestPendingClarificationMessage([createMessage("user_1", "user"), pendingAssistant])).toBe(
      pendingAssistant,
    );
  });

  it("does not return an older clarification after a later user message", () => {
    const pendingAssistant = createMessage("assistant_1", "assistant", {
      clarificationRequests: [{
        clarification_id: "clarify_1",
        reason_code: "missing_data_context",
        question: "Choose the data context",
        options,
      }],
    });

    expect(
      getLatestPendingClarificationMessage([
        createMessage("user_1", "user"),
        pendingAssistant,
        createMessage("user_2", "user"),
      ]),
    ).toBeNull();
  });

  it("respects locally dismissed clarification ids", () => {
    const pendingAssistant = createMessage("assistant_1", "assistant", {
      clarificationRequests: [{
        clarification_id: "clarify_1",
        reason_code: "missing_data_context",
        question: "Choose the data context",
        options,
      }],
    });

    expect(getLatestPendingClarificationMessage([pendingAssistant], new Set(["clarify_1"]))).toBeNull();
  });

  it("does not return a clarification resolved with no answer", () => {
    const resolvedAssistant = createMessage("assistant_1", "assistant", {
      clarificationRequests: [{
        clarification_id: "clarify_1",
        reason_code: "missing_data_context",
        question: "Choose the data context",
        options,
      }],
      clarificationResolution: {
        clarification_id: "clarify_1",
        status: "no_answer",
        question: "Choose the data context",
      },
    });

    expect(getLatestPendingClarificationMessage([resolvedAssistant])).toBeNull();
  });
});
