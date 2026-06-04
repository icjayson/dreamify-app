import { api } from './api';
import { processingService, type ProcessingResponse } from './processingService';
import type { WorkflowStatusResponse } from './conversationService';
import type { ThinkingEvent } from '@/types/message';

/**
 * Live workflow progress via Server-Sent Events.
 *
 * The backend exposes `GET /api/v1/conversation/{conversationId}/stream?project_id=...`
 * returning `text/event-stream`. Frames look like `event: {type}\ndata: {json}\n\n`
 * where {type} is `status` or `event`:
 *   - `status` JSON matches the workflow-status polling response.
 *   - `event`  JSON matches the thinking-event polling response (a single ThinkingEvent).
 *
 * NATIVE EventSource cannot attach an Authorization header, so we use fetch +
 * ReadableStream and parse SSE frames by hand. The stream replays current state on
 * connect, live-tails, and closes on a terminal status. When the stream cannot connect
 * (network error, non-2xx, or no readable body), callers fall back to polling.
 */

const TERMINAL_STATUSES = new Set([
  'completed',
  'finished',
  'failed',
  'error',
  'stopped',
  'awaiting_user_input',
]);

interface ParsedFrame {
  event: string;
  data: string;
}

export interface StreamWorkflowOptions {
  conversationId: string;
  projectId: string;
  /** Asset id forwarded to the terminal ProcessingResponse (empty string for Q&A). */
  assetId?: string;
  /** Aborts the underlying fetch + reader on teardown. */
  abortSignal: AbortSignal;
  /** Mirrors pollProcessingStatus's onStatusUpdate so existing call sites are unchanged. */
  onStatusUpdate?: (status: ProcessingResponse) => void;
  /** Receives the full, merged thinking-event list as new `event` frames arrive. */
  onThinkingEvents?: (events: ThinkingEvent[]) => void;
  /** Fires once the SSE body is open, so callers can stand down redundant pollers. */
  onConnected?: () => void;
}

export interface StreamWorkflowResult {
  /** True once the SSE response was opened with a readable body. Drives poll fallback. */
  connected: boolean;
  /** Terminal ProcessingResponse, resolved the same way pollProcessingStatus does. */
  result?: ProcessingResponse;
}

/** Splits raw SSE text into complete frames, returning the unconsumed remainder. */
function extractFrames(buffer: string): { frames: ParsedFrame[]; rest: string } {
  const frames: ParsedFrame[] = [];
  let working = buffer;
  let boundary = working.indexOf('\n\n');
  while (boundary !== -1) {
    const block = working.slice(0, boundary);
    const parsed = parseFrameBlock(block);
    if (parsed) frames.push(parsed);
    working = working.slice(boundary + 2);
    boundary = working.indexOf('\n\n');
  }
  return { frames, rest: working };
}

/** Parses a single SSE block into {event, data}; ignores `:` keep-alive comments. */
function parseFrameBlock(block: string): ParsedFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/** Builds the ProcessingResponse the polling onStatusUpdate callbacks expect. */
function statusToProcessingResponse(
  status: WorkflowStatusResponse,
  conversationId: string,
): ProcessingResponse {
  return {
    success: true,
    data: {
      success: true,
      status: 'processing',
      fileID: '',
      conversation_id: conversationId,
      workflow_status: status,
    },
  };
}

/** Merges a single incoming thinking event into the accumulated list, keyed by id. */
function mergeThinkingEvent(existing: ThinkingEvent[], incoming: ThinkingEvent): ThinkingEvent[] {
  const index = existing.findIndex((event) => event.id === incoming.id);
  if (index === -1) {
    return [...existing, incoming].sort((a, b) => a.sequence - b.sequence);
  }
  const next = existing.slice();
  next[index] = incoming;
  return next;
}

export async function streamWorkflow(
  options: StreamWorkflowOptions,
): Promise<StreamWorkflowResult> {
  const { conversationId, projectId, abortSignal, onStatusUpdate, onThinkingEvents } = options;
  const assetId = options.assetId ?? '';
  const streamUrl =
    `${api.getBaseUrl()}/api/v1/conversation/${conversationId}/stream` +
    `?project_id=${encodeURIComponent(projectId)}`;

  let response: Response;
  try {
    const token = await api.getAuthToken();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    response = await fetch(streamUrl, { headers, signal: abortSignal });
  } catch (error) {
    // Network failure / aborted before connect — caller falls back to polling.
    if (abortSignal.aborted) return { connected: false };
    console.warn('Workflow stream failed to connect:', error);
    return { connected: false };
  }

  if (!response.ok || !response.body) {
    return { connected: false };
  }

  options.onConnected?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let thinkingEvents: ThinkingEvent[] = [];
  let terminalStatus: string | null = null;

  try {
    let streaming = true;
    while (streaming) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = extractFrames(buffer);
      buffer = rest;

      for (const frame of frames) {
        let payload: unknown;
        try {
          payload = JSON.parse(frame.data);
        } catch {
          continue; // Skip malformed data lines (keep-alives already filtered).
        }

        if (frame.event === 'status') {
          const status = payload as WorkflowStatusResponse;
          onStatusUpdate?.(statusToProcessingResponse(status, conversationId));
          if (status.status && TERMINAL_STATUSES.has(status.status)) {
            terminalStatus = status.status;
          }
        } else if (frame.event === 'event') {
          thinkingEvents = mergeThinkingEvent(thinkingEvents, payload as ThinkingEvent);
          onThinkingEvents?.(thinkingEvents);
        }
      }

      if (terminalStatus) streaming = false;
    }
  } catch (error) {
    if (!abortSignal.aborted) {
      console.warn('Workflow stream interrupted:', error);
    }
    // Connected then dropped: resolve terminal state below if we saw one,
    // otherwise let the caller decide (connected=true, no result → caller polls).
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* reader already closed */
    }
  }

  if (abortSignal.aborted) {
    return { connected: true };
  }

  if (terminalStatus) {
    // Resolve the terminal response (incl. dashboard fetch on dashboard completion)
    // through the existing polling logic, which observes the terminal state immediately.
    const result = await processingService.pollProcessingStatus(
      assetId,
      projectId,
      conversationId,
      undefined,
      1,
      0,
      abortSignal,
    );
    return { connected: true, result };
  }

  // Stream ended without a terminal status (e.g. mid-stream drop). Caller polls to finish.
  return { connected: true };
}
