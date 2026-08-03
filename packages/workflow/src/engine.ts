import {
  RESOURCE_LIMITS,
  SandboxAnalysisResultSchema,
  SandboxProfileResultSchema,
  WorkflowResponseSchema,
  isTerminalRunStatus,
  type EventPhase,
  type EventStatus,
  type NewThinkingEvent,
  type RunResultReference,
  type WorkflowResponse,
  type WorkflowStep,
} from "@dreamify/contracts";
import { z } from "zod";

import {
  CancellationFault,
  SupersededFault,
  WorkflowFault,
  normalizeWorkflowFault,
} from "./errors.js";
import { assertProviderPayloadSize } from "./provider.js";
import type { WorkflowDependencies } from "./ports.js";
import {
  RoutePlanSchema,
  RunContextSchema,
  type ArtifactReference,
  type RoutePlan,
  type RunContext,
  type SandboxLease,
  type WorkflowExecutionResult,
} from "./types.js";

const RETRY_DELAYS_MS = [2_000, 8_000] as const;
const PROVIDER_ATTEMPTS = {
  routing: 2,
  repairCode: 1,
  synthesis: 1,
  repairSynthesis: 1,
} as const;

export interface ExecuteOptions {
  workflow_execution_id: string;
  signal?: AbortSignal;
  /** Persist at most this many previously-incomplete engine steps, then yield. */
  max_completed_steps?: number;
  /** Yield capacity backoff to the durable Workflow instead of sleeping in a function. */
  yield_on_capacity_wait?: boolean;
}

interface StepDefinition {
  key: string;
  step: WorkflowStep;
  phase: EventPhase;
  title: string;
}

interface AcquiredCapacity {
  lease: SandboxLease;
  idempotencyKey: string;
}

function nowIso(date: Date): string {
  return date.toISOString();
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function componentIdentifiers(component: {
  id: string;
  component_config: { id: string };
}): Set<string> {
  return new Set([component.id, component.component_config.id]);
}

function editDashboardError(
  context: RunContext,
  response: WorkflowResponse,
): string | null {
  if (response.type !== "chart_modification") return null;
  if (!context.edit_target || !context.existing_dashboard) {
    return "A chart modification requires an explicit existing-dashboard target";
  }
  const original = context.existing_dashboard;
  const edited = response.dashboard;
  if (edited.id !== original.id) return "The edit changed the dashboard identity";

  const targetIds = new Set(context.edit_target.component_ids);
  const editedIds = new Set(
    edited.components.flatMap((component) => [...componentIdentifiers(component)]),
  );
  if ([...targetIds].some((identifier) => !editedIds.has(identifier))) {
    return "The edit removed a targeted component identity";
  }

  const originalById = new Map(original.components.map((component) => [component.id, component]));
  const editedById = new Map(edited.components.map((component) => [component.id, component]));
  if (
    originalById.size !== editedById.size ||
    [...originalById].some(([identifier]) => !editedById.has(identifier))
  ) {
    return "The edit added or removed dashboard components";
  }
  const changedUntargeted = [...originalById].some(([identifier, component]) => {
    if ([...componentIdentifiers(component)].some((value) => targetIds.has(value))) return false;
    return JSON.stringify(component) !== JSON.stringify(editedById.get(identifier));
  });
  if (changedUntargeted) return "The edit changed a component outside its target set";

  const originalShell = { ...original, components: [] };
  const editedShell = { ...edited, components: [] };
  return JSON.stringify(originalShell) === JSON.stringify(editedShell)
    ? null
    : "The component edit changed dashboard-level properties";
}

function dashboardLayoutError(response: WorkflowResponse): string | null {
  if (response.type !== "dashboard_config" && response.type !== "chart_modification") return null;
  const components = response.dashboard.components;
  for (let left = 0; left < components.length; left += 1) {
    for (let right = left + 1; right < components.length; right += 1) {
      const a = components[left]!.position;
      const b = components[right]!.position;
      const overlaps =
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      if (overlaps) return "Dashboard components overlap";
    }
  }
  return null;
}

/** Internal control flow used to split one logical run across durable steps. */
export class WorkflowExecutionYield extends Error {
  constructor(readonly retryAfterMs = 0) {
    super("Workflow execution slice completed");
    this.name = "WorkflowExecutionYield";
  }
}

export class BoundedMorpheusWorkflow {
  private startedAt = 0;
  private sandboxCommands = 0;
  private completedSteps = 0;
  private maxCompletedSteps: number | undefined;
  private yieldOnCapacityWait = false;
  private signal: AbortSignal | undefined;

  constructor(private readonly dependencies: WorkflowDependencies) {}

  async execute(runId: string, options: ExecuteOptions): Promise<WorkflowExecutionResult> {
    this.startedAt = this.dependencies.clock.now().getTime();
    this.sandboxCommands = 0;
    this.completedSteps = 0;
    this.maxCompletedSteps = options.max_completed_steps;
    this.yieldOnCapacityWait = options.yield_on_capacity_wait ?? false;
    this.signal = options.signal;
    const claimEvent = this.event(runId, "claim:completed", "queued", "completed", "Workflow accepted");
    const claim = await this.dependencies.store.claimRun(runId, options.workflow_execution_id, claimEvent);

    if (claim === "busy") {
      return { run: await this.dependencies.store.getRun(runId), response: null, ignored: true };
    }
    if (claim === "terminal") {
      return {
        run: await this.dependencies.store.getRun(runId),
        response: await this.dependencies.store.getResponse(runId),
        ignored: false,
      };
    }
    const claimedRun = await this.dependencies.store.getRun(runId);
    this.startedAt = Date.parse(claimedRun.started_at ?? claimedRun.created_at);

    let capacity: AcquiredCapacity | null = null;
    let preserveSandbox = false;
    try {
      const context = await this.step(
        runId,
        { key: "context", step: "context", phase: "context", title: "Validated conversation context" },
        async () => this.validateContext(await this.dependencies.store.getContext(runId)),
      );

      const preflightClarification = this.preflightClarification(context);
      if (preflightClarification) {
        return await this.finishWithResponse(runId, preflightClarification, "awaiting_user_input");
      }

      let profileReference: ArtifactReference | null = null;
      if (context.assets.length > 0) {
        const cachedProfile = await this.dependencies.store.getStepResult<ArtifactReference>(
          runId,
          "profile",
        );
        if (cachedProfile.found) {
          profileReference = cachedProfile.value;
        } else {
          capacity = await this.acquireCapacity(runId, "profile");
          profileReference = await this.profileData(context);
        }
      }

      const profile = profileReference
        ? await this.dependencies.artifacts.getJson<unknown>(runId, profileReference)
        : null;
      const parsedProfile = profile ? SandboxProfileResultSchema.parse(profile) : null;
      const plan = await this.planRoute(context, parsedProfile);

      if (plan.response_type === "clarification_request") {
        const clarification = plan.clarification;
        if (!clarification) {
          throw new WorkflowFault({
            code: "MODEL_OUTPUT_INVALID",
            message: "The route omitted its clarification payload",
            retryable: false,
            failedStep: "routing",
          });
        }
        return await this.finishWithResponse(
          runId,
          {
            type: "clarification_request",
            content: clarification.question,
            clarification_id: clarification.clarification_id,
            reason_code: clarification.reason_code,
            options: clarification.options,
          },
          "awaiting_user_input",
        );
      }

      let analysisReference: ArtifactReference | null = null;
      if (plan.requires_data) {
        if (!parsedProfile) {
          throw new WorkflowFault({
            code: "PROFILE_REQUIRED",
            message: "A data plan requires a validated profile",
            retryable: false,
            failedStep: "analysis",
          });
        }
        const cachedAnalysis = await this.dependencies.store.getStepResult<ArtifactReference>(
          runId,
          "analysis",
        );
        if (cachedAnalysis.found) {
          analysisReference = cachedAnalysis.value;
        } else {
          capacity ??= await this.acquireCapacity(runId, "analysis");
          analysisReference = await this.analyzeData(context, parsedProfile, plan);
        }
      }

      const analysis = analysisReference
        ? await this.dependencies.artifacts.getJson<Record<string, unknown>>(runId, analysisReference)
        : null;
      const response = await this.synthesize(context, parsedProfile, analysis, plan);
      return await this.finishWithResponse(runId, response, "completed");
    } catch (error) {
      if (error instanceof WorkflowExecutionYield) {
        await this.dependencies.sandbox.suspend(runId);
        preserveSandbox = true;
        return {
          run: await this.dependencies.store.getRun(runId),
          response: null,
          ignored: false,
          paused: true,
          retry_after_ms: error.retryAfterMs,
        };
      }
      const fault = normalizeWorkflowFault(error);
      if (fault instanceof CancellationFault || fault.code === "CANCELLED") {
        await this.dependencies.sandbox.cancel(runId).catch(() => undefined);
        const run = await this.dependencies.store.transition(runId, {
          allowed_from: ["queued", "running", "cancelling"],
          status: "cancelled",
          current_step: "done",
          error: null,
          event: this.event(runId, "cancelled", "final", "completed", fault.message),
        });
        return { run, response: null, ignored: false };
      }

      const run = await this.dependencies.store.transition(runId, {
        allowed_from: ["queued", "running", "cancelling"],
        status: "failed",
        current_step: fault.failedStep ?? "done",
        error: fault.toRunError(),
        event: this.event(runId, `failed:${fault.code}`, "error", "error", "Workflow failed", {
          code: fault.code,
          retryable: fault.retryable,
        }),
      });
      return { run, response: null, ignored: false };
    } finally {
      if (!preserveSandbox) {
        await this.dependencies.sandbox.cleanup?.(runId).catch(() => undefined);
      }
      if (capacity) {
        await this.dependencies.capacity
          .release(capacity.lease, capacity.idempotencyKey)
          .catch(() => undefined);
      }
    }
  }

  private async profileData(context: RunContext): Promise<ArtifactReference> {
    return this.step(
      context.run_id,
      { key: "profile", step: "profiling", phase: "profiling", title: "Profiled bounded datasets" },
      async () => {
        this.countSandboxCommand();
        const result = await this.dependencies.sandbox.profile(context, {
          idempotency_key: `${context.run_id}:profile`,
          ...(this.signal ? { signal: this.signal } : {}),
        });
        const profile = SandboxProfileResultSchema.parse(result);
        if (byteLength(profile) > RESOURCE_LIMITS.maxProfileBytes) {
          throw new WorkflowFault({
            code: "PROFILE_TOO_LARGE",
            message: "Sandbox profile exceeded its serialized limit",
            retryable: false,
            failedStep: "profiling",
          });
        }
        return this.dependencies.artifacts.putJson(
          context.run_id,
          "profile",
          profile,
          `${context.run_id}:profile:artifact`,
          RESOURCE_LIMITS.maxProfileBytes,
        );
      },
    );
  }

  private async acquireCapacity(
    runId: string,
    purpose: "profile" | "analysis",
  ): Promise<AcquiredCapacity> {
    // Persisted run start makes this bound survive Workflow step replay/slicing.
    const waitStartedAt = this.startedAt;
    const eventKey = `capacity:${purpose}`;
    await this.dependencies.store.beginStep(
      runId,
      eventKey,
      "capacity",
      this.event(runId, `${eventKey}:active`, "capacity", "active", "Waiting for isolated analysis capacity"),
    );
    while (
      this.dependencies.clock.now().getTime() - waitStartedAt <
      RESOURCE_LIMITS.sandboxCapacityWaitMs
    ) {
      try {
        const idempotencyKey = `${runId}:capacity:${purpose}`;
        const lease = await this.dependencies.capacity.acquire(runId, idempotencyKey);
        await this.dependencies.store.completeStep(
          runId,
          eventKey,
          { purpose, reserved: true },
          this.event(
            runId,
            `${eventKey}:completed`,
            "capacity",
            "completed",
            "Reserved isolated analysis capacity",
          ),
        );
        return { lease, idempotencyKey };
      } catch (error) {
        const fault = normalizeWorkflowFault(error, "capacity");
        if (!fault.retryable || fault.code !== "CAPACITY_BUSY") {
          throw fault;
        }
        const remaining =
          RESOURCE_LIMITS.sandboxCapacityWaitMs -
          (this.dependencies.clock.now().getTime() - waitStartedAt);
        if (remaining <= 0) {
          break;
        }
        const delay = Math.min(fault.retryAfterMs ?? 15_000, remaining);
        if (this.yieldOnCapacityWait) {
          throw new WorkflowExecutionYield(delay);
        }
        await this.dependencies.clock.sleep(delay);
        await this.ensureActive(runId);
      }
    }
    throw new WorkflowFault({
      code: "CAPACITY_BUSY",
      message: "No Sandbox slot became available within ten minutes",
      retryable: true,
      failedStep: "capacity",
    });
  }

  private async planRoute(
    context: RunContext,
    profile: ReturnType<typeof SandboxProfileResultSchema.parse> | null,
  ): Promise<RoutePlan> {
    return this.step(
      context.run_id,
      { key: "route", step: "routing", phase: "routing", title: "Selected a bounded response path" },
      async () => {
        const raw = await this.providerCall(
          context.run_id,
          "routing",
          PROVIDER_ATTEMPTS.routing,
          "route",
          (signal, attempt) =>
            this.dependencies.provider.routeAndPlan(
              { context, profile },
              {
                idempotency_key: `${context.run_id}:route:${attempt}`,
                signal,
              },
            ),
        );
        assertProviderPayloadSize(raw);
        try {
          return RoutePlanSchema.parse(raw);
        } catch (error) {
          throw this.invalidModelOutput(error, "routing");
        }
      },
    );
  }

  private async analyzeData(
    context: RunContext,
    profile: ReturnType<typeof SandboxProfileResultSchema.parse>,
    plan: RoutePlan,
  ): Promise<ArtifactReference> {
    const code = plan.analysis_code;
    if (!code) {
      throw new WorkflowFault({
        code: "ANALYSIS_CODE_MISSING",
        message: "The data plan did not contain analysis code",
        retryable: false,
        failedStep: "analysis",
      });
    }

    let execution = await this.step(
      context.run_id,
      {
        key: "analysis:initial",
        step: "analysis",
        phase: "analysis",
        title: "Executed isolated data analysis",
      },
      () => this.executeSandboxCode(context, code, "initial"),
    );
    if (!execution.ok) {
      const failure = execution.error;
      if (!failure) {
        throw new WorkflowFault({
          code: "SANDBOX_INVALID_RESULT",
          message: "Sandbox failure omitted error details",
          retryable: false,
          failedStep: "analysis",
        });
      }
      const repaired = await this.step(
        context.run_id,
        {
          key: "analysis:repair-code",
          step: "analysis",
          phase: "analysis",
          title: "Repaired bounded analysis code",
        },
        async () => {
          const value = await this.providerCall(
            context.run_id,
            "analysis",
            PROVIDER_ATTEMPTS.repairCode,
            "repair-code",
            (signal, attempt) =>
              this.dependencies.provider.repairAnalysisCode(
                { context, profile, failed_code: code, failure },
                {
                  idempotency_key: `${context.run_id}:repair-code:${attempt}`,
                  signal,
                },
              ),
          );
          if (
            typeof value !== "string" ||
            value.length > RESOURCE_LIMITS.maxAnalysisCodeCharacters
          ) {
            throw new WorkflowFault({
              code: "MODEL_OUTPUT_INVALID",
              message: "Analysis repair did not return bounded Python code",
              retryable: false,
              failedStep: "analysis",
            });
          }
          return value;
        },
      );
      execution = await this.step(
        context.run_id,
        {
          key: "analysis:repair-execution",
          step: "analysis",
          phase: "analysis",
          title: "Executed one isolated analysis repair",
        },
        () => this.executeSandboxCode(context, repaired, "repair"),
      );
    }

    if (!execution.ok || !execution.result) {
      throw new WorkflowFault({
        code: execution.error?.code ?? "ANALYSIS_FAILED",
        message: execution.error?.message ?? "The isolated analysis failed after one repair",
        retryable: false,
        failedStep: "analysis",
      });
    }
    if (byteLength(execution.result) > RESOURCE_LIMITS.maxAnalysisResultBytes) {
      throw new WorkflowFault({
        code: "ANALYSIS_RESULT_TOO_LARGE",
        message: "Analysis result exceeded its serialized limit",
        retryable: false,
        failedStep: "analysis",
      });
    }
    return this.step(
      context.run_id,
      {
        key: "analysis",
        step: "analysis",
        phase: "analysis",
        title: "Persisted isolated data analysis",
      },
      () =>
        this.dependencies.artifacts.putJson(
          context.run_id,
          "analysis",
          execution.result,
          `${context.run_id}:analysis:artifact`,
          RESOURCE_LIMITS.maxAnalysisResultBytes,
        ),
    );
  }

  private async executeSandboxCode(
    context: RunContext,
    code: string,
    attempt: "initial" | "repair",
  ): Promise<ReturnType<typeof SandboxAnalysisResultSchema.parse>> {
    this.countSandboxCommand();
    const raw = await this.dependencies.sandbox.execute(context, code, {
      idempotency_key: `${context.run_id}:analysis:${attempt}`,
      ...(this.signal ? { signal: this.signal } : {}),
    });
    return SandboxAnalysisResultSchema.parse(raw);
  }

  private async synthesize(
    context: RunContext,
    profile: ReturnType<typeof SandboxProfileResultSchema.parse> | null,
    analysis: Record<string, unknown> | null,
    plan: RoutePlan,
  ): Promise<WorkflowResponse> {
    return this.step(
      context.run_id,
      { key: "synthesis", step: "synthesis", phase: "synthesis", title: "Synthesized a structured response" },
      async () => {
        const synthesisInput = { context, plan, profile, analysis };
        const raw = await this.providerCall(
          context.run_id,
          "synthesis",
          PROVIDER_ATTEMPTS.synthesis,
          "synthesis",
          (signal, attempt) =>
            this.dependencies.provider.synthesize(synthesisInput, {
              idempotency_key: `${context.run_id}:synthesis:${attempt}`,
              signal,
            }),
        );
        assertProviderPayloadSize(raw);
        const first = this.validateSynthesisOutput(context, plan, raw);
        if (first.success) {
          return first.data;
        }

        const repaired = await this.providerCall(
          context.run_id,
          "validation",
          PROVIDER_ATTEMPTS.repairSynthesis,
          "repair-synthesis",
          (signal, attempt) =>
            this.dependencies.provider.repairSynthesis(
              {
                ...synthesisInput,
                invalid_output: raw,
                validation_error: first.message.slice(0, 2_000),
              },
              {
                idempotency_key: `${context.run_id}:repair-synthesis:${attempt}`,
                signal,
              },
            ),
        );
        assertProviderPayloadSize(repaired);
        const second = this.validateSynthesisOutput(context, plan, repaired);
        if (!second.success) {
          if (
            plan.response_type === "chart_modification" &&
            context.existing_dashboard &&
            context.edit_target
          ) {
            return WorkflowResponseSchema.parse({
              type: "chart_modification",
              content: "I could not verify the requested edit, so the original dashboard was preserved.",
              dashboard: context.existing_dashboard,
              edit_note: "No changes were saved because the repaired edit still failed validation.",
            });
          }
          throw new WorkflowFault({
            code: "MODEL_OUTPUT_INVALID",
            message: second.message.slice(0, 1_000),
            retryable: false,
            failedStep: "validation",
          });
        }
        return second.data;
      },
    );
  }

  private validateSynthesisOutput(
    context: RunContext,
    plan: RoutePlan,
    value: unknown,
  ): { success: true; data: WorkflowResponse } | { success: false; message: string } {
    const parsed = WorkflowResponseSchema.safeParse(value);
    if (!parsed.success) return { success: false, message: parsed.error.message };
    if (parsed.data.type !== plan.response_type) {
      return { success: false, message: "The response type does not match the route plan" };
    }
    const layoutError = dashboardLayoutError(parsed.data);
    if (layoutError) return { success: false, message: layoutError };
    const editError = editDashboardError(context, parsed.data);
    return editError
      ? { success: false, message: editError }
      : { success: true, data: parsed.data };
  }

  private async finishWithResponse(
    runId: string,
    response: WorkflowResponse,
    terminalStatus: "completed" | "awaiting_user_input",
  ): Promise<WorkflowExecutionResult> {
    await this.ensureActive(runId);
    const parsed = WorkflowResponseSchema.parse(response);
    const artifact = await this.dependencies.artifacts.putJson(
      runId,
      "response",
      parsed,
      `${runId}:response`,
      RESOURCE_LIMITS.maxDashboardBytes,
    );
    const resultReference: RunResultReference = {
      message_id: `message-${runId}`,
      ...(parsed.type === "dashboard_config" || parsed.type === "chart_modification"
        ? { dashboard_id: parsed.dashboard.id }
        : {}),
      artifact_ids: [artifact.object_id],
      response_type: parsed.type,
    };
    const run = await this.dependencies.store.commitResponse(
      runId,
      terminalStatus,
      parsed,
      artifact,
      resultReference,
      this.event(
        runId,
        terminalStatus === "completed" ? "persist:completed" : "clarification:completed",
        terminalStatus === "completed" ? "final" : "clarification",
        "completed",
        terminalStatus === "completed" ? "Workflow completed" : "Waiting for your choice",
      ),
    );
    return { run, response: parsed, ignored: false };
  }

  private validateContext(input: RunContext): RunContext {
    let context: RunContext;
    try {
      context = RunContextSchema.parse(input);
    } catch (error) {
      throw new WorkflowFault({
        code: "INVALID_CONTEXT",
        message: error instanceof Error ? error.message : "Invalid workflow context",
        retryable: false,
        failedStep: "context",
      });
    }
    const totalBytes = context.assets.reduce((sum, asset) => sum + asset.size_bytes, 0);
    if (totalBytes > RESOURCE_LIMITS.maxAggregateFileBytes) {
      throw new WorkflowFault({
        code: "INPUT_TOO_LARGE",
        message: "Aggregate asset size exceeded",
        retryable: false,
        failedStep: "context",
      });
    }
    const assetIds = new Set(context.assets.map((asset) => asset.asset_id));
    if (assetIds.size !== context.assets.length) {
      throw new WorkflowFault({
        code: "DUPLICATE_ASSET",
        message: "Duplicate asset references are not allowed",
        retryable: false,
        failedStep: "context",
      });
    }
    return context;
  }

  private preflightClarification(context: RunContext): WorkflowResponse | null {
    if (context.assets.length < 2) {
      return null;
    }
    const prompt = context.prompt.toLowerCase();
    const identifiesAssets = context.assets.some((asset) => prompt.includes(asset.file_name.toLowerCase()));
    const explicitlyCombines = /\b(all|both|combine|compare|join|merge)\b/.test(prompt);
    if (identifiesAssets || explicitlyCombines) {
      return null;
    }
    return {
      type: "clarification_request",
      content: "Which data source should I analyze?",
      clarification_id: `asset-${context.run_id}`,
      reason_code: "asset",
      options: context.assets.map((asset) => ({ id: asset.asset_id, label: asset.file_name })),
    };
  }

  private async step<T>(runId: string, definition: StepDefinition, effect: () => Promise<T>): Promise<T> {
    this.assertDeadline();
    await this.ensureActive(runId);
    const cached = await this.dependencies.store.getStepResult<T>(runId, definition.key);
    if (cached.found) {
      return cached.value as T;
    }

    const startedAt = this.dependencies.clock.now();
    await this.dependencies.store.beginStep(
      runId,
      definition.key,
      definition.step,
      this.event(runId, `${definition.key}:active`, definition.phase, "active", definition.title),
    );
    const result = await effect();
    await this.ensureActive(runId);
    const completedAt = this.dependencies.clock.now();
    await this.dependencies.store.completeStep(
      runId,
      definition.key,
      result,
      this.event(
        runId,
        `${definition.key}:completed`,
        definition.phase,
        "completed",
        definition.title,
        {},
        startedAt,
        completedAt,
      ),
    );
    this.completedSteps += 1;
    if (
      this.maxCompletedSteps !== undefined &&
      this.completedSteps >= this.maxCompletedSteps
    ) {
      throw new WorkflowExecutionYield();
    }
    return result;
  }

  private async ensureActive(runId: string): Promise<void> {
    if (this.signal?.aborted) {
      if (this.signal.reason instanceof WorkflowFault) throw this.signal.reason;
      throw new CancellationFault();
    }
    const run = await this.dependencies.store.getRun(runId);
    if (run.cancel_requested || run.status === "cancelling") {
      if (run.cancel_reason === "superseded") {
        throw new SupersededFault();
      }
      throw new CancellationFault();
    }
    if (isTerminalRunStatus(run.status)) {
      throw new CancellationFault(`Run is already terminal: ${run.status}`);
    }
  }

  private assertDeadline(): void {
    if (this.dependencies.clock.now().getTime() - this.startedAt >= RESOURCE_LIMITS.workflowDeadlineMs) {
      throw new WorkflowFault({
        code: "WORKFLOW_DEADLINE_EXCEEDED",
        message: "Workflow exceeded its twenty-minute application deadline",
        retryable: true,
      });
    }
  }

  private async providerCall<T>(
    runId: string,
    step: WorkflowStep,
    maxAttempts: number,
    operationKey: string,
    operation: (signal: AbortSignal, attempt: number) => Promise<T>,
  ): Promise<T> {
    return this.retry(runId, step, maxAttempts, async (attempt) => {
      const callKey = `${operationKey}:attempt:${attempt}`;
      const reservation = await this.dependencies.store.reserveProviderCall(runId, callKey);
      if (!reservation.created) {
        throw new WorkflowFault({
          code: "PROVIDER_CALL_OUTCOME_UNKNOWN",
          message: "A reserved provider call has no durable enclosing-step result",
          retryable: false,
          failedStep: step,
        });
      }
      return this.withProviderAttemptTimeout(step, (signal) => operation(signal, attempt));
    });
  }

  private async withProviderAttemptTimeout<T>(
    step: WorkflowStep,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.signal?.aborted) throw new CancellationFault();
    const controller = new AbortController();
    const cancel = () => controller.abort(this.signal?.reason);
    this.signal?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const fault = new WorkflowFault({
          code: "PROVIDER_TIMEOUT",
          message: "Model provider attempt exceeded ninety seconds",
          retryable: true,
          failedStep: step,
        });
        reject(fault);
        controller.abort(fault);
      }, RESOURCE_LIMITS.providerAttemptTimeoutMs);
    });
    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } catch (error) {
      if (this.signal?.aborted) {
        if (this.signal.reason instanceof WorkflowFault) throw this.signal.reason;
        throw new CancellationFault();
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      this.signal?.removeEventListener("abort", cancel);
    }
  }

  private async retry<T>(
    runId: string,
    step: WorkflowStep,
    maxAttempts: number,
    operation: (attempt: number) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.assertDeadline();
      await this.ensureActive(runId);
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        const fault = normalizeWorkflowFault(error, step);
        if (!fault.retryable || attempt === maxAttempts) {
          throw fault;
        }
        const fallback = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 8_000;
        const delay = Math.min(fault.retryAfterMs ?? fallback, 60_000);
        await this.dependencies.clock.sleep(delay);
      }
    }
    throw normalizeWorkflowFault(lastError, step);
  }

  private countSandboxCommand(): void {
    this.sandboxCommands += 1;
    if (this.sandboxCommands > RESOURCE_LIMITS.maxSandboxCommands) {
      throw new WorkflowFault({
        code: "SANDBOX_COMMAND_BUDGET_EXCEEDED",
        message: "Sandbox command budget exceeded",
        retryable: false,
        failedStep: "analysis",
      });
    }
  }

  private invalidModelOutput(error: unknown, step: WorkflowStep): WorkflowFault {
    return new WorkflowFault({
      code: "MODEL_OUTPUT_INVALID",
      message: (error instanceof z.ZodError ? error.message : "Model output failed validation").slice(
        0,
        1_000,
      ),
      retryable: false,
      failedStep: step,
    });
  }

  private event(
    runId: string,
    eventKey: string,
    phase: EventPhase,
    status: EventStatus,
    title: string,
    metadata: Record<string, unknown> = {},
    startedAt = this.dependencies.clock.now(),
    completedAt?: Date,
  ): NewThinkingEvent {
    return {
      run_id: runId,
      event_key: eventKey,
      phase,
      status,
      title,
      summary: null,
      detail: null,
      started_at: nowIso(startedAt),
      completed_at: completedAt ? nowIso(completedAt) : null,
      duration_ms: completedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : null,
      metadata,
    };
  }
}
