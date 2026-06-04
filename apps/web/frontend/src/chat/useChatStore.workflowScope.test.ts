import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/types/message";
import type { ProcessingResponse } from "@/services/processingService";

vi.mock("@/services/processingService", () => ({
  processingService: {
    runProcessing: vi.fn(),
    pollProcessingStatus: vi.fn(),
    getWorkflowStatus: vi.fn(),
  },
}));

// Stream is unavailable in tests; force the polling fallback path so these
// scope assertions exercise pollProcessingStatus exactly as before.
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

const message = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
  timestamp: new Date("2026-05-22T00:00:00Z"),
});

function resetStore() {
  useChatStore.getState().resetChat();
  useChatStore.setState({
    inputValue: "",
    isTyping: false,
    messages: [],
    uploadedFiles: [],
    currentConversationId: null,
    currentProjectId: null,
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
  });
}

describe("useChatStore workflow scope", () => {
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
        conversation_id: "conversation_a",
      },
    });
  });

  it("does not replace project B messages when project A polling completes later", async () => {
    const polling = deferred<ProcessingResponse>();
    const projectBMessages = [message("b_1", "Project B stays visible")];
    mockedProcessingService.pollProcessingStatus.mockReturnValue(polling.promise);

    useChatStore.setState({
      currentProjectId: "project_a",
      currentConversationId: null,
      messages: [message("a_1", "Project A")],
    });

    const run = useChatStore
      .getState()
      .processFileWithMessage("build dashboard", undefined, "project_a");
    await flushPromises();
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledTimes(1);

    useChatStore.getState().resetChat();
    useChatStore.setState({
      currentProjectId: "project_b",
      currentConversationId: "conversation_b",
      messages: projectBMessages,
    });

    polling.resolve({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_a",
      },
    });
    await run;

    expect(useChatStore.getState().messages).toEqual(projectBMessages);
    expect(mockedConversationService.loadConversation).not.toHaveBeenCalled();
  });

  it("does not overwrite project B dashboard data when project A returns dashboard_data later", async () => {
    const polling = deferred<ProcessingResponse>();
    const onProcessedDataChange = vi.fn();
    const projectBFile = {
      fileID: "file_b",
      filename: "b.csv",
      size: 100,
      ext: "csv",
      status: "processed" as const,
      projectId: "project_b",
      conversationId: "conversation_b",
      processedData: { dashboard: { title: "Project B" } },
    };
    mockedProcessingService.pollProcessingStatus.mockReturnValue(polling.promise);

    useChatStore.setState({
      currentProjectId: "project_a",
      currentConversationId: "conversation_a",
      messages: [message("a_1", "Project A")],
    });

    const run = useChatStore
      .getState()
      .processFileWithMessage("update dashboard", onProcessedDataChange, "project_a");
    await flushPromises();

    useChatStore.getState().resetChat();
    useChatStore.setState({
      currentProjectId: "project_b",
      currentConversationId: "conversation_b",
      uploadedFiles: [projectBFile],
      messages: [message("b_1", "Project B")],
    });

    polling.resolve({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_a",
        dashboard_data: { dashboard: { title: "Project A" } },
      },
    });
    await run;

    expect(onProcessedDataChange).not.toHaveBeenCalled();
    expect(useChatStore.getState().uploadedFiles[0].processedData).toEqual({
      dashboard: { title: "Project B" },
    });
  });

  it("resetChat aborts frontend polling without stopping the backend workflow", () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    useChatStore.setState({
      abortController: controller,
      currentProjectId: "project_a",
      currentConversationId: "conversation_a",
      isProcessing: true,
      isTyping: true,
    });

    useChatStore.getState().resetChat();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(mockedConversationService.stopWorkflow).not.toHaveBeenCalled();
    expect(useChatStore.getState().abortController).toBeNull();
    expect(useChatStore.getState().isProcessing).toBe(false);
  });

  it("ignores a resumed workflow when its project changes before status check returns", async () => {
    const statusCheck = deferred<ProcessingResponse>();
    const projectBMessages = [message("b_1", "Project B")];
    mockedProcessingService.getWorkflowStatus.mockReturnValue(statusCheck.promise);

    useChatStore.setState({
      currentProjectId: "project_a",
      currentConversationId: "conversation_a",
      messages: [message("a_1", "Project A")],
    });

    const run = useChatStore
      .getState()
      .resumeWorkflowPolling("project_a", "conversation_a", vi.fn());
    await flushPromises();

    useChatStore.getState().resetChat();
    useChatStore.setState({
      currentProjectId: "project_b",
      currentConversationId: "conversation_b",
      messages: projectBMessages,
    });

    statusCheck.resolve({
      success: true,
      data: {
        success: true,
        status: "processing",
        fileID: "",
        conversation_id: "conversation_a",
        workflow_status: {
          status: "processing",
          metadata: { step: "execution" },
        },
      },
    });
    await run;

    expect(mockedProcessingService.pollProcessingStatus).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual(projectBMessages);
  });

  it("applies a resumed workflow when project and conversation still match", async () => {
    const statusCheck = deferred<ProcessingResponse>();
    const polling = deferred<ProcessingResponse>();
    const dashboardData = { dashboard: { title: "Project A" } };
    const onProcessedDataChange = vi.fn();
    mockedProcessingService.getWorkflowStatus.mockReturnValue(statusCheck.promise);
    mockedProcessingService.pollProcessingStatus.mockReturnValue(polling.promise);
    mockedConversationService.loadConversation.mockResolvedValue({
      conversation: {
        nodes: [],
        dashboards: [],
      },
    });

    useChatStore.setState({
      currentProjectId: "project_a",
      currentConversationId: "conversation_a",
      messages: [],
    });

    const run = useChatStore
      .getState()
      .resumeWorkflowPolling("project_a", "conversation_a", onProcessedDataChange);
    await flushPromises();

    statusCheck.resolve({
      success: true,
      data: {
        success: true,
        status: "processing",
        fileID: "",
        conversation_id: "conversation_a",
        workflow_status: {
          status: "processing",
          metadata: { step: "execution" },
        },
      },
    });
    await flushPromises();

    polling.resolve({
      success: true,
      data: {
        success: true,
        status: "completed",
        fileID: "",
        conversation_id: "conversation_a",
        dashboard_data: dashboardData,
      },
    });
    await run;

    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledWith(
      "",
      "project_a",
      "conversation_a",
      expect.any(Function),
      360,
      5000,
      expect.any(AbortSignal)
    );
    expect(mockedConversationService.loadConversation).toHaveBeenCalledWith("conversation_a", "project_a");
    expect(onProcessedDataChange).toHaveBeenCalledWith(dashboardData);
  });
});
