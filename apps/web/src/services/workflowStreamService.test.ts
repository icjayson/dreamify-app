import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThinkingEvent } from "@/types/message";

vi.mock("./api", () => ({
  api: {
    getBaseUrl: vi.fn(() => "https://api.test"),
    getAuthToken: vi.fn(),
  },
}));

vi.mock("./processingService", () => ({
  processingService: {
    pollProcessingStatus: vi.fn(),
  },
}));

import { api } from "./api";
import { processingService, type ProcessingResponse } from "./processingService";
import { streamWorkflow } from "./workflowStreamService";

const mockedApi = vi.mocked(api);
const mockedProcessingService = vi.mocked(processingService);

const terminalResult: ProcessingResponse = {
  success: true,
  data: {
    success: true,
    status: "completed",
    fileID: "asset_1",
    conversation_id: "conversation_1",
    dashboard_data: { dashboard: { title: "Updated" } },
  },
};

function sseFrame(event: string, data: unknown, id?: number): string {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

function responseFromChunks(chunks: string[], init: ResponseInit = {}): Response {
  return new Response(streamFromChunks(chunks), {
    status: 200,
    ...init,
  });
}

describe("streamWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getBaseUrl.mockReturnValue("https://api.test");
    mockedApi.getAuthToken.mockResolvedValue("token_123");
    mockedProcessingService.pollProcessingStatus.mockResolvedValue(terminalResult);
  });

  it("streams statuses and thinking events, then resolves terminal state through polling", async () => {
    const onConnected = vi.fn();
    const onStatusUpdate = vi.fn();
    const onThinkingEvents = vi.fn();
    const abortController = new AbortController();

    const eventTwo: ThinkingEvent = {
      id: "run_1:2",
      run_id: "run_1",
      sequence: 2,
      phase: "recomputing",
      status: "completed",
      title: "Recomputing values",
    };
    const eventOne: ThinkingEvent = {
      id: "run_1:1",
      run_id: "run_1",
      sequence: 1,
      phase: "analyzing",
      status: "completed",
      title: "Analyzing chart",
    };
    const analysisSteps = [
      {
        index: 0,
        title: "Recompute values",
        explanation: "Recomputed the values used in the updated chart.",
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue(
      responseFromChunks([
        sseFrame("status", {
          conversation_id: "conversation_1",
          node_id: "workflow",
          status: "running",
          metadata: { step: "analyzing" },
        }),
        sseFrame("event", eventTwo),
        "event: event\ndata: {not-json}\n\n",
        sseFrame("event", eventOne),
        sseFrame("status", {
          conversation_id: "conversation_1",
          node_id: "workflow",
          status: "completed",
          metadata: { step: "finish", response_type: "dashboard_config", analysis_steps: analysisSteps },
        }),
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project 1",
      assetId: "asset_1",
      abortSignal: abortController.signal,
      onConnected,
      onStatusUpdate,
      onThinkingEvents,
    });

    expect(result).toEqual({ connected: true, result: terminalResult });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/v1/conversation/conversation_1/stream?project_id=project+1",
      {
        headers: {
          Accept: "text/event-stream",
          Authorization: "Bearer token_123",
        },
        signal: abortController.signal,
      }
    );
    expect(onStatusUpdate).toHaveBeenCalledTimes(2);
    expect(onStatusUpdate.mock.calls[0][0].data.workflow_status.status).toBe(
      "running"
    );
    expect(onStatusUpdate.mock.calls[1][0].data.workflow_status.metadata.step).toBe(
      "finish"
    );
    expect(onStatusUpdate.mock.calls[1][0].data.workflow_status.metadata.analysis_steps).toEqual(
      analysisSteps
    );
    expect(onThinkingEvents).toHaveBeenLastCalledWith([eventOne, eventTwo]);
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledWith(
      "asset_1",
      "project 1",
      "conversation_1",
      undefined,
      1,
      0,
      abortController.signal
    );
  });

  it("falls back to status polling when the stream cannot be opened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const onFallbackToPolling = vi.fn();

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
      onFallbackToPolling,
      pollingMaxAttempts: 3,
      pollingIntervalMs: 0,
    });

    expect(result).toEqual({ connected: false, result: terminalResult });
    expect(onFallbackToPolling).toHaveBeenCalledOnce();
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledWith(
      "",
      "project_1",
      "conversation_1",
      undefined,
      3,
      0,
      expect.any(AbortSignal),
    );
  });

  it("authenticates the local deterministic SSE path with the demo identity", async () => {
    mockedApi.getAuthToken.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue(
      responseFromChunks([
        sseFrame("status", {
          conversation_id: "conversation_1",
          node_id: "workflow",
          status: "completed",
          metadata: { step: "finish" },
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/v1/conversation/conversation_1/stream?project_id=project_1",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Demo-User": "demo_user" }),
      }),
    );
  });

  it("falls back to polling on an initial network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
      pollingMaxAttempts: 2,
      pollingIntervalMs: 0,
    });

    expect(result).toEqual({ connected: false, result: terminalResult });
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledOnce();
  });

  it("falls back to polling when reconnects are exhausted before a terminal status", async () => {
    const onStatusUpdate = vi.fn();
    const onFallbackToPolling = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        responseFromChunks([
          sseFrame("status", {
            conversation_id: "conversation_1",
            node_id: "workflow",
            status: "running",
            metadata: { step: "recomputing" },
          }),
        ])
      )
    );

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
      onStatusUpdate,
      onFallbackToPolling,
      maxReconnectAttempts: 0,
      pollingMaxAttempts: 4,
      pollingIntervalMs: 0,
    });

    expect(result).toEqual({ connected: true, result: terminalResult });
    expect(onStatusUpdate).toHaveBeenCalledTimes(1);
    expect(onFallbackToPolling).toHaveBeenCalledOnce();
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledWith(
      "",
      "project_1",
      "conversation_1",
      onStatusUpdate,
      4,
      0,
      expect.any(AbortSignal),
    );
  });

  it("reconnects with a monotonic cursor and deduplicates replayed events", async () => {
    const onConnected = vi.fn();
    const onStatusUpdate = vi.fn();
    const onThinkingEvents = vi.fn();
    const eventOne: ThinkingEvent = {
      id: "event-1",
      run_id: "run-1",
      sequence: 1,
      phase: "analysis",
      status: "completed",
      title: "Profile data",
    };
    const replayedEventOne = { ...eventOne, id: "event-1-replayed" };
    const eventTwo: ThinkingEvent = {
      id: "event-2",
      run_id: "run-1",
      sequence: 2,
      phase: "final",
      status: "completed",
      title: "Build response",
    };
    const running = {
      conversation_id: "conversation_1",
      node_id: "workflow",
      status: "running",
      metadata: { step: "analysis" },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFromChunks([
        sseFrame("status", running),
        sseFrame("event", eventOne, 1),
        sseFrame("event", replayedEventOne, 1),
      ]))
      .mockResolvedValueOnce(responseFromChunks([
        sseFrame("status", running),
        sseFrame("event", replayedEventOne, 1),
        sseFrame("event", eventTwo, 2),
        sseFrame("status", {
          ...running,
          status: "completed",
          metadata: { step: "finish" },
        }),
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project 1",
      assetId: "asset_1",
      abortSignal: new AbortController().signal,
      onConnected,
      onStatusUpdate,
      onThinkingEvents,
      maxReconnectAttempts: 1,
      reconnectDelayMs: 0,
    });

    expect(result).toEqual({ connected: true, result: terminalResult });
    expect(onConnected).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://api.test/api/v1/conversation/conversation_1/stream?project_id=project+1&after=1",
      {
        headers: {
          Accept: "text/event-stream",
          Authorization: "Bearer token_123",
          "Last-Event-ID": "1",
        },
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(onStatusUpdate).toHaveBeenCalledTimes(2);
    expect(onThinkingEvents).toHaveBeenCalledTimes(2);
    expect(onThinkingEvents.mock.calls[0][0]).toEqual([eventOne]);
    expect(onThinkingEvents.mock.calls[1][0]).toEqual([eventOne, eventTwo]);
  });

  it("does not connect or poll after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: controller.signal,
    });

    expect(result).toEqual({ connected: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedProcessingService.pollProcessingStatus).not.toHaveBeenCalled();
  });

  it("treats clarification requests as terminal so ask-first flows hand off to polling", async () => {
    const clarificationResult: ProcessingResponse = {
      success: true,
      data: {
        success: true,
        status: "awaiting_user_input",
        fileID: "",
        conversation_id: "conversation_1",
        response_type: "clarification_request",
      },
    };
    mockedProcessingService.pollProcessingStatus.mockResolvedValueOnce(
      clarificationResult
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        responseFromChunks([
          sseFrame("status", {
            conversation_id: "conversation_1",
            node_id: "workflow",
            status: "awaiting_user_input",
            metadata: {
              step: "clarification",
              response_type: "clarification_request",
            },
          }),
        ])
      )
    );

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({ connected: true, result: clarificationResult });
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledWith(
      "",
      "project_1",
      "conversation_1",
      undefined,
      1,
      0,
      expect.any(AbortSignal)
    );
  });

  it("treats a cancelled run as terminal without opening a replacement stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      responseFromChunks([
        sseFrame("status", {
          conversation_id: "conversation_1",
          node_id: "workflow",
          status: "cancelled",
          metadata: { step: "cancelled" },
        }),
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({ connected: true, result: terminalResult });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockedProcessingService.pollProcessingStatus).toHaveBeenCalledOnce();
  });

  it("omits bearer authorization when no auth token is available", async () => {
    mockedApi.getAuthToken.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue(
      responseFromChunks([
        sseFrame("status", {
          conversation_id: "conversation_1",
          node_id: "workflow",
          status: "completed",
          metadata: { step: "finish" },
        }),
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
    });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers).toEqual({
      Accept: "text/event-stream",
      "X-Demo-User": "demo_user",
    });
  });
});
