import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLICIT_PROMPT_THEME_SOURCE, type ClarificationAnswer, type ClarificationRequest } from "@/types/message";
import { createThemeSelection } from "@/constants/builtinTemplates";
import type { UploadedFile } from "./useChatStore";

vi.mock("@/services/processingService", () => ({
  processingService: {
    runProcessing: vi.fn(),
    pollProcessingStatus: vi.fn(),
    getWorkflowStatus: vi.fn(),
  },
}));

// Stream is unavailable in tests; force the polling fallback path.
vi.mock("@/services/workflowStreamService", () => ({
  streamWorkflow: vi.fn(async () => ({ connected: false })),
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
import { processingService, type ProcessingResponse } from "@/services/processingService";
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
    isStreamingWorkflow: false,
    isDashboardOpen: false,
    hasShownInitialDashboard: false,
    isInitialLoading: false,
    isUpdatingDashboard: false,
    applyingComponentIds: new Set<string>(),
    pendingEdit: null,
    pendingAction: null,
    editChangeSummary: null,
    editProvenance: null,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
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
    const analysisSteps = [
      {
        index: 0,
        title: "Calculate sales totals",
        explanation: "Summed the sales values used in the dashboard.",
      },
    ];
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
        project_id: "project_1",
        s3_bucket: "bucket",
        s3_key: "users/user_1/projects/project_1/assets/asset_1/file_1.csv",
        extension: "csv",
        filename: "sales.csv",
        status: "uploaded",
        size_bytes: 2048,
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
        analysis_steps: analysisSteps,
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
    expect(useChatStore.getState().analysisSteps).toEqual(analysisSteps);
    expect(useChatStore.getState().messages.at(-1)?.dashboardCard?.dashboardId).toBe("dash_1");
  });

  it("keeps a pre-conversation template through pending-action navigation reset", async () => {
    const templateSelection = createThemeSelection("cobalt", "saas_growth");
    const dashboardData = {
      dashboard: { title: "SaaS Growth Dashboard" },
      theme_id: "cobalt",
      analysis_focus_id: "saas_growth",
      charts: [],
      metrics: [],
    };
    const uploadedFile: UploadedFile = {
      fileID: "asset_template",
      filename: "growth.csv",
      size: 4096,
      ext: "csv",
      status: "uploaded",
      projectId: "project_template",
    };
    const onProcessedDataChange = vi.fn();

    useChatStore.setState({
      currentConversationId: null,
      currentProjectId: null,
      selectedTheme: templateSelection,
      selectedTemplate: templateSelection,
      selectedAnalysisFocusId: templateSelection.analysisFocusId ?? null,
      isThemePending: true,
      isTemplatePending: true,
      uploadedFiles: [uploadedFile],
    });
    useChatStore.getState().setPendingAction({
      type: "process_file",
      content: "Generate a SaaS growth dashboard",
      files: [uploadedFile],
      projectId: "project_template",
      model: "pro",
      templateSelection,
    });

    useChatStore.getState().resetChat();
    useChatStore.getState().setCurrentProjectId("project_template");
    const pendingAction = useChatStore.getState().pendingAction;
    expect(useChatStore.getState().selectedTemplate).toBeNull();
    expect(pendingAction?.templateSelection).toEqual(templateSelection);

    useChatStore.getState().addFiles(pendingAction?.files ?? []);
    if (pendingAction?.model) {
      useChatStore.getState().setSelectedModel(pendingAction.model);
    }
    if (pendingAction?.templateSelection) {
      useChatStore.getState().setSelectedTemplate(pendingAction.templateSelection, true);
    }

    mockedFileService.getAsset.mockResolvedValue({
      success: true,
      asset: {
        asset_id: "asset_template",
        file_id: "file_template",
        project_id: "project_template",
        s3_bucket: "bucket",
        s3_key: "users/user_1/projects/project_template/assets/asset_template/file_template.csv",
        extension: "csv",
        filename: "growth.csv",
        status: "uploaded",
        size_bytes: 4096,
      },
    });
    mockedProcessingService.runProcessing.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "accepted",
        fileID: "asset_template",
        conversation_id: "conversation_template",
      },
    });
    mockedProcessingService.pollProcessingStatus.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "asset_template",
        conversation_id: "conversation_template",
        dashboard_data: dashboardData,
      },
    });
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_template", "Generate a SaaS growth dashboard", [
            { type: "asset", data: { asset_id: "asset_template", filename: "growth.csv", extension: "csv" } },
          ]),
          assistantTextNode("assistant_template", "Your dashboard is ready.", [
            { type: "dashboard", data: { dashboard_id: "dash_template" } },
          ]),
        ],
        dashboards: [{ dashboard_id: "dash_template", title: "SaaS Growth Dashboard" }],
      },
    });

    await useChatStore.getState().processFileWithMessage(
      pendingAction?.content ?? "",
      onProcessedDataChange,
      "project_template",
      undefined,
      undefined,
      undefined,
      pendingAction?.model,
    );

    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[0]).toBe("project_template");
    expect(call[6]).toBe("pro");
    expect(call[7]).toBe("cobalt");
    expect(call[8]).toBe("saas_growth");
    expect(call[5]).toEqual({
      asset_selection: "explicit",
      selected_asset_ids: ["asset_template"],
      theme_source: EXPLICIT_PROMPT_THEME_SOURCE,
    });
    expect(onProcessedDataChange).toHaveBeenCalledWith(dashboardData);
    expect(useChatStore.getState().selectedTemplate).toEqual(templateSelection);
    expect(useChatStore.getState().isTemplatePending).toBe(false);
    expect(useChatStore.getState().selectedDashboardId).toBe("dash_template");
  });

  it("runs text Q&A without attaching restored project data by default", async () => {
    const onProcessedDataChange = vi.fn();
    const analysisSteps = [
      {
        index: 0,
        title: "Check weekly change",
        explanation: "Checked the weekly metric before answering.",
      },
    ];
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
    mockedProcessingService.pollProcessingStatus.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_1",
        response_type: "message",
        analysis_steps: analysisSteps,
      },
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
    expect(useChatStore.getState().analysisSteps).toEqual(analysisSteps);
    expect(useChatStore.getState().messages.at(-1)?.content).toBe("Sessions increased by 12%.");
  });

  it("runs Q&A with a chart mention and restores the inline visual answer", async () => {
    const analysisSteps = [
      {
        index: 0,
        title: "Build chart explanation",
        explanation: "Compared the chart points before writing the visual answer.",
      },
    ];
    const chartMention = {
      id: "chart_1",
      componentId: "component_1",
      title: "Revenue Trend",
      type: "line",
      config: { title: "Revenue Trend", datasets: [] },
    };
    mockedProcessingService.pollProcessingStatus.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_1",
        response_type: "answer_with_visual",
        analysis_steps: analysisSteps,
      },
    });
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
          // No dashboard selected here, so the edit-target id is null.
          dashboard_id: null,
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
    expect(useChatStore.getState().analysisSteps).toEqual(analysisSteps);
  });

  it("keeps only the mentioned chart in applying state until edited dashboard data lands", async () => {
    const polling = deferred<ProcessingResponse>();
    const onProcessedDataChange = vi.fn();
    const dashboardData = {
      dashboard: { title: "Updated revenue dashboard" },
      charts: [{ id: "chart_1", title: "Revenue Trend" }],
      metrics: [],
    };
    const chartMention = {
      id: "chart_1",
      componentId: "component_1",
      title: "Revenue Trend",
      type: "line",
      config: { title: "Revenue Trend", datasets: [] },
    };

    useChatStore.setState({
      isDashboardOpen: true,
      selectedDashboardId: "dash_1",
    });
    mockedProcessingService.pollProcessingStatus.mockReturnValue(polling.promise);
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_1", "Make this chart a bar", [
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
          assistantTextNode("assistant_1", "", [
            { type: "dashboard", data: { dashboard_id: "dash_1" } },
          ]),
        ],
        dashboards: [{ dashboard_id: "dash_1", title: "Updated revenue dashboard" }],
      },
    });

    const run = useChatStore
      .getState()
      .processFileWithMessage(
        "Make this chart a bar",
        onProcessedDataChange,
        "project_1",
        [],
        undefined,
        [chartMention],
      );
    await flushPromises();

    expect([...useChatStore.getState().applyingComponentIds].sort()).toEqual([
      "chart_1",
      "component_1",
    ]);

    polling.resolve({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_1",
        dashboard_data: dashboardData,
      },
    });
    await run;

    expect(useChatStore.getState().applyingComponentIds.size).toBe(0);
    expect(onProcessedDataChange).toHaveBeenCalledWith(dashboardData);
    const completion = useChatStore.getState().messages.find((message) => message.isEditCompletion);
    expect(completion?.dashboardCard).toBeUndefined();
    expect(completion?.content).toContain("Revenue Trend");
  });

  it("sends the currently-viewed dashboard id with each chart_mention edit", async () => {
    const chartMention = {
      id: "chart_1",
      componentId: "component_1",
      title: "Revenue Trend",
      type: "line",
      config: { title: "Revenue Trend", datasets: [] },
    };
    // User is viewing dashboard A while editing one of its charts.
    useChatStore.setState({ isDashboardOpen: true, selectedDashboardId: "dash_A" });
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [userNode("user_1", "Make this a bar chart", [])],
      },
    });

    await useChatStore
      .getState()
      .processFileWithMessage(
        "Make this a bar chart",
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
          dashboard_id: "dash_A",
        },
      },
    ]);
  });

  it("stays on the edited dashboard on completion instead of jumping to the latest", async () => {
    const onProcessedDataChange = vi.fn();
    const editedDashboardData = {
      dashboard: { title: "Dashboard A" },
      charts: [{ id: "chart_1", title: "Revenue Trend (bar)" }],
      metrics: [],
    };
    const editSummary = {
      human_summary: "Changed Revenue Trend to a bar chart.",
      chart_type_from: "line",
      chart_type_to: "bar",
    };
    const editProvenance = {
      python_code: ["df['revenue'].sum()"],
      computed_values: { total_revenue: 42 },
    };
    const analysisSteps = [
      {
        index: 0,
        title: "Recompute revenue trend",
        explanation: "Recomputed the values for the edited chart.",
      },
    ];
    const chartMention = {
      id: "chart_1",
      componentId: "component_1",
      title: "Revenue Trend",
      type: "line",
      config: { title: "Revenue Trend", datasets: [] },
    };

    // Editing a chart on dashboard A, but the conversation's LAST dashboard is B.
    useChatStore.setState({ isDashboardOpen: true, selectedDashboardId: "dash_A" });
    mockedProcessingService.pollProcessingStatus.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_1",
        // Polling fetches the latest dashboard (B) — the bug we are fixing.
        dashboard_data: { dashboard: { title: "Dashboard B" }, charts: [], metrics: [] },
      },
    });
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_1", "Make this a bar chart", [
            {
              type: "chart_mention",
              data: { component_id: "component_1", chart_id: "chart_1", title: "Revenue Trend", chart_type: "line" },
            },
          ]),
          assistantTextNode("assistant_1", "", [
            { type: "dashboard", data: { dashboard_id: "dash_A" } },
          ]),
        ],
        dashboards: [
          { dashboard_id: "dash_A", title: "Dashboard A" },
          { dashboard_id: "dash_B", title: "Dashboard B" },
        ],
      },
    });
    // The targeted re-fetch returns the edited dashboard A's data.
    mockedConversationService.getDashboardData.mockResolvedValue({
      dashboard_id: "dash_A",
      dashboard_data: editedDashboardData,
      change_summary: editSummary,
      computed_values: editProvenance,
      analysis_steps: analysisSteps,
    });

    await useChatStore
      .getState()
      .processFileWithMessage(
        "Make this a bar chart",
        onProcessedDataChange,
        "project_1",
        [],
        undefined,
        [chartMention],
      );

    // Selected the edited dashboard A, NOT the conversation's latest (dash_B).
    expect(useChatStore.getState().selectedDashboardId).toBe("dash_A");
    // Re-fetched dashboard A's data by id, not the latest.
    expect(mockedConversationService.getDashboardData).toHaveBeenCalledWith(
      "conversation_1",
      "project_1",
      "dash_A",
      { noCache: true },
    );
    // UI received the edited dashboard's data, not the polled latest.
    expect(onProcessedDataChange).toHaveBeenCalledWith(editedDashboardData);
    expect(useChatStore.getState().editChangeSummary).toEqual(editSummary);
    expect(useChatStore.getState().editProvenance).toEqual(editProvenance);
    expect(useChatStore.getState().analysisSteps).toEqual(analysisSteps);
    const completionMessages = useChatStore
      .getState()
      .messages.filter((message) => message.isEditCompletion);
    expect(completionMessages).toHaveLength(1);
    expect(completionMessages[0]).toEqual(
      expect.objectContaining({
        content: "Changed Revenue Trend to a bar chart.",
        editChangeSummary: editSummary,
        editProvenance,
      })
    );
    expect(completionMessages[0].dashboardCard).toBeUndefined();
  });

  it("re-engages the shimmer and refreshes the edited dashboard after an ask-first clarification", async () => {
    const onProcessedDataChange = vi.fn();
    const editedDashboardData = {
      dashboard: { title: "Dashboard A" },
      tables: [{ id: "table_1", title: "Top 10 Peak Days" }],
      charts: [],
      metrics: [],
    };
    const editSummary = {
      human_summary: "Updated Top 10 Peak Days using all project data.",
      filters_applied: ["All project data"],
    };
    const editProvenance = {
      python_code: ["top_days = df.sort_values('metric').tail(10)"],
      computed_values: { row_count: 10 },
    };
    const analysisSteps = [
      {
        index: 0,
        title: "Recompute top days",
        explanation: "Recomputed the top days used in the edited table.",
      },
    ];
    // An edit on dashboard A is paused on a clarification; pendingEdit persists it.
    useChatStore.setState({
      isDashboardOpen: true,
      selectedDashboardId: "dash_A",
      currentConversationId: "conversation_1",
      pendingEdit: { dashboardId: "dash_A", componentKeys: ["table_1", "component_1"] },
    });
    mockedProcessingService.pollProcessingStatus.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_1",
        dashboard_data: { dashboard: { title: "Dashboard B" }, charts: [], metrics: [] },
      },
    });
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [
          userNode("user_1", "turn this top 7 table into a top 10 table", []),
          assistantTextNode("assistant_1", "", [
            { type: "dashboard", data: { dashboard_id: "dash_B" } },
          ]),
        ],
        // Latest dashboard is B, but the edit must stay on / refresh A.
        dashboards: [
          { dashboard_id: "dash_A", title: "Dashboard A" },
          { dashboard_id: "dash_B", title: "Dashboard B" },
        ],
      },
    });
    mockedConversationService.getDashboardData.mockResolvedValue({
      dashboard_id: "dash_A",
      dashboard_data: editedDashboardData,
      change_summary: editSummary,
      computed_values: editProvenance,
      analysis_steps: analysisSteps,
    });

    const request: ClarificationRequest = {
      clarification_id: "clarify_data",
      reason_code: "missing_data_context",
      question: "Which data source?",
      options: [{ id: "use_all", label: "Use all project data", metadata: {} }],
    };
    const answers: ClarificationAnswer[] = [{ request, option: request.options[0] }];

    const run = useChatStore
      .getState()
      .submitClarificationResponse(answers, "project_1", onProcessedDataChange);

    // Shimmer re-engaged synchronously for the answer-run.
    expect([...useChatStore.getState().applyingComponentIds].sort()).toEqual([
      "component_1",
      "table_1",
    ]);

    await run;

    // Stayed on / refreshed the edited dashboard A by id (cache-busted), not latest B.
    expect(mockedConversationService.getDashboardData).toHaveBeenCalledWith(
      "conversation_1",
      "project_1",
      "dash_A",
      { noCache: true },
    );
    expect(useChatStore.getState().selectedDashboardId).toBe("dash_A");
    expect(onProcessedDataChange).toHaveBeenCalledWith(editedDashboardData);
    expect(useChatStore.getState().editChangeSummary).toEqual(editSummary);
    expect(useChatStore.getState().editProvenance).toEqual(editProvenance);
    expect(useChatStore.getState().analysisSteps).toEqual(analysisSteps);
    const completionMessages = useChatStore
      .getState()
      .messages.filter((message) => message.isEditCompletion);
    expect(completionMessages).toHaveLength(1);
    expect(completionMessages[0]).toEqual(
      expect.objectContaining({
        content: "Updated Top 10 Peak Days using all project data.",
        editChangeSummary: editSummary,
        editProvenance,
      })
    );
    expect(completionMessages[0].dashboardCard).toBeUndefined();
    // Edit context consumed and overlay cleared on completion.
    expect(useChatStore.getState().pendingEdit).toBeNull();
    expect(useChatStore.getState().applyingComponentIds.size).toBe(0);
  });
});
