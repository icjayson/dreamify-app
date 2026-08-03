import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisStep } from "@/types/chartEdit";
import type { ThinkingEvent } from "@/types/message";
import { ActivityPanel } from "./ActivityPanel";

const store = vi.hoisted(() => ({
  state: {
    currentConversationId: null as string | null,
    currentProjectId: null as string | null,
    thinkingEvents: [] as ThinkingEvent[],
    analysisSteps: null as AnalysisStep[] | null,
    setActivityOpen: vi.fn(),
  },
}));

vi.mock("@/chat/useChatStore", () => ({
  useChatStore: (selector: (state: typeof store.state) => unknown) => selector(store.state),
}));

vi.mock("@/services/conversationService", () => ({
  conversationService: {
    getWorkflowEvents: vi.fn(),
  },
}));

function makeEvent(overrides: Partial<ThinkingEvent>): ThinkingEvent {
  return {
    id: overrides.id ?? "evt",
    run_id: overrides.run_id ?? "run",
    sequence: overrides.sequence ?? 0,
    phase: overrides.phase ?? "analysis",
    status: overrides.status ?? "completed",
    title: overrides.title ?? "step",
    summary: overrides.summary,
    metadata: overrides.metadata,
    duration_ms: overrides.duration_ms,
  };
}

describe("ActivityPanel", () => {
  beforeEach(() => {
    store.state.currentConversationId = null;
    store.state.currentProjectId = null;
    store.state.thinkingEvents = [];
    store.state.analysisSteps = null;
    store.state.setActivityOpen.mockClear();
  });

  it("opens as a nonblank restoring panel before local activity has loaded", () => {
    store.state.currentConversationId = "conv_1";
    store.state.currentProjectId = "project_1";

    const markup = renderToStaticMarkup(<ActivityPanel />);

    expect(markup).toContain("Activity");
    expect(markup).toContain("How the numbers were calculated");
    expect(markup).toContain("Restoring activity");
    expect(markup).toContain("data-export-exclude");
  });

  it("renders reasoning rows and collapsed technical details when activity is available", () => {
    store.state.currentConversationId = "conv_1";
    store.state.currentProjectId = "project_1";
    store.state.thinkingEvents = [
      makeEvent({
        id: "reasoning",
        sequence: 0,
        phase: "analysis",
        title: "Infer the join strategy",
        summary: "Matched both snapshots by date before calculating trends.",
      }),
      makeEvent({
        id: "execution",
        sequence: 1,
        phase: "execution",
        title: "Calculate daily totals",
        summary: "Ran the aggregation.",
        metadata: { python: "df.groupby('date').sum()", output: "4 rows", step_index: 0 },
      }),
    ];
    store.state.analysisSteps = [
      {
        index: 0,
        title: "Calculate daily totals",
        python: "df.groupby('date').sum()",
        output: "4 rows",
        explanation: "Summed each series by date.",
      },
    ];

    const markup = renderToStaticMarkup(<ActivityPanel />);

    expect(markup).toContain("Matched both snapshots by date before calculating trends.");
    expect(markup).toContain("Summed each series by date.");
    expect(markup).toContain(">Details<");
    expect(markup).not.toContain("df.groupby(&#x27;date&#x27;).sum()");
    expect(markup).not.toContain("4 rows");
    expect(markup).not.toContain("Restoring activity");
  });

  it("uses plain-English fallback when a technical step has no explanation", () => {
    store.state.currentConversationId = "conv_1";
    store.state.currentProjectId = "project_1";
    store.state.thinkingEvents = [
      makeEvent({
        id: "execution",
        sequence: 0,
        phase: "execution",
        title: "robust read attempts",
        summary: "Ran a calculation and saved the result used in the dashboard.",
        metadata: { python: "df.sum()", output: "42", step_index: 0 },
      }),
    ];

    const markup = renderToStaticMarkup(<ActivityPanel />);

    expect(markup).toContain("Loaded the data carefully and retried with safer read settings.");
    expect(markup).toContain("Technical step: robust read attempts");
    expect(markup).toContain(">Details<");
  });

  it("renders the embedded chat-pane header with back navigation", () => {
    store.state.currentConversationId = "conv_1";
    store.state.currentProjectId = "project_1";
    store.state.thinkingEvents = [
      makeEvent({
        id: "reasoning",
        sequence: 0,
        phase: "analysis",
        title: "Infer the join strategy",
      }),
    ];

    const markup = renderToStaticMarkup(
      <ActivityPanel variant="embedded" onClose={() => undefined} />,
    );

    expect(markup).toContain("Back to chat");
    expect(markup).toContain("Activity");
    expect(markup).toContain("1 step");
    expect(markup).not.toContain("Close activity");
  });
});
