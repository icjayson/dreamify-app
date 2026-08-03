import { createHash } from "node:crypto";

import {
  RESOURCE_LIMITS,
  RunRecordSchema,
  SandboxAnalysisResultSchema,
  SandboxProfileResultSchema,
  ThinkingEventSchema,
  isTerminalRunStatus,
  type NewThinkingEvent,
  type RunRecord,
  type SandboxAnalysisResult,
  type SandboxProfileResult,
  type ThinkingEvent,
  type WorkflowResponse,
} from "@dreamify/contracts";

import { SupersededFault, WorkflowFault } from "../errors.js";
import type {
  ArtifactStore,
  ClaimOutcome,
  SandboxAdapter,
  SandboxCapacity,
  StepResult,
  WorkflowClock,
  WorkflowStore,
} from "../ports.js";
import { assertRunTransition } from "../state-machine.js";
import type {
  ArtifactReference,
  ProviderCallContext,
  RunContext,
  SandboxLease,
} from "../types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryClock implements WorkflowClock {
  readonly sleeps: number[] = [];

  constructor(private currentMilliseconds = Date.parse("2026-08-03T08:00:00.000Z")) {}

  now(): Date {
    return new Date(this.currentMilliseconds);
  }

  async sleep(milliseconds: number): Promise<void> {
    this.sleeps.push(milliseconds);
    this.currentMilliseconds += milliseconds;
  }

  advance(milliseconds: number): void {
    this.currentMilliseconds += milliseconds;
  }
}

export class MemoryWorkflowStore implements WorkflowStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly contexts = new Map<string, RunContext>();
  private readonly steps = new Map<string, unknown>();
  private readonly events = new Map<string, ThinkingEvent[]>();
  private readonly eventKeys = new Set<string>();
  private readonly responses = new Map<string, WorkflowResponse>();
  private readonly activeRuns = new Map<string, string>();
  private readonly providerCalls = new Map<string, number>();

  constructor(context: RunContext, private readonly clock: WorkflowClock = new MemoryClock()) {
    this.seedRun(context);
  }

  seedRun(context: RunContext, parentRunId: string | null = null): RunRecord {
    const timestamp = this.clock.now().toISOString();
    const run = RunRecordSchema.parse({
      run_id: context.run_id,
      conversation_id: context.conversation_id,
      project_id: context.project_id,
      owner_id: context.owner_id,
      parent_run_id: parentRunId,
      workflow_run_id: null,
      status: "queued",
      current_step: "accepted",
      response_type: null,
      cancel_requested: false,
      cancel_reason: null,
      version: 0,
      result: null,
      error: null,
      created_at: timestamp,
      updated_at: timestamp,
      started_at: null,
      completed_at: null,
    });
    this.runs.set(context.run_id, run);
    this.contexts.set(context.run_id, clone(context));
    this.events.set(context.run_id, []);
    this.activeRuns.set(context.conversation_id, context.run_id);
    return clone(run);
  }

  async getContext(runId: string): Promise<RunContext> {
    const context = this.contexts.get(runId);
    if (!context) throw new Error(`unknown run context: ${runId}`);
    return clone(context);
  }

  async getRun(runId: string): Promise<RunRecord> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run: ${runId}`);
    return clone(run);
  }

  async claimRun(runId: string, workflowExecutionId: string, event: NewThinkingEvent): Promise<ClaimOutcome> {
    const run = await this.getRun(runId);
    if (isTerminalRunStatus(run.status)) return "terminal";
    if (run.status === "running" || run.status === "cancelling") {
      return run.workflow_run_id === workflowExecutionId ? "resume" : "busy";
    }
    if (run.status !== "queued") return "busy";
    assertRunTransition(run.status, "running");
    const timestamp = this.clock.now().toISOString();
    this.runs.set(runId, {
      ...run,
      workflow_run_id: workflowExecutionId,
      status: "running",
      started_at: timestamp,
      updated_at: timestamp,
      version: run.version + 1,
    });
    this.appendEvent(runId, event);
    return "claimed";
  }

  async reserveProviderCall(
    runId: string,
    callKey: string,
  ): Promise<{ ordinal: number; created: boolean }> {
    const key = `${runId}:${callKey}`;
    const existing = this.providerCalls.get(key);
    if (existing !== undefined) return { ordinal: existing, created: false };
    const count = [...this.providerCalls.keys()].filter((value) =>
      value.startsWith(`${runId}:`),
    ).length;
    if (count >= RESOURCE_LIMITS.maxProviderCalls) {
      throw new WorkflowFault({
        code: "PROVIDER_CALL_BUDGET_EXCEEDED",
        message: "Provider call budget exceeded",
        retryable: false,
      });
    }
    const ordinal = count + 1;
    this.providerCalls.set(key, ordinal);
    return { ordinal, created: true };
  }

  async beginStep(runId: string, stepKey: string, step: RunRecord["current_step"], event: NewThinkingEvent): Promise<void> {
    const run = await this.getRun(runId);
    if (run.status !== "running") throw new Error(`cannot begin ${stepKey} from ${run.status}`);
    this.runs.set(runId, {
      ...run,
      current_step: step,
      updated_at: this.clock.now().toISOString(),
      version: run.version + 1,
    });
    this.appendEvent(runId, event);
  }

  async getStepResult<T>(runId: string, stepKey: string): Promise<StepResult<T>> {
    const key = `${runId}:${stepKey}`;
    if (!this.steps.has(key)) return { found: false, value: null };
    return { found: true, value: clone(this.steps.get(key) as T) };
  }

  async completeStep<T>(runId: string, stepKey: string, result: T, event: NewThinkingEvent): Promise<void> {
    const key = `${runId}:${stepKey}`;
    if (!this.steps.has(key)) {
      this.steps.set(key, clone(result));
    }
    this.appendEvent(runId, event);
  }

  async transition(runId: string, transition: Parameters<WorkflowStore["transition"]>[1]): Promise<RunRecord> {
    const run = await this.getRun(runId);
    if (run.status === transition.status && isTerminalRunStatus(run.status)) {
      return run;
    }
    if (!transition.allowed_from.includes(run.status)) {
      throw new Error(`transition expected ${transition.allowed_from.join("|")}, got ${run.status}`);
    }
    assertRunTransition(run.status, transition.status);
    const terminal = isTerminalRunStatus(transition.status);
    const next: RunRecord = {
      ...run,
      status: transition.status,
      current_step: transition.current_step,
      response_type: transition.response_type === undefined ? run.response_type : transition.response_type,
      error: transition.error === undefined ? run.error : transition.error,
      updated_at: this.clock.now().toISOString(),
      completed_at: terminal ? this.clock.now().toISOString() : run.completed_at,
      version: run.version + 1,
    };
    this.runs.set(runId, next);
    this.appendEvent(runId, transition.event);
    return clone(next);
  }

  async commitResponse(
    runId: string,
    terminalStatus: "completed" | "awaiting_user_input",
    response: WorkflowResponse,
    _responseArtifact: ArtifactReference,
    resultReference: NonNullable<RunRecord["result"]>,
    event: NewThinkingEvent,
  ): Promise<RunRecord> {
    const run = await this.getRun(runId);
    if (isTerminalRunStatus(run.status)) {
      return run;
    }
    if (this.activeRuns.get(run.conversation_id) !== runId) {
      throw new SupersededFault();
    }
    if (run.cancel_requested || run.status !== "running") {
      throw new WorkflowFault({ code: "CANCELLED", message: "Run cannot persist", retryable: false });
    }
    assertRunTransition(run.status, terminalStatus);
    const timestamp = this.clock.now().toISOString();
    const next: RunRecord = {
      ...run,
      status: terminalStatus,
      current_step: terminalStatus === "completed" ? "done" : "clarification",
      response_type: response.type,
      result: resultReference,
      error: null,
      updated_at: timestamp,
      completed_at: timestamp,
      version: run.version + 1,
    };
    this.runs.set(runId, next);
    this.responses.set(runId, clone(response));
    if (this.activeRuns.get(run.conversation_id) === runId) {
      this.activeRuns.delete(run.conversation_id);
    }
    this.appendEvent(runId, event);
    return clone(next);
  }

  async getResponse(runId: string): Promise<WorkflowResponse | null> {
    const response = this.responses.get(runId);
    return response ? clone(response) : null;
  }

  async requestCancellation(runId: string, reason: "user" | "superseded"): Promise<RunRecord> {
    const run = await this.getRun(runId);
    if (isTerminalRunStatus(run.status)) return run;
    if (run.status !== "queued" && run.status !== "running" && run.status !== "cancelling") {
      throw new Error(`cannot cancel ${run.status}`);
    }
    if (run.status !== "cancelling") {
      assertRunTransition(run.status, "cancelling");
    }
    const next: RunRecord = {
      ...run,
      status: "cancelling",
      cancel_requested: true,
      cancel_reason: reason,
      updated_at: this.clock.now().toISOString(),
      version: run.version + 1,
    };
    this.runs.set(runId, next);
    if (this.activeRuns.get(run.conversation_id) === runId) {
      this.activeRuns.delete(run.conversation_id);
    }
    return clone(next);
  }

  setActiveRun(conversationId: string, runId: string): void {
    this.activeRuns.set(conversationId, runId);
  }

  getEvents(runId: string): ThinkingEvent[] {
    return clone(this.events.get(runId) ?? []);
  }

  private appendEvent(runId: string, draft: NewThinkingEvent): void {
    const uniqueKey = `${runId}:${draft.event_key}`;
    if (this.eventKeys.has(uniqueKey)) return;
    const events = this.events.get(runId) ?? [];
    if (events.length >= RESOURCE_LIMITS.maxEventsPerRun) {
      throw new Error("event limit exceeded");
    }
    const sequence = events.length + 1;
    const event = ThinkingEventSchema.parse({
      ...draft,
      id: `${runId}:${sequence}`,
      sequence,
    });
    events.push(event);
    this.events.set(runId, events);
    this.eventKeys.add(uniqueKey);
  }
}

export class MemoryArtifactStore implements ArtifactStore {
  private readonly values = new Map<string, unknown>();
  private readonly idempotency = new Map<string, ArtifactReference>();

  async putJson(
    runId: string,
    kind: ArtifactReference["kind"],
    value: unknown,
    idempotencyKey: string,
    maxBytes: number,
  ): Promise<ArtifactReference> {
    const serialized = JSON.stringify(value);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");
    if (sizeBytes > maxBytes) {
      throw new WorkflowFault({
        code: "ARTIFACT_TOO_LARGE",
        message: `${kind} artifact exceeded ${maxBytes} bytes`,
        retryable: false,
      });
    }
    const sha256 = createHash("sha256").update(serialized).digest("hex");
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.sha256 !== sha256) {
        throw new Error(`idempotency conflict for ${idempotencyKey}`);
      }
      return clone(existing);
    }
    const reference: ArtifactReference = {
      object_id: `${runId}/${kind}/${sha256.slice(0, 16)}`,
      kind,
      size_bytes: sizeBytes,
      sha256,
    };
    this.values.set(reference.object_id, clone(value));
    this.idempotency.set(idempotencyKey, reference);
    return clone(reference);
  }

  async getJson<T>(_runId: string, reference: ArtifactReference): Promise<T> {
    if (!this.values.has(reference.object_id)) throw new Error(`missing artifact: ${reference.object_id}`);
    return clone(this.values.get(reference.object_id) as T);
  }
}

export class MemorySandboxCapacity implements SandboxCapacity {
  private readonly leases = new Map<string, SandboxLease>();
  private readonly idempotency = new Map<string, SandboxLease>();
  private readonly leaseKeys = new Map<string, string>();

  constructor(private readonly slots = RESOURCE_LIMITS.globalSandboxSlots, private readonly clock: WorkflowClock = new MemoryClock()) {}

  async acquire(runId: string, idempotencyKey: string): Promise<SandboxLease> {
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) return clone(existing);
    if (this.leases.size >= this.slots) {
      throw new WorkflowFault({
        code: "CAPACITY_BUSY",
        message: "All analysis Sandbox slots are currently leased",
        retryable: true,
        failedStep: "capacity",
        retryAfterMs: 15_000,
      });
    }
    const lease: SandboxLease = {
      lease_id: `lease-${runId}`,
      run_id: runId,
      expires_at: new Date(this.clock.now().getTime() + RESOURCE_LIMITS.sandboxLifetimeMs).toISOString(),
    };
    this.leases.set(lease.lease_id, lease);
    this.idempotency.set(idempotencyKey, lease);
    this.leaseKeys.set(lease.lease_id, idempotencyKey);
    return clone(lease);
  }

  async release(lease: SandboxLease, idempotencyKey: string): Promise<void> {
    const expectedKey = this.leaseKeys.get(lease.lease_id);
    if (expectedKey && expectedKey !== idempotencyKey) {
      throw new Error("capacity lease idempotency key mismatch");
    }
    this.leases.delete(lease.lease_id);
    this.leaseKeys.delete(lease.lease_id);
    for (const [key, value] of this.idempotency) {
      if (value.lease_id === lease.lease_id) this.idempotency.delete(key);
    }
  }

  get activeCount(): number {
    return this.leases.size;
  }
}

export class DemoSandboxAdapter implements SandboxAdapter {
  profileCalls = 0;
  executeCalls = 0;
  cancelCalls = 0;
  readonly executedCode: string[] = [];
  readonly executionOutcomes: SandboxAnalysisResult[] = [];
  private readonly cachedProfiles = new Map<string, SandboxProfileResult>();
  private readonly cachedExecutions = new Map<string, SandboxAnalysisResult>();

  async profile(context: RunContext, call: ProviderCallContext): Promise<SandboxProfileResult> {
    const cached = this.cachedProfiles.get(call.idempotency_key);
    if (cached) return clone(cached);
    this.profileCalls += 1;
    const result = SandboxProfileResultSchema.parse({
      schema_version: "1",
      run_id: context.run_id,
      datasets: context.assets.map((asset) => ({
        asset_id: asset.asset_id,
        file_name: asset.file_name,
        format: asset.format,
        sheet_name: asset.sheet_name ?? null,
        row_count: 10,
        column_count: 2,
        columns: [
          {
            name: "category",
            data_type: "categorical",
            non_null_count: 10,
            missing_count: 0,
            unique_count: 2,
            minimum: null,
            maximum: null,
            mean: null,
            sample_values: ["A", "B"],
          },
          {
            name: "value",
            data_type: "numeric",
            non_null_count: 10,
            missing_count: 0,
            unique_count: 10,
            minimum: 1,
            maximum: 10,
            mean: 5.5,
            sample_values: [1, 2, 3],
          },
        ],
        sample_rows: [
          { category: "A", value: 1 },
          { category: "B", value: 2 },
        ],
      })),
    });
    this.cachedProfiles.set(call.idempotency_key, result);
    return clone(result);
  }

  async execute(context: RunContext, code: string, call: ProviderCallContext): Promise<SandboxAnalysisResult> {
    const cached = this.cachedExecutions.get(call.idempotency_key);
    if (cached) return clone(cached);
    this.executeCalls += 1;
    this.executedCode.push(code);
    const queued = this.executionOutcomes.shift();
    const result = SandboxAnalysisResultSchema.parse(
      queued ?? {
        schema_version: "1",
        run_id: context.run_id,
        ok: true,
        result: { row_count: 10, columns: ["category", "value"] },
        error: null,
        stdout: "",
        stderr: "",
      },
    );
    this.cachedExecutions.set(call.idempotency_key, result);
    return clone(result);
  }

  async cancel(_runId: string): Promise<void> {
    this.cancelCalls += 1;
  }

  async suspend(_runId: string): Promise<void> {}
}
