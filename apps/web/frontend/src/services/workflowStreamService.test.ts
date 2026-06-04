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

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
      "https://api.test/api/v1/conversation/conversation_1/stream?project_id=project%201",
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

  it("returns disconnected when the stream cannot be opened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({ connected: false });
    expect(mockedProcessingService.pollProcessingStatus).not.toHaveBeenCalled();
  });

  it("returns disconnected on network failure so callers can poll", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await streamWorkflow({
      conversationId: "conversation_1",
      projectId: "project_1",
      abortSignal: new AbortController().signal,
    });

    expect(result).toEqual({ connected: false });
    expect(mockedProcessingService.pollProcessingStatus).not.toHaveBeenCalled();
  });

  it("keeps connected=true without a result when the stream ends before a terminal status", async () => {
    const onStatusUpdate = vi.fn();
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
    });

    expect(result).toEqual({ connected: true });
    expect(onStatusUpdate).toHaveBeenCalledTimes(1);
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

  it("omits authorization when no auth token is available", async () => {
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

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Accept: "text/event-stream",
    });
  });
});
