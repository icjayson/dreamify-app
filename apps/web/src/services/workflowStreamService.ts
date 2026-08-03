import type { ThinkingEvent } from "@/types/message";

import { api } from "./api";
import { localDemoAuthHeaders } from "./authHeaders";
import type { WorkflowStatusResponse } from "./conversationService";
import { processingService, type ProcessingResponse } from "./processingService";

const TERMINAL_STATUSES = new Set([
  "completed",
  "finished",
  "failed",
  "error",
  "stopped",
  "cancelled",
  "awaiting_user_input",
]);
const DEFAULT_MAX_RECONNECTS = 80;
const DEFAULT_RECONNECT_DELAY_MS = 500;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 5_000;

interface ParsedFrame {
  event: string;
  data?: string;
  id?: string;
  retry?: number;
}

interface StreamAccumulator {
  cursor: number;
  lastStatusData: string | null;
  retryDelayMs: number;
  terminalStatus: string | null;
  thinkingEvents: ThinkingEvent[];
  seenEventIds: Set<string>;
  seenEventSequences: Set<string>;
}

export interface StreamWorkflowOptions {
  conversationId: string;
  projectId: string;
  assetId?: string;
  abortSignal: AbortSignal;
  onStatusUpdate?: (status: ProcessingResponse) => void;
  onThinkingEvents?: (events: ThinkingEvent[]) => void;
  onConnected?: () => void;
  /** Lets the caller resume its thinking-event poller while status polling runs. */
  onFallbackToPolling?: () => void;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  pollingMaxAttempts?: number;
  pollingIntervalMs?: number;
}

export interface StreamWorkflowResult {
  connected: boolean;
  result?: ProcessingResponse;
}

function extractFrames(buffer: string): { frames: ParsedFrame[]; rest: string } {
  const frames: ParsedFrame[] = [];
  let working = buffer;
  let boundary = /\r?\n\r?\n/.exec(working);
  while (boundary?.index !== undefined) {
    const block = working.slice(0, boundary.index);
    const parsed = parseFrameBlock(block);
    if (parsed) frames.push(parsed);
    working = working.slice(boundary.index + boundary[0].length);
    boundary = /\r?\n\r?\n/.exec(working);
  }
  return { frames, rest: working };
}

function parseFrameBlock(block: string): ParsedFrame | null {
  const frame: ParsedFrame = { event: "message" };
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") frame.event = value;
    if (field === "data") dataLines.push(value);
    if (field === "id" && !value.includes("\0")) frame.id = value;
    if (field === "retry" && /^\d+$/.test(value)) frame.retry = Number(value);
  }
  if (dataLines.length) frame.data = dataLines.join("\n");
  return frame.data !== undefined || frame.id !== undefined || frame.retry !== undefined
    ? frame
    : null;
}

function statusToProcessingResponse(
  status: WorkflowStatusResponse,
  conversationId: string,
): ProcessingResponse {
  return {
    success: true,
    data: {
      success: true,
      status: "processing",
      fileID: "",
      conversation_id: conversationId,
      workflow_status: status,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowStatus(value: unknown): value is WorkflowStatusResponse {
  return isRecord(value) && typeof value.status === "string";
}

function isThinkingEvent(value: unknown): value is ThinkingEvent {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.run_id === "string"
    && Number.isSafeInteger(value.sequence)
    && Number(value.sequence) >= 0
    && typeof value.phase === "string"
    && typeof value.status === "string"
    && typeof value.title === "string";
}

function cursorValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function mergeThinkingEvent(
  existing: ThinkingEvent[],
  incoming: ThinkingEvent,
): ThinkingEvent[] {
  return [...existing, incoming].sort((left, right) => left.sequence - right.sequence);
}

function acceptThinkingEvent(
  state: StreamAccumulator,
  event: ThinkingEvent,
): boolean {
  const sequenceKey = `${event.run_id}:${event.sequence}`;
  if (state.seenEventIds.has(event.id) || state.seenEventSequences.has(sequenceKey)) {
    return false;
  }
  state.seenEventIds.add(event.id);
  state.seenEventSequences.add(sequenceKey);
  state.thinkingEvents = mergeThinkingEvent(state.thinkingEvents, event);
  return true;
}

function processFrame(
  frame: ParsedFrame,
  state: StreamAccumulator,
  options: StreamWorkflowOptions,
): void {
  if (frame.retry !== undefined && Number.isSafeInteger(frame.retry)) {
    state.retryDelayMs = Math.min(frame.retry, options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS);
  }
  if (frame.data === undefined) return;
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return;
  }
  const frameCursor = cursorValue(frame.id);
  const payloadCursor = isRecord(payload) ? cursorValue(payload.sequence) : null;
  state.cursor = Math.max(state.cursor, frameCursor ?? 0, payloadCursor ?? 0);
  if (frame.event === "status") processStatus(payload, frame.data, state, options);
  if (frame.event === "event") processThinkingEvent(payload, state, options);
}

function processStatus(
  payload: unknown,
  serialized: string,
  state: StreamAccumulator,
  options: StreamWorkflowOptions,
): void {
  if (!isWorkflowStatus(payload)) return;
  if (serialized !== state.lastStatusData) {
    state.lastStatusData = serialized;
    options.onStatusUpdate?.(
      statusToProcessingResponse(payload, options.conversationId),
    );
  }
  if (TERMINAL_STATUSES.has(payload.status)) state.terminalStatus = payload.status;
}

function processThinkingEvent(
  payload: unknown,
  state: StreamAccumulator,
  options: StreamWorkflowOptions,
): void {
  if (!isThinkingEvent(payload) || !acceptThinkingEvent(state, payload)) return;
  options.onThinkingEvents?.(state.thinkingEvents);
}

function streamUrl(options: StreamWorkflowOptions, cursor: number): string {
  const params = new URLSearchParams({ project_id: options.projectId });
  if (cursor > 0) params.set("after", String(cursor));
  return `${api.getBaseUrl()}/api/v1/conversation/${encodeURIComponent(options.conversationId)}/stream?${params}`;
}

async function openStream(
  options: StreamWorkflowOptions,
  cursor: number,
): Promise<Response | null> {
  try {
    const token = await api.getAuthToken();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else Object.assign(headers, localDemoAuthHeaders());
    if (cursor > 0) headers["Last-Event-ID"] = String(cursor);
    const response = await fetch(streamUrl(options, cursor), {
      headers,
      signal: options.abortSignal,
    });
    return response.ok && response.body ? response : null;
  } catch (error) {
    if (!options.abortSignal.aborted) {
      console.warn("Workflow stream connection failed:", error);
    }
    return null;
  }
}

async function consumeStream(
  response: Response,
  state: StreamAccumulator,
  options: StreamWorkflowOptions,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!options.abortSignal.aborted && !state.terminalStatus) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const extracted = extractFrames(buffer);
      buffer = extracted.rest;
      for (const frame of extracted.frames) processFrame(frame, state, options);
    }
  } catch (error) {
    if (!options.abortSignal.aborted) {
      console.warn("Workflow stream interrupted; reconnecting:", error);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader already closed.
    }
  }
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = globalThis.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      globalThis.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function resolveTerminal(
  options: StreamWorkflowOptions,
  connected: boolean,
): Promise<StreamWorkflowResult> {
  const result = await processingService.pollProcessingStatus(
    options.assetId ?? "",
    options.projectId,
    options.conversationId,
    undefined,
    1,
    0,
    options.abortSignal,
  );
  return { connected, result };
}

async function fallbackToPolling(
  options: StreamWorkflowOptions,
  connected: boolean,
): Promise<StreamWorkflowResult> {
  if (options.abortSignal.aborted) return { connected };
  options.onFallbackToPolling?.();
  const result = await processingService.pollProcessingStatus(
    options.assetId ?? "",
    options.projectId,
    options.conversationId,
    options.onStatusUpdate,
    options.pollingMaxAttempts ?? 360,
    options.pollingIntervalMs ?? 5_000,
    options.abortSignal,
  );
  return { connected, result };
}

export async function streamWorkflow(
  options: StreamWorkflowOptions,
): Promise<StreamWorkflowResult> {
  if (options.abortSignal.aborted) return { connected: false };
  const maxReconnects = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECTS;
  const state: StreamAccumulator = {
    cursor: 0,
    lastStatusData: null,
    retryDelayMs: options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    terminalStatus: null,
    thinkingEvents: [],
    seenEventIds: new Set(),
    seenEventSequences: new Set(),
  };
  let connected = false;
  let reconnects = 0;

  while (!options.abortSignal.aborted) {
    const response = await openStream(options, state.cursor);
    if (!response) {
      if (!connected || reconnects >= maxReconnects) break;
    } else {
      if (!connected) {
        connected = true;
        options.onConnected?.();
      }
      await consumeStream(response, state, options);
      if (state.terminalStatus) return resolveTerminal(options, connected);
      if (reconnects >= maxReconnects) break;
    }
    reconnects += 1;
    await abortableDelay(state.retryDelayMs, options.abortSignal);
  }

  return fallbackToPolling(options, connected);
}
