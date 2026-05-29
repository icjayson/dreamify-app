import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLICIT_PROMPT_THEME_SOURCE } from "@/types/message";
import { createThemeSelection } from "@/constants/builtinTemplates";

vi.mock("@/services/processingService", () => ({
  processingService: {
    runProcessing: vi.fn(),
    pollProcessingStatus: vi.fn(),
  },
}));

vi.mock("@/services/conversationService", () => ({
  conversationService: {
    loadConversation: vi.fn(),
  },
}));

import { useChatStore } from "./useChatStore";
import { processingService } from "@/services/processingService";
import { conversationService } from "@/services/conversationService";

const mockedProcessingService = vi.mocked(processingService);
const mockedConversationService = vi.mocked(conversationService);

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
  });
}

describe("useChatStore theme intent", () => {
  beforeEach(() => {
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
    mockedProcessingService.pollProcessingStatus.mockResolvedValue({
      success: true,
      data: {
        success: true,
        status: "stopped",
        fileID: "",
        conversation_id: "conversation_1",
      },
    });
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: { nodes: [] },
    });
  });

  it("does not attach a restored dashboard theme to a plain text message", () => {
    const restoredTheme = createThemeSelection("crimson", "default");
    useChatStore.setState({
      selectedTheme: restoredTheme,
      selectedTemplate: restoredTheme,
      isThemePending: false,
      isTemplatePending: false,
    });

    useChatStore.getState().sendMessage("what is last week trend in web visitor");

    expect(useChatStore.getState().messages[0].template).toBeUndefined();
  });

  it("does not attach restored data context to a plain text optimistic message", async () => {
    useChatStore.setState({
      uploadedFiles: [{
        fileID: "ga4_restored",
        filename: "ga4.csv",
        size: 1024,
        ext: "csv",
        status: "processed",
        conversationId: "conversation_1",
        projectId: "project_1",
        sourceType: "GA4",
        propertyName: "Dreamify Web Tracking",
      }],
    });

    await useChatStore
      .getState()
      .processFileWithMessage("what is last week trend in DAU", undefined, "project_1");

    expect(useChatStore.getState().messages[0].attachment).toBeUndefined();
    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ asset_selection: "none" });
  });

  it("ignores stale accepted files from an existing conversation when building prompt metadata", async () => {
    useChatStore.setState({
      uploadedFiles: [{
        fileID: "ga4_historical",
        filename: "ga4.csv",
        size: 1024,
        ext: "csv",
        status: "accepted",
        conversationId: "conversation_1",
        projectId: "project_1",
        sourceType: "GA4",
      }],
    });

    await useChatStore
      .getState()
      .processFileWithMessage("what is last week trend in DAU", undefined, "project_1");

    expect(useChatStore.getState().messages[0].attachment).toBeUndefined();
    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[1]).toBeNull();
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ asset_selection: "none" });
  });

  it("attaches only an explicitly selected restored asset", async () => {
    useChatStore.setState({
      uploadedFiles: [{
        fileID: "ga4_asset",
        filename: "ga4.csv",
        size: 1024,
        ext: "csv",
        status: "processed",
        conversationId: "conversation_1",
        projectId: "project_1",
        sourceType: "GA4",
        propertyName: "Dreamify Web Tracking",
      }],
    });

    await useChatStore
      .getState()
      .processFileWithMessage("use GA4 for DAU trend", undefined, "project_1", ["ga4_asset"]);

    expect(useChatStore.getState().messages[0].attachment?.files?.map(file => file.id)).toEqual(["ga4_asset"]);
    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[4]).toEqual([{
      type: "asset",
      data: {
        asset_id: "ga4_asset",
        filename: "ga4.csv",
        kind: "csv",
        sourceType: "GA4",
        accountName: undefined,
        propertyName: "Dreamify Web Tracking",
        syncVersionName: undefined,
      },
    }]);
    expect(call[5]).toEqual({
      asset_selection: "explicit",
      selected_asset_ids: ["ga4_asset"],
    });
  });

  it("shows the selected clarification asset chip while the workflow is running", async () => {
    const request = {
      clarification_id: "clarify_1",
      reason_code: "missing_data_context",
      question: "Choose the data context",
      options: [],
    };
    const option = {
      id: "asset:ga4_asset",
      label: "GA4",
      metadata: {
        asset_ids: ["ga4_asset"],
        asset_selection: "explicit" as const,
        asset: {
          asset_id: "ga4_asset",
          filename: "google_analytics.csv",
          extension: "csv",
          asset_type: "integration_ga4",
          account_name: "GA4",
          property_name: "Dreamify Web Tracking",
        },
      },
    };

    await useChatStore
      .getState()
      .submitClarificationResponse([{ request, option }], "project_1");

    const userMessage = useChatStore.getState().messages.find(message => message.role === "user");
    expect(userMessage?.content).toBe("GA4");
    expect(userMessage?.attachment).toEqual({
      kind: "csv",
      name: "google_analytics.csv",
      sourceType: "integration_ga4",
      accountName: "GA4",
      propertyName: "Dreamify Web Tracking",
      syncVersionName: undefined,
      files: [{
        id: "ga4_asset",
        name: "google_analytics.csv",
        ext: "csv",
        sourceType: "integration_ga4",
        accountName: "GA4",
        propertyName: "Dreamify Web Tracking",
        syncVersionName: undefined,
      }],
    });
    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[4]).toEqual([
      expect.objectContaining({ type: "clarification_response" }),
      {
        type: "asset",
        data: expect.objectContaining({
          asset_id: "ga4_asset",
          filename: "google_analytics.csv",
          extension: "csv",
          sourceType: "integration_ga4",
          asset_type: "integration_ga4",
          accountName: "GA4",
          propertyName: "Dreamify Web Tracking",
        }),
      },
    ]);
    expect(call[5]).toEqual({
      asset_selection: "explicit",
      selected_asset_ids: ["ga4_asset"],
      clarification_id: "clarify_1",
      clarification_ids: ["clarify_1"],
    });
  });

  it("submits non-asset ask-first metadata without attaching data context", async () => {
    const request = {
      clarification_id: "clarify_output",
      reason_code: "output_mode",
      question: "What should I produce?",
      options: [],
    };
    const option = {
      id: "inline_visual",
      label: "Inline visual answer",
      metadata: {
        route_mode: "qa_visual",
      },
    };

    await useChatStore
      .getState()
      .submitClarificationResponse([{ request, option, freeText: "Keep it compact" }], "project_1");

    const userMessage = useChatStore.getState().messages.find(message => message.role === "user");
    expect(userMessage?.content).toBe("Inline visual answer\nKeep it compact");
    expect(userMessage?.attachment).toBeUndefined();
    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[4]).toEqual([
      {
        type: "clarification_response",
        data: {
          clarification_id: "clarify_output",
          selected_option_id: "inline_visual",
          selected_option_label: "Inline visual answer",
          free_text: "Keep it compact",
          metadata: {
            route_mode: "qa_visual",
          },
        },
      },
    ]);
    expect(call[5]).toEqual({
      asset_selection: "none",
      clarification_id: "clarify_output",
      clarification_ids: ["clarify_output"],
    });
  });

  it("does not send theme metadata when the theme is dashboard state only", async () => {
    const restoredTheme = createThemeSelection("crimson", "default");
    useChatStore.setState({
      selectedTheme: restoredTheme,
      selectedTemplate: restoredTheme,
      isThemePending: false,
      isTemplatePending: false,
    });

    await useChatStore
      .getState()
      .processFileWithMessage("what is last week trend in web visitor", undefined, "project_1");

    expect(mockedProcessingService.runProcessing).toHaveBeenCalledTimes(1);
    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[7]).toBeUndefined();
    expect(call[8]).toBeUndefined();
    expect(call[5]).toEqual({ asset_selection: "none" });
  });

  it("sends and consumes an explicitly pending prompt theme", async () => {
    const promptTheme = createThemeSelection("crimson", "saas_growth");
    useChatStore.setState({
      selectedTheme: promptTheme,
      selectedTemplate: promptTheme,
      isThemePending: true,
      isTemplatePending: true,
    });
    mockedProcessingService.pollProcessingStatus.mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_1",
      },
    });

    await useChatStore
      .getState()
      .processFileWithMessage("use crimson for the dashboard", undefined, "project_1");

    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[7]).toBe("crimson");
    expect(call[8]).toBe("saas_growth");
    expect(call[5]).toEqual({
      asset_selection: "none",
      theme_source: EXPLICIT_PROMPT_THEME_SOURCE,
    });
    expect(useChatStore.getState().isThemePending).toBe(false);
    expect(useChatStore.getState().isTemplatePending).toBe(false);
  });

  it("submits a batch of clarification answers in a single workflow run", async () => {
    const dataRequest = {
      clarification_id: "clarify_data",
      reason_code: "missing_data_context",
      question: "Choose the data context",
      options: [],
    };
    const dataOption = {
      id: "asset:ga4_asset",
      label: "GA4",
      metadata: {
        asset_ids: ["ga4_asset"],
        asset_selection: "explicit" as const,
        asset: {
          asset_id: "ga4_asset",
          filename: "google_analytics.csv",
          extension: "csv",
          asset_type: "integration_ga4",
          account_name: "GA4",
          property_name: "Dreamify Web Tracking",
        },
      },
    };
    const outputRequest = {
      clarification_id: "clarify_output",
      reason_code: "output_mode",
      question: "What should I produce?",
      options: [],
    };
    const outputOption = {
      id: "qa_visual",
      label: "Inline visual answer",
      metadata: { route_mode: "qa_visual" },
    };

    await useChatStore.getState().submitClarificationResponse(
      [
        { request: dataRequest, option: dataOption },
        { request: outputRequest, option: outputOption, freeText: "Keep it compact" },
      ],
      "project_1",
    );

    expect(mockedProcessingService.runProcessing).toHaveBeenCalledTimes(1);

    const userMessage = useChatStore.getState().messages.find(message => message.role === "user");
    expect(userMessage?.content).toBe("GA4\nInline visual answer\nKeep it compact");

    const call = mockedProcessingService.runProcessing.mock.calls[0];
    expect(call[4]).toEqual([
      expect.objectContaining({
        type: "clarification_response",
        data: expect.objectContaining({ clarification_id: "clarify_data" }),
      }),
      expect.objectContaining({
        type: "clarification_response",
        data: expect.objectContaining({
          clarification_id: "clarify_output",
          free_text: "Keep it compact",
        }),
      }),
      expect.objectContaining({
        type: "asset",
        data: expect.objectContaining({ asset_id: "ga4_asset" }),
      }),
    ]);
    expect(call[5]).toEqual({
      asset_selection: "explicit",
      selected_asset_ids: ["ga4_asset"],
      clarification_id: "clarify_data",
      clarification_ids: ["clarify_data", "clarify_output"],
    });
  });
});
