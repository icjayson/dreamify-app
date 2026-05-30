import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClarificationAnswer, ClarificationRequest } from "@/types/message";
import type { UploadedFile } from "./useChatStore";

vi.mock("@/services/processingService", () => ({
  processingService: {
    runProcessing: vi.fn(),
    pollProcessingStatus: vi.fn(),
    getWorkflowStatus: vi.fn(),
  },
}));

vi.mock("@/services/conversationService", () => ({
  conversationService: {
    loadConversation: vi.fn(),
    getDashboardData: vi.fn(),
    stopWorkflow: vi.fn(),
    updateDashboardTheme: vi.fn(),
  },
}));

vi.mock("@/services/fileService", () => ({
  fileService: {
    getAsset: vi.fn(),
  },
}));

import { useChatStore } from "./useChatStore";
import { processingService } from "@/services/processingService";
import { conversationService } from "@/services/conversationService";
import { fileService } from "@/services/fileService";

const mockedProcessingService = vi.mocked(processingService);
const mockedConversationService = vi.mocked(conversationService);
const mockedFileService = vi.mocked(fileService);

function createLocalStorageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function resetStore() {
  useChatStore.setState({
    inputValue: "",
    isTyping: false,
    messages: [],
    uploadedFiles: [],
    currentConversationId: "conversation_1",
    currentProjectId: "project_1",
    isProcessing: false,
    selectedDashboardId: null,
    selectedTheme: null,
    selectedAnalysisFocusId: null,
    selectedTemplate: null,
    isThemePending: false,
    isTemplatePending: false,
    abortController: null,
    thinkingEvents: [],
    priorWorkflowSteps: [],
    isDashboardOpen: false,
    hasShownInitialDashboard: false,
    isInitialLoading: false,
    isUpdatingDashboard: false,
  });
}

const completedPollingResult = {
  success: true,
  data: {
    success: true,
    status: "completed" as const,
    fileID: "",
    conversation_id: "conversation_1",
  },
};

function userNode(node_id: string, text: string, extraContents = []) {
  return {
    node_id,
    role: "user",
    created_at: "2026-05-30T00:00:00Z",
    contents: [
      { type: "text", data: { text } },
      ...extraContents,
    ],
  };
}

function assistantTextNode(node_id: string, text: string, extraContents = []) {
  return {
    node_id,
    role: "assistant",
    created_at: "2026-05-30T00:00:01Z",
    contents: [
      { type: "text", data: { text } },
      ...extraContents,
    ],
  };
}

describe("useChatStore agentic user flows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createLocalStorageStub());
    localStorage.clear();
    resetStore();
    mockedProcessingService.runProcessing.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "accepted",
        fileID: "",
        conversation_id: "conversation_1",
      },
    });
    mockedProcessingService.pollProcessingStatus.mockResolvedValue(completedPollingResult);
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_1", "Infer best join\nInline visual answer"),
          assistantTextNode("assistant_1", "Done."),
        ],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("submits a batched ask-first answer as one continuation turn", async () => {
    const joinRequest: ClarificationRequest = {
      clarification_id: "clarify_join",
      reason_code: "join_strategy",
      question: "How should I combine these files?",
      options: [{ id: "auto_join", label: "Infer best join", metadata: { join_strategy: "auto" } }],
    };
    const outputRequest: ClarificationRequest = {
      clarification_id: "clarify_output",
      reason_code: "output_mode",
      question: "What should I produce?",
      options: [{ id: "inline_visual", label: "Inline visual answer", metadata: { route_mode: "qa_visual" } }],
    };
    const answers: ClarificationAnswer[] = [
      { request: joinRequest, option: joinRequest.options[0] },
      { request: outputRequest, option: outputRequest.options[0], freeText: "Focus on revenue trend" },
    ];

    await useChatStore.getState().submitClarificationResponse(answers, "project_1");

    expect(mockedProcessingService.runProcessing).toHaveBeenCalledTimes(1);
    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[0]).toBe("project_1");
    expect(call[1]).toBeNull();
    expect(call[2]).toBe("Infer best join\nInline visual answer\nFocus on revenue trend");
    expect(call[3]).toBe("conversation_1");
    expect(call[4]).toEqual([
      {
        type: "clarification_response",
        data: {
          clarification_id: "clarify_join",
          selected_option_id: "auto_join",
          selected_option_label: "Infer best join",
          free_text: null,
          metadata: { join_strategy: "auto" },
        },
      },
      {
        type: "clarification_response",
        data: {
          clarification_id: "clarify_output",
          selected_option_id: "inline_visual",
          selected_option_label: "Inline visual answer",
          free_text: "Focus on revenue trend",
          metadata: { route_mode: "qa_visual" },
        },
      },
    ]);
    expect(call[5]).toEqual({
      asset_selection: "none",
      clarification_id: "clarify_join",
      clarification_ids: ["clarify_join", "clarify_output"],
    });
  });

  it("generates a dashboard from a fresh upload and opens the returned dashboard card", async () => {
    const dashboardData = {
      dashboard: { title: "Sales Dashboard" },
      theme_id: "cobalt",
      charts: [],
      metrics: [],
    };
    const uploadedFile: UploadedFile = {
      fileID: "asset_1",
      filename: "sales.csv",
      size: 2048,
      ext: "csv",
      status: "uploaded",
      projectId: "project_1",
    };
    const onProcessedDataChange = vi.fn();

    useChatStore.setState({
      currentConversationId: null,
      uploadedFiles: [uploadedFile],
    });
    mockedFileService.getAsset.mockResolvedValue({
      success: true,
      asset: {
        asset_id: "asset_1",
        file_id: "file_1",
        s3_bucket: "bucket",
        s3_key: "users/user_1/projects/project_1/assets/asset_1/file_1.csv",
        extension: "csv",
        filename: "sales.csv",
      },
    });
    mockedProcessingService.runProcessing.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "accepted",
        fileID: "asset_1",
        conversation_id: "conversation_dash",
      },
    });
    mockedProcessingService.pollProcessingStatus.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "asset_1",
        conversation_id: "conversation_dash",
        dashboard_data: dashboardData,
      },
    });
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_1", "Generate a dashboard", [
            { type: "asset", data: { asset_id: "asset_1", filename: "sales.csv", extension: "csv" } },
          ]),
          assistantTextNode("assistant_1", "Your dashboard is ready.", [
            { type: "dashboard", data: { dashboard_id: "dash_1" } },
          ]),
        ],
        dashboards: [{ dashboard_id: "dash_1", title: "Sales Dashboard" }],
      },
    });

    await useChatStore
      .getState()
      .processFileWithMessage("Generate a dashboard", onProcessedDataChange, "project_1");

    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[1]).toBe("asset_1");
    expect(call[4]).toEqual([
      {
        type: "asset",
        data: expect.objectContaining({
          asset_id: "asset_1",
          file_id: "file_1",
          s3_bucket: "bucket",
          s3_key: "users/user_1/projects/project_1/assets/asset_1/file_1.csv",
          filename: "sales.csv",
        }),
      },
    ]);
    expect(call[5]).toEqual({
      asset_selection: "explicit",
      selected_asset_ids: ["asset_1"],
    });
    expect(onProcessedDataChange).toHaveBeenCalledWith(dashboardData);
    expect(useChatStore.getState().selectedDashboardId).toBe("dash_1");
    expect(useChatStore.getState().isDashboardOpen).toBe(true);
    expect(useChatStore.getState().messages.at(-1)?.dashboardCard?.dashboardId).toBe("dash_1");
  });

  it("runs text Q&A without attaching restored project data by default", async () => {
    const onProcessedDataChange = vi.fn();
    useChatStore.setState({
      uploadedFiles: [
        {
          fileID: "historical_asset",
          filename: "ga4.csv",
          size: 1024,
          ext: "csv",
          status: "processed",
          conversationId: "conversation_1",
          projectId: "project_1",
        },
      ],
    });
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_1", "What changed last week?", []),
          assistantTextNode("assistant_1", "Sessions increased by 12%."),
        ],
      },
    });

    await useChatStore
      .getState()
      .processFileWithMessage("What changed last week?", onProcessedDataChange, "project_1");

    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[1]).toBeNull();
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ asset_selection: "none" });
    expect(onProcessedDataChange).not.toHaveBeenCalled();
    expect(useChatStore.getState().isDashboardOpen).toBe(false);
    expect(useChatStore.getState().messages.at(-1)?.content).toBe("Sessions increased by 12%.");
  });

  it("runs Q&A with a chart mention and restores the inline visual answer", async () => {
    const chartMention = {
      id: "chart_1",
      componentId: "component_1",
      title: "Revenue Trend",
      type: "line",
      config: { title: "Revenue Trend", datasets: [] },
    };
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_1", "Explain this chart", [
            {
              type: "chart_mention",
              data: {
                component_id: "component_1",
                chart_id: "chart_1",
                title: "Revenue Trend",
                chart_type: "line",
              },
            },
          ]),
          assistantTextNode("assistant_1", "Revenue is accelerating week over week.", [
            {
              type: "visual_artifacts",
              data: {
                artifacts: [
                  {
                    id: "artifact_1",
                    kind: "chart",
                    title: "Weekly revenue",
                    chart_type: "line",
                    datasets: [{ label: "Revenue", data: [{ label: "W1", value: 100 }] }],
                  },
                ],
              },
            },
          ]),
        ],
      },
    });

    await useChatStore
      .getState()
      .processFileWithMessage(
        "Explain this chart",
        undefined,
        "project_1",
        [],
        undefined,
        [chartMention],
      );

    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[4]).toEqual([
      {
        type: "chart_mention",
        data: {
          component_id: "component_1",
          chart_id: "chart_1",
          title: "Revenue Trend",
          chart_type: "line",
          config: chartMention.config,
        },
      },
    ]);
    expect(call[5]).toEqual({
      asset_selection: "none",
      selected_chart_ids: ["component_1"],
    });
    expect(useChatStore.getState().messages[0].chartMentions).toEqual([
      { title: "Revenue Trend", type: "line", componentId: "component_1" },
    ]);
    expect(useChatStore.getState().messages.at(-1)?.visualArtifacts?.[0]).toEqual(
      expect.objectContaining({
        id: "artifact_1",
        kind: "chart",
        title: "Weekly revenue",
      }),
    );
  });
});
