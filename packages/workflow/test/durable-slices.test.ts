import { describe, expect, it } from "vitest";

import type { SandboxAnalysisResult } from "@dreamify/contracts";

import { BoundedMorpheusWorkflow } from "../src/engine.js";
import { DemoProvider } from "../src/provider.js";
import {
  DemoSandboxAdapter,
  MemoryArtifactStore,
  MemoryClock,
  MemorySandboxCapacity,
  MemoryWorkflowStore,
} from "../src/testing/memory.js";
import type { RunContext } from "../src/types.js";

const context: RunContext = {
  run_id: "run-sliced",
  conversation_id: "conversation-sliced",
  project_id: "project-sliced",
  owner_id: "owner-sliced",
  prompt: "Analyze all files",
  assets: [
    {
      asset_id: "asset-1",
      object_id: "object-1",
      file_name: "sales.csv",
      format: "csv",
      media_type: "text/csv",
      size_bytes: 1_024,
      sha256: "a".repeat(64),
      relative_path: "input/sales.csv",
    },
  ],
  theme_id: "default",
  focus_id: null,
  existing_dashboard: null,
  edit_target: null,
  conversation_revision_object_id: "revision-sliced",
};

describe("durable engine slices", () => {
  it("keeps the five-call provider budget across recreated workflow engines", async () => {
    const clock = new MemoryClock();
    const store = new MemoryWorkflowStore(context, clock);

    expect(await store.reserveProviderCall(context.run_id, "route:attempt:1")).toEqual({
      ordinal: 1,
      created: true,
    });
    expect(await store.reserveProviderCall(context.run_id, "route:attempt:1")).toEqual({
      ordinal: 1,
      created: false,
    });
    for (let ordinal = 2; ordinal <= 5; ordinal += 1) {
      expect(await store.reserveProviderCall(context.run_id, `effect:${ordinal}`)).toEqual({
        ordinal,
        created: true,
      });
    }
    const recreatedDependencies = {
      store,
      artifacts: new MemoryArtifactStore(),
      capacity: new MemorySandboxCapacity(2, clock),
      sandbox: new DemoSandboxAdapter(),
      provider: new DemoProvider(),
      clock,
    };
    expect(new BoundedMorpheusWorkflow(recreatedDependencies)).toBeDefined();
    await expect(store.reserveProviderCall(context.run_id, "effect:6")).rejects.toMatchObject({
      code: "PROVIDER_CALL_BUDGET_EXCEEDED",
      retryable: false,
    });
  });

  it("fails closed when a provider reservation survives without its enclosing step result", async () => {
    const noDataContext = { ...context, assets: [], prompt: "What can Dreamify do?" };
    const clock = new MemoryClock();
    const store = new MemoryWorkflowStore(noDataContext, clock);
    const claimEvent = {
      run_id: context.run_id,
      event_key: "claim:completed",
      phase: "queued" as const,
      status: "completed" as const,
      title: "Workflow accepted",
      summary: null,
      detail: null,
      started_at: clock.now().toISOString(),
      completed_at: null,
      duration_ms: null,
      metadata: {},
    };
    await store.claimRun(context.run_id, "vercel-workflow-crash", claimEvent);
    await store.reserveProviderCall(context.run_id, "route:attempt:1");
    let providerCalls = 0;
    const provider = new DemoProvider();
    const dependencies = {
      store,
      artifacts: new MemoryArtifactStore(),
      capacity: new MemorySandboxCapacity(2, clock),
      sandbox: new DemoSandboxAdapter(),
      provider: {
        ...provider,
        providerId: provider.providerId,
        routeAndPlan: async (...args: Parameters<DemoProvider["routeAndPlan"]>) => {
          providerCalls += 1;
          return provider.routeAndPlan(...args);
        },
        repairAnalysisCode: provider.repairAnalysisCode.bind(provider),
        synthesize: provider.synthesize.bind(provider),
        repairSynthesis: provider.repairSynthesis.bind(provider),
      },
      clock,
    };

    const result = await new BoundedMorpheusWorkflow(dependencies).execute(context.run_id, {
      workflow_execution_id: "vercel-workflow-crash",
    });

    expect(result.run.status).toBe("failed");
    expect(result.run.error).toMatchObject({
      code: "PROVIDER_CALL_OUTCOME_UNKNOWN",
      retryable: false,
    });
    expect(providerCalls).toBe(0);
  });

  it("persists one bounded phase per invocation and resumes to completion", async () => {
    const clock = new MemoryClock();
    const store = new MemoryWorkflowStore(context, clock);
    const artifacts = new MemoryArtifactStore();
    const capacity = new MemorySandboxCapacity(2, clock);
    const sandbox = new DemoSandboxAdapter();
    const dependencies = { store, artifacts, capacity, sandbox, provider: new DemoProvider(), clock };

    const outcomes = [];
    for (let index = 0; index < 12; index += 1) {
      const result = await new BoundedMorpheusWorkflow(dependencies).execute("run-sliced", {
        workflow_execution_id: "vercel-workflow-1",
        max_completed_steps: 1,
      });
      outcomes.push(result);
      if (!result.paused) break;
    }

    expect(outcomes.at(-1)?.run.status).toBe("completed");
    expect(outcomes.filter((item) => item.paused).length).toBeGreaterThanOrEqual(6);
    expect(sandbox.profileCalls).toBe(1);
    expect(sandbox.executeCalls).toBe(1);
    expect(capacity.activeCount).toBe(0);
  });

  it("never runs the initial generated program and its repair in the same durable slice", async () => {
    const clock = new MemoryClock();
    const store = new MemoryWorkflowStore(context, clock);
    const artifacts = new MemoryArtifactStore();
    const capacity = new MemorySandboxCapacity(2, clock);
    const sandbox = new DemoSandboxAdapter();
    const failed: SandboxAnalysisResult = {
      schema_version: "1",
      run_id: context.run_id,
      ok: false,
      result: null,
      error: { code: "CODE_ERROR", message: "repair me", retryable: false },
      stdout: "",
      stderr: "repair me",
    };
    sandbox.executionOutcomes.push(failed);
    const dependencies = { store, artifacts, capacity, sandbox, provider: new DemoProvider(), clock };

    let finalStatus = "queued";
    for (let index = 0; index < 16; index += 1) {
      const callsBefore = sandbox.executeCalls;
      const result = await new BoundedMorpheusWorkflow(dependencies).execute("run-sliced", {
        workflow_execution_id: "vercel-workflow-repair",
        max_completed_steps: 1,
      });
      expect(sandbox.executeCalls - callsBefore).toBeLessThanOrEqual(1);
      finalStatus = result.run.status;
      if (!result.paused) break;
    }

    expect(finalStatus).toBe("completed");
    expect(sandbox.executeCalls).toBe(2);
    expect(capacity.activeCount).toBe(0);
  });

  it("yields capacity contention to a durable sleep instead of waiting in the function", async () => {
    const clock = new MemoryClock();
    const store = new MemoryWorkflowStore(context, clock);
    const dependencies = {
      store,
      artifacts: new MemoryArtifactStore(),
      capacity: new MemorySandboxCapacity(0, clock),
      sandbox: new DemoSandboxAdapter(),
      provider: new DemoProvider(),
      clock,
    };
    await new BoundedMorpheusWorkflow(dependencies).execute("run-sliced", {
      workflow_execution_id: "vercel-workflow-capacity",
      max_completed_steps: 1,
      yield_on_capacity_wait: true,
    });
    const waiting = await new BoundedMorpheusWorkflow(dependencies).execute("run-sliced", {
      workflow_execution_id: "vercel-workflow-capacity",
      max_completed_steps: 1,
      yield_on_capacity_wait: true,
    });

    expect(waiting).toMatchObject({ paused: true, retry_after_ms: 15_000 });
    expect(clock.sleeps).toEqual([]);
  });

  it("terminalizes cancellation requested between durable slices", async () => {
    const clock = new MemoryClock();
    const store = new MemoryWorkflowStore(context, clock);
    const capacity = new MemorySandboxCapacity(2, clock);
    const sandbox = new DemoSandboxAdapter();
    const dependencies = {
      store,
      artifacts: new MemoryArtifactStore(),
      capacity,
      sandbox,
      provider: new DemoProvider(),
      clock,
    };
    const first = await new BoundedMorpheusWorkflow(dependencies).execute("run-sliced", {
      workflow_execution_id: "vercel-workflow-cancel",
      max_completed_steps: 1,
    });
    expect(first.paused).toBe(true);
    await store.requestCancellation("run-sliced", "user");

    const cancelled = await new BoundedMorpheusWorkflow(dependencies).execute("run-sliced", {
      workflow_execution_id: "vercel-workflow-cancel",
      max_completed_steps: 1,
    });
    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.paused).not.toBe(true);
    expect(sandbox.cancelCalls).toBe(1);
    expect(capacity.activeCount).toBe(0);
  });
});
