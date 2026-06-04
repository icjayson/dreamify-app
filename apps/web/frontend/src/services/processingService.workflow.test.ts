import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./conversationService", () => ({
  conversationService: {
    sendChatMessage: vi.fn(),
    getWorkflowStatus: vi.fn(),
    getDashboardData: vi.fn(),
  },
}));

import { conversationService } from "./conversationService";
import { processingService } from "./processingService";

const mockedConversationService = vi.mocked(conversationService);

function workflowStatus(status: string, metadata: Record<string, unknown> = {}) {
  return {
    conversation_id: "conversation_1",
    node_id: "workflow",
    status,
    metadata,
  };
}

describe("processingService.pollProcessingStatus workflow routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns clarification state without fetching dashboard data", async () => {
    mockedConversationService.getWorkflowStatus.mockResolvedValueOnce(
      workflowStatus("awaiting_user_input", {
        response_type: "clarification_request",
      })
    );

    const result = await processingService.pollProcessingStatus(
      "",
      "project_1",
      "conversation_1",
      undefined,
      1,
      0
    );

    expect(result.data?.status).toBe("awaiting_user_input");
    expect(result.data?.response_type).toBe("clarification_request");
    expect(mockedConversationService.getDashboardData).not.toHaveBeenCalled();
  });

  it("does not fetch dashboard data for text Q&A completion", async () => {
    const analysisSteps = [
      {
        index: 0,
        title: "Step 1: analysis",
        explanation: "Checked the requested metric before answering.",
      },
    ];
    mockedConversationService.getWorkflowStatus.mockResolvedValueOnce(
      workflowStatus("completed", {
        response_type: "message",
        content: "Sessions increased by 12%.",
        analysis_steps: analysisSteps,
      })
    );

    const result = await processingService.pollProcessingStatus(
      "",
      "project_1",
      "conversation_1",
      undefined,
      1,
      0
    );

    expect(result.data?.status).toBe("completed");
    expect(result.data?.response_type).toBe("message");
    expect(result.data?.analysis_steps).toEqual(analysisSteps);
    expect(result.data?.dashboard_data).toBeUndefined();
    expect(mockedConversationService.getDashboardData).not.toHaveBeenCalled();
  });

  it("does not fetch dashboard data for Q&A visual completion", async () => {
    const analysisSteps = [
      {
        index: 0,
        title: "Build visual answer",
        explanation: "Prepared the chart used in the visual answer.",
      },
    ];
    mockedConversationService.getWorkflowStatus.mockResolvedValueOnce(
      workflowStatus("completed", {
        response_type: "answer_with_visual",
        artifact_count: 1,
        analysis_steps: analysisSteps,
      })
    );

    const result = await processingService.pollProcessingStatus(
      "",
      "project_1",
      "conversation_1",
      undefined,
      1,
      0
    );

    expect(result.data?.status).toBe("completed");
    expect(result.data?.response_type).toBe("answer_with_visual");
    expect(result.data?.analysis_steps).toEqual(analysisSteps);
    expect(result.data?.dashboard_data).toBeUndefined();
    expect(mockedConversationService.getDashboardData).not.toHaveBeenCalled();
  });

  it("fetches dashboard data for dashboard completion", async () => {
    const dashboard = {
      dashboard_id: "dash_1",
      dashboard_data: { dashboard: { title: "Sales" }, charts: [] },
      analysis_steps: [
        {
          index: 0,
          title: "Calculate revenue",
          explanation: "Summed the revenue column.",
        },
      ],
      change_summary: { human_summary: "Changed Revenue to a line chart." },
      computed_values: {
        python_code: ["print(df['revenue'].sum())"],
        computed_values: { total: 120 },
      },
    };
    mockedConversationService.getWorkflowStatus.mockResolvedValueOnce(
      workflowStatus("completed", {
        response_type: "dashboard_config",
        edit_note: "Kept the original chart because the edit returned no data.",
      })
    );
    mockedConversationService.getDashboardData.mockResolvedValueOnce(dashboard);

    const result = await processingService.pollProcessingStatus(
      "asset_1",
      "project_1",
      "conversation_1",
      undefined,
      1,
      0
    );

    expect(result.data?.status).toBe("completed");
    expect(result.data?.dashboard_id).toBe("dash_1");
    expect(result.data?.dashboard_data).toEqual(dashboard.dashboard_data);
    expect(result.data?.change_summary).toEqual(dashboard.change_summary);
    expect(result.data?.computed_values).toEqual(dashboard.computed_values);
    expect(result.data?.analysis_steps).toEqual(dashboard.analysis_steps);
    expect(result.data?.edit_note).toBe(
      "Kept the original chart because the edit returned no data."
    );
    expect(mockedConversationService.getDashboardData).toHaveBeenCalledWith(
      "conversation_1",
      "project_1"
    );
  });

  it("maps workflow errors to failed processing responses", async () => {
    mockedConversationService.getWorkflowStatus.mockResolvedValueOnce(
      workflowStatus("error", { error: "Morpheus service unavailable" })
    );

    const result = await processingService.pollProcessingStatus(
      "",
      "project_1",
      "conversation_1",
      undefined,
      1,
      0
    );

    expect(result.success).toBe(false);
    expect(result.data?.status).toBe("error");
    expect(result.data?.error).toBe("Morpheus service unavailable");
  });
});
