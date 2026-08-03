import {
  RunRecordSchema,
  WorkflowResponseSchema,
  type NewThinkingEvent,
  type RunRecord,
  type WorkflowResponse,
} from "@dreamify/contracts";
import { z } from "zod";

import { WorkflowFault } from "../errors.js";
import type {
  ArtifactStore,
  ClaimOutcome,
  RunTransition,
  SandboxCapacity,
  StepResult,
  WorkflowClock,
  WorkflowStore,
} from "../ports.js";
import {
  RunContextSchema,
  type ArtifactReference,
  type ResolvedProviderCredential,
  type RunContext,
  type SandboxLease,
} from "../types.js";

type FetchImplementation = typeof globalThis.fetch;
const INTERNAL_API_TIMEOUT_MS = 30_000;
const TERMINAL_WRITE_TIMEOUT_MS = 10_000;

const ArtifactReferenceSchema = z
  .object({
    object_id: z.string().min(1).max(128),
    kind: z.enum(["profile", "analysis", "response"]),
    size_bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const SandboxLeaseSchema = z
  .object({
    lease_id: z.string().min(1).max(128),
    run_id: z.string().min(1).max(128),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();

const ProviderCredentialSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("demo"),
      provider: z.literal("demo"),
      model: z.literal("deterministic-v1"),
      api_key: z.null(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("byok"),
      provider: z.enum(["openai", "gemini"]),
      model: z.string().min(1).max(128),
      api_key: z.string().min(8).max(512),
    })
    .strict(),
]);

function internalPath(baseUrl: string, suffix: string): string {
  const prefix = baseUrl.endsWith("/api/v1") ? baseUrl : `${baseUrl}/api/v1`;
  return `${prefix}/internal/workflow${suffix}`;
}

function responseError(body: unknown): { code: string; message: string } {
  if (!body || typeof body !== "object") {
    return { code: "INTERNAL_API_ERROR", message: "Internal API request failed" };
  }
  const value = body as Record<string, unknown>;
  const nested = value.error && typeof value.error === "object"
    ? (value.error as Record<string, unknown>)
    : value;
  return {
    code: typeof nested.code === "string" ? nested.code : "INTERNAL_API_ERROR",
    message:
      typeof nested.message === "string" ? nested.message.slice(0, 1_000) : "Internal API request failed",
  };
}

export interface InternalApiClientOptions {
  baseUrl: string;
  sharedSecret: string;
  fetch?: FetchImplementation;
  signal?: AbortSignal;
  requestId?: string;
}

const DispatchStateSchema = z
  .object({
    outcome: z.enum(["authorized", "in_progress", "recorded", "conflict", "invalid"]),
    dispatch_lease_id: z.string().nullable().optional(),
    workflow_execution_id: z.string().nullable().optional(),
  })
  .strict();

export type DispatchState = z.infer<typeof DispatchStateSchema>;

/** Server-only client. Never include this instance in Workflow arguments/results. */
export class InternalApiClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly requestId: string;

  constructor(private readonly options: InternalApiClientOptions) {
    const parsed = new URL(options.baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("DREAMIFY_API_URL must use http or https");
    }
    if (parsed.username || parsed.password) {
      throw new Error("DREAMIFY_API_URL must not contain credentials");
    }
    if (!options.sharedSecret) throw new Error("INTERNAL_SERVICE_SHARED_SECRET is not configured");
    if (options.requestId && !/^[A-Za-z0-9._:-]{1,128}$/.test(options.requestId)) {
      throw new Error("requestId contains unsupported characters");
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.requestId = options.requestId ?? globalThis.crypto.randomUUID();
  }

  static fromEnvironment(
    fetchImplementation?: FetchImplementation,
    signal?: AbortSignal,
    requestId?: string,
  ): InternalApiClient {
    const baseUrl = process.env.DREAMIFY_API_URL;
    const sharedSecret = process.env.INTERNAL_SERVICE_SHARED_SECRET;
    if (!baseUrl) throw new Error("DREAMIFY_API_URL is not configured");
    if (!sharedSecret) throw new Error("INTERNAL_SERVICE_SHARED_SECRET is not configured");
    return new InternalApiClient({
      baseUrl,
      sharedSecret,
      ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      ...(signal ? { signal } : {}),
      ...(requestId ? { requestId } : {}),
    });
  }

  async workflow<T>(
    suffix: string,
    init: RequestInit = {},
    bypassSliceSignal = false,
  ): Promise<T> {
    return this.request<T>(internalPath(this.baseUrl, suffix), init, bypassSliceSignal);
  }

  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const prefix = this.baseUrl.endsWith("/api/v1") ? this.baseUrl : `${this.baseUrl}/api/v1`;
    return this.request<T>(`${prefix}${path}`, init);
  }

  async resolveProvider(runId: string): Promise<ResolvedProviderCredential> {
    const body = await this.workflow<unknown>(
      `/runs/${encodeURIComponent(runId)}/provider/resolve`,
      { method: "POST", body: "{}" },
    );
    return ProviderCredentialSchema.parse(body);
  }

  async authorizeDispatch(runId: string, dispatchLeaseId: string): Promise<DispatchState> {
    const body = await this.workflow<unknown>(
      `/runs/${encodeURIComponent(runId)}/dispatch/authorize`,
      {
        method: "POST",
        body: JSON.stringify({ dispatch_lease_id: dispatchLeaseId }),
      },
    );
    return DispatchStateSchema.parse(body);
  }

  async recordDispatchReceipt(
    runId: string,
    dispatchLeaseId: string,
    workflowExecutionId: string,
  ): Promise<DispatchState> {
    const body = await this.workflow<unknown>(
      `/runs/${encodeURIComponent(runId)}/dispatch/receipt`,
      {
        method: "POST",
        body: JSON.stringify({
          dispatch_lease_id: dispatchLeaseId,
          workflow_execution_id: workflowExecutionId,
        }),
      },
    );
    return DispatchStateSchema.parse(body);
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    bypassSliceSignal = false,
  ): Promise<T> {
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(),
      bypassSliceSignal ? TERMINAL_WRITE_TIMEOUT_MS : INTERNAL_API_TIMEOUT_MS,
    );
    const signals = [
      init.signal ?? undefined,
      bypassSliceSignal ? undefined : this.options.signal,
      timeoutController.signal,
    ].filter((signal): signal is AbortSignal => Boolean(signal));
    const signal: AbortSignal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("x-internal-service-secret", this.options.sharedSecret);
    headers.set("x-request-id", this.requestId);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        ...init,
        cache: "no-store",
        headers,
        signal,
      });
    } catch (error) {
      const sliceReason = !bypassSliceSignal && this.options.signal?.aborted
        ? this.options.signal.reason
        : undefined;
      if (sliceReason instanceof WorkflowFault) throw sliceReason;
      throw new WorkflowFault({
        code: timeoutController.signal.aborted ? "INTERNAL_API_TIMEOUT" : "INTERNAL_API_UNAVAILABLE",
        message: timeoutController.signal.aborted
          ? "Internal API request timed out"
          : error instanceof Error
            ? error.message.slice(0, 1_000)
            : "Internal API unavailable",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new WorkflowFault({
          code: "INTERNAL_API_INVALID_RESPONSE",
          message: "Internal API returned invalid JSON",
          retryable: response.status >= 500,
        });
      }
    }
    if (!response.ok) {
      const failure = responseError(body);
      throw new WorkflowFault({
        code: failure.code,
        message: failure.message,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        ...(response.status === 429 ? { retryAfterMs: 15_000 } : {}),
      });
    }
    return body as T;
  }
}

const runEnvelope = z.object({ run: RunRecordSchema }).strict();

export class ApiWorkflowStore implements WorkflowStore {
  constructor(private readonly client: InternalApiClient) {}

  async getContext(runId: string): Promise<RunContext> {
    const body = await this.client.workflow<unknown>(`/runs/${encodeURIComponent(runId)}/context`);
    return z.object({ context: RunContextSchema }).strict().parse(body).context;
  }

  async getRun(runId: string): Promise<RunRecord> {
    const body = await this.client.workflow<unknown>(`/runs/${encodeURIComponent(runId)}`);
    return runEnvelope.parse(body).run;
  }

  async claimRun(
    runId: string,
    workflowExecutionId: string,
    event: NewThinkingEvent,
  ): Promise<ClaimOutcome> {
    const body = await this.client.workflow<unknown>(`/runs/${encodeURIComponent(runId)}/claim`, {
      method: "POST",
      body: JSON.stringify({ workflow_execution_id: workflowExecutionId, event }),
    });
    return z
      .object({
        outcome: z.enum(["claimed", "resume", "busy", "terminal"]),
        run: RunRecordSchema,
      })
      .strict()
      .parse(body).outcome;
  }

  async reserveProviderCall(
    runId: string,
    callKey: string,
  ): Promise<{ ordinal: number; created: boolean }> {
    const body = await this.client.workflow<unknown>(
      `/runs/${encodeURIComponent(runId)}/provider-calls/reserve`,
      {
        method: "POST",
        body: JSON.stringify({ call_key: callKey }),
      },
    );
    const reservation = z
      .object({
        call_key: z.string(),
        ordinal: z.number().int().min(1).max(5),
        remaining: z.number().int().min(0).max(5),
        created: z.boolean(),
      })
      .strict()
      .parse(body);
    return { ordinal: reservation.ordinal, created: reservation.created };
  }

  async beginStep(
    runId: string,
    stepKey: string,
    step: RunRecord["current_step"],
    event: NewThinkingEvent,
  ): Promise<void> {
    await this.client.workflow(`/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepKey)}/begin`, {
      method: "POST",
      body: JSON.stringify({ step, event }),
    });
  }

  async getStepResult<T>(runId: string, stepKey: string): Promise<StepResult<T>> {
    const body = await this.client.workflow<unknown>(
      `/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepKey)}`,
    );
    const parsed = z.object({ found: z.boolean(), value: z.unknown().nullable() }).strict().parse(body);
    return { found: parsed.found, value: parsed.value as T | null };
  }

  async completeStep<T>(
    runId: string,
    stepKey: string,
    result: T,
    event: NewThinkingEvent,
  ): Promise<void> {
    await this.client.workflow(`/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepKey)}`, {
      method: "PUT",
      body: JSON.stringify({ result, event }),
    });
  }

  async transition(runId: string, transition: RunTransition): Promise<RunRecord> {
    const body = await this.client.workflow<unknown>(
      `/runs/${encodeURIComponent(runId)}/transition`,
      {
        method: "POST",
        body: JSON.stringify(transition),
      },
      true,
    );
    return runEnvelope.parse(body).run;
  }

  async commitResponse(
    runId: string,
    terminalStatus: "completed" | "awaiting_user_input",
    response: WorkflowResponse,
    responseArtifact: ArtifactReference,
    resultReference: NonNullable<RunRecord["result"]>,
    event: NewThinkingEvent,
  ): Promise<RunRecord> {
    const body = await this.client.workflow<unknown>(`/runs/${encodeURIComponent(runId)}/response`, {
      method: "POST",
      body: JSON.stringify({
        terminal_status: terminalStatus,
        response,
        response_artifact: responseArtifact,
        result_reference: resultReference,
        event,
      }),
    });
    return runEnvelope.parse(body).run;
  }

  async getResponse(runId: string): Promise<WorkflowResponse | null> {
    const body = await this.client.workflow<unknown>(`/runs/${encodeURIComponent(runId)}/response`);
    const response = z.object({ response: z.unknown().nullable() }).strict().parse(body).response;
    return response === null ? null : WorkflowResponseSchema.parse(response);
  }

  async requestCancellation(runId: string, reason: "user" | "superseded"): Promise<RunRecord> {
    const body = await this.client.workflow<unknown>(`/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return runEnvelope.parse(body).run;
  }
}

export class ApiArtifactStore implements ArtifactStore {
  constructor(private readonly client: InternalApiClient) {}

  async putJson(
    runId: string,
    kind: ArtifactReference["kind"],
    value: unknown,
    idempotencyKey: string,
    maxBytes: number,
  ): Promise<ArtifactReference> {
    const body = await this.client.workflow<unknown>(`/runs/${encodeURIComponent(runId)}/artifacts`, {
      method: "POST",
      body: JSON.stringify({ kind, value, idempotency_key: idempotencyKey, max_bytes: maxBytes }),
    });
    return z.object({ artifact: ArtifactReferenceSchema }).strict().parse(body).artifact;
  }

  async getJson<T>(runId: string, reference: ArtifactReference): Promise<T> {
    const objectId = encodeURIComponent(reference.object_id);
    const body = await this.client.workflow<unknown>(
      `/runs/${encodeURIComponent(runId)}/artifacts/${objectId}`,
    );
    return z.object({ value: z.unknown() }).strict().parse(body).value as T;
  }
}

export class ApiSandboxCapacity implements SandboxCapacity {
  constructor(private readonly client: InternalApiClient) {}

  async acquire(runId: string, idempotencyKey: string): Promise<SandboxLease> {
    try {
      const body = await this.client.workflow<unknown>("/capacity/acquire", {
        method: "POST",
        body: JSON.stringify({ run_id: runId, idempotency_key: idempotencyKey }),
      });
      return z.object({ lease: SandboxLeaseSchema }).strict().parse(body).lease;
    } catch (error) {
      if (error instanceof WorkflowFault && error.code === "CAPACITY_UNAVAILABLE") {
        throw new WorkflowFault({
          code: "CAPACITY_BUSY",
          message: "All isolated analysis slots are currently leased",
          retryable: true,
          failedStep: "capacity",
          retryAfterMs: 15_000,
        });
      }
      throw error;
    }
  }

  async release(lease: SandboxLease, idempotencyKey: string): Promise<void> {
    await this.client.workflow(
      "/capacity/release",
      {
        method: "POST",
        body: JSON.stringify({ lease, idempotency_key: idempotencyKey }),
      },
      true,
    );
  }
}

export class SystemWorkflowClock implements WorkflowClock {
  now(): Date {
    return new Date();
  }

  async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
