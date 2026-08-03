import { describe, expect, it, vi } from "vitest";

import type { DataAssetReference, SandboxAnalysisResult } from "@dreamify/contracts";

import { BoundedMorpheusWorkflow } from "../src/engine.js";
import { WorkflowFault } from "../src/errors.js";
import type { MorpheusProvider, WorkflowDependencies } from "../src/ports.js";
import { ByokProviderAdapter, DemoProvider } from "../src/provider.js";
import { assertRunTransition } from "../src/state-machine.js";
import {
  DemoSandboxAdapter,
  MemoryArtifactStore,
  MemoryClock,
  MemorySandboxCapacity,
  MemoryWorkflowStore,
} from "../src/testing/memory.js";
import type { RunContext } from "../src/types.js";

const asset = (id = "asset-1"): DataAssetReference => ({
  asset_id: id,
  object_id: `object-${id}`,
  file_name: `${id}.csv`,
  format: "csv",
  media_type: "text/csv",
  size_bytes: 1_024,
  sha256: "a".repeat(64),
  relative_path: `input/${id}.csv`,
});

const context = (assets: DataAssetReference[] = [asset()]): RunContext => ({
  run_id: "run-1",
  conversation_id: "conversation-1",
  project_id: "project-1",
  owner_id: "owner-1",
  prompt: assets.length ? "Analyze all supplied files" : "What can Dreamify do?",
  assets,
  theme_id: "default",
  focus_id: null,
  existing_dashboard: null,
  edit_target: null,
  conversation_revision_object_id: "conversation-revision-1",
});

function dependencies(input: RunContext, provider: MorpheusProvider = new DemoProvider()) {
  const clock = new MemoryClock();
  const store = new MemoryWorkflowStore(input, clock);
  const artifacts = new MemoryArtifactStore();
  const capacity = new MemorySandboxCapacity(2, clock);
  const sandbox = new DemoSandboxAdapter();
  const value: WorkflowDependencies = { store, artifacts, capacity, sandbox, provider, clock };
  return { value, clock, store, artifacts, capacity, sandbox };
}

const editableDashboard = () => ({
  id: "dashboard-original",
  title: "Original dashboard",
  theme_id: "default",
  layout: { type: "grid" as const, grid_columns: 24 },
  components: [
    {
      id: "component-target",
      type: "chart" as const,
      position: { x: 0, y: 0, width: 12, height: 8 },
      component_config: {
        id: "chart-target",
        type: "bar" as const,
        title: "Revenue",
        datasets: [{ label: "Revenue", data: [{ label: "A", value: 1 }] }],
      },
    },
    {
      id: "component-stable",
      type: "metric" as const,
      position: { x: 12, y: 0, width: 6, height: 2 },
      component_config: { id: "metric-stable", title: "Orders", value: 10 },
    },
  ],
});

describe("bounded workflow", () => {
  it("completes pure Q&A without opening analysis capacity", async () => {
    const test = dependencies(context([]));
    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("completed");
    expect(result.response?.type).toBe("message");
    expect(test.sandbox.profileCalls).toBe(0);
    expect(test.sandbox.executeCalls).toBe(0);
    expect(test.capacity.activeCount).toBe(0);
  });

  it("returns a bounded visual answer without materializing a dashboard", async () => {
    const input = context();
    input.prompt = "Visualize the supplied data";
    const test = dependencies(input);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-visual-answer",
    });

    expect(result.run.status).toBe("completed");
    expect(result.response).toMatchObject({
      type: "answer_with_visual",
      visual_artifacts: [{ kind: "chart" }],
    });
    expect(result.run.result?.dashboard_id).toBeUndefined();
  });

  it("profiles, analyzes, persists, releases capacity, and replays terminal output", async () => {
    const test = dependencies(context());
    const workflow = new BoundedMorpheusWorkflow(test.value);
    const first = await workflow.execute("run-1", { workflow_execution_id: "wdk-1" });
    const eventCount = test.store.getEvents("run-1").length;
    const second = await workflow.execute("run-1", { workflow_execution_id: "wdk-1" });

    expect(first.run.status).toBe("completed");
    expect(first.response?.type).toBe("dashboard_config");
    expect(second.response).toEqual(first.response);
    expect(test.sandbox.profileCalls).toBe(1);
    expect(test.sandbox.executeCalls).toBe(1);
    expect(test.store.getEvents("run-1")).toHaveLength(eventCount);
    expect(new Set(test.store.getEvents("run-1").map((event) => event.event_key)).size).toBe(eventCount);
    expect(test.store.getEvents("run-1").map((event) => event.sequence)).toEqual(
      Array.from({ length: eventCount }, (_, index) => index + 1),
    );
    expect(first.response).toMatchObject({
      type: "dashboard_config",
      analysis_steps: [
        {
          title: "Profile data",
          explanation: "Validated rows, columns, types, and resource limits.",
        },
      ],
    });
    expect(test.capacity.activeCount).toBe(0);
  });

  it("keeps durable event phases ordered through the bounded data pipeline", async () => {
    const test = dependencies(context());
    await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-event-order",
    });

    const phases = test.store.getEvents("run-1").map((event) => event.phase);
    for (const [before, after] of [
      ["context", "profiling"],
      ["profiling", "routing"],
      ["routing", "analysis"],
      ["analysis", "synthesis"],
      ["synthesis", "final"],
    ] as const) {
      expect(phases.indexOf(before)).toBeLessThan(phases.indexOf(after));
    }
    expect(test.store.getEvents("run-1").every((event) => !/[\r\n]/.test(event.title))).toBe(
      true,
    );
  });

  it("ends ambiguous multi-file requests as awaiting input without Sandbox use", async () => {
    const input = context([asset("sales"), asset("costs")]);
    input.prompt = "Please analyze my data";
    const test = dependencies(input);
    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("awaiting_user_input");
    expect(result.response).toMatchObject({ type: "clarification_request", reason_code: "asset" });
    expect(test.sandbox.profileCalls).toBe(0);
    expect(test.capacity.activeCount).toBe(0);
  });

  it.each(["source", "join", "time", "output", "scope", "edit_target"] as const)(
    "persists a typed %s clarification as an awaiting-input terminal run",
    async (reasonCode) => {
      const base = new DemoProvider();
      const provider: MorpheusProvider = {
        providerId: `test:clarification:${reasonCode}`,
        routeAndPlan: async () => ({
          response_type: "clarification_request",
          requires_data: false,
          reasoning: "A bounded clarification is required.",
          analysis_code: null,
          clarification: {
            clarification_id: `clarification-${reasonCode}`,
            reason_code: reasonCode,
            question: "Choose one option.",
            options: [{ id: "option-1", label: "Option one" }],
          },
        }),
        repairAnalysisCode: (input, call) => base.repairAnalysisCode(input, call),
        synthesize: (input, call) => base.synthesize(input, call),
        repairSynthesis: (input, call) => base.repairSynthesis(input, call),
      };
      const test = dependencies(context([]), provider);

      const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
        workflow_execution_id: `wdk-clarification-${reasonCode}`,
      });

      expect(result.run.status).toBe("awaiting_user_input");
      expect(result.response).toMatchObject({
        type: "clarification_request",
        reason_code: reasonCode,
      });
      expect(test.sandbox.profileCalls).toBe(0);
      expect(test.sandbox.executeCalls).toBe(0);
    },
  );

  it("rejects duplicate asset identities before opening Sandbox or calling a provider", async () => {
    const duplicate = asset("duplicate");
    let providerCalls = 0;
    const base = new DemoProvider();
    const provider: MorpheusProvider = {
      providerId: "test:duplicate-assets",
      routeAndPlan: async (input, call) => {
        providerCalls += 1;
        return base.routeAndPlan(input, call);
      },
      repairAnalysisCode: (input, call) => base.repairAnalysisCode(input, call),
      synthesize: (input, call) => base.synthesize(input, call),
      repairSynthesis: (input, call) => base.repairSynthesis(input, call),
    };
    const test = dependencies(context([duplicate, { ...duplicate }]), provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-duplicate-assets",
    });

    expect(result.run.status).toBe("failed");
    expect(result.run.error).toMatchObject({ code: "DUPLICATE_ASSET", retryable: false });
    expect(providerCalls).toBe(0);
    expect(test.sandbox.profileCalls).toBe(0);
  });

  it("passes the selected theme and focus through routing and deterministic synthesis", async () => {
    const input = context();
    input.theme_id = "cobalt";
    input.focus_id = "finance_overview";
    const base = new DemoProvider();
    let routedContext: RunContext | null = null;
    const provider: MorpheusProvider = {
      providerId: "test:theme-focus",
      routeAndPlan: (routeInput, call) => {
        routedContext = routeInput.context;
        return base.routeAndPlan(routeInput, call);
      },
      repairAnalysisCode: (repairInput, call) => base.repairAnalysisCode(repairInput, call),
      synthesize: (synthesisInput, call) => base.synthesize(synthesisInput, call),
      repairSynthesis: (repairInput, call) => base.repairSynthesis(repairInput, call),
    };
    const test = dependencies(input, provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-theme-focus",
    });

    expect(routedContext).toMatchObject({
      theme_id: "cobalt",
      focus_id: "finance_overview",
    });
    expect(result.response).toMatchObject({
      type: "dashboard_config",
      dashboard: { theme_id: "cobalt" },
    });
  });

  it("allows exactly one model-guided code repair", async () => {
    const provider = new DemoProvider();
    const test = dependencies(context(), provider);
    const failed: SandboxAnalysisResult = {
      schema_version: "1",
      run_id: "run-1",
      ok: false,
      result: null,
      error: { code: "CODE_ERROR", message: "bad column", retryable: false },
      stdout: "",
      stderr: "bad column",
    };
    test.sandbox.executionOutcomes.push(failed);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("completed");
    expect(test.sandbox.executeCalls).toBe(2);
    expect(test.sandbox.executedCode).toHaveLength(2);
  });

  it("caps the worst-case logical provider path at five calls", async () => {
    const base = new DemoProvider();
    let providerCalls = 0;
    let routeCalls = 0;
    const provider: MorpheusProvider = {
      providerId: "test:max-five",
      routeAndPlan: async (input, call) => {
        providerCalls += 1;
        routeCalls += 1;
        if (routeCalls === 1) {
          throw new WorkflowFault({
            code: "MODEL_RATE_LIMIT",
            message: "retry once",
            retryable: true,
            failedStep: "routing",
          });
        }
        return base.routeAndPlan(input, call);
      },
      repairAnalysisCode: async (input, call) => {
        providerCalls += 1;
        return base.repairAnalysisCode(input, call);
      },
      synthesize: async () => {
        providerCalls += 1;
        return { type: "dashboard_config", dashboard: { invalid: true } };
      },
      repairSynthesis: async (input, call) => {
        providerCalls += 1;
        return base.repairSynthesis(input, call);
      },
    };
    const test = dependencies(context(), provider);
    test.sandbox.executionOutcomes.push({
      schema_version: "1",
      run_id: "run-1",
      ok: false,
      result: null,
      error: { code: "CODE_ERROR", message: "repair me", retryable: false },
      stdout: "",
      stderr: "repair me",
    });

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("completed");
    expect(providerCalls).toBe(5);
  });

  it("repairs invalid structured synthesis once", async () => {
    const base = new DemoProvider();
    let repairCalls = 0;
    const provider: MorpheusProvider = {
      providerId: "test:invalid-first",
      routeAndPlan: (input, call) => base.routeAndPlan(input, call),
      repairAnalysisCode: (input, call) => base.repairAnalysisCode(input, call),
      synthesize: async () => ({ type: "dashboard_config", dashboard: { bad: true } }),
      repairSynthesis: async (input, call) => {
        repairCalls += 1;
        return base.repairSynthesis(input, call);
      },
    };
    const test = dependencies(context(), provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("completed");
    expect(repairCalls).toBe(1);
  });

  it("repairs a structurally valid dashboard whose components overlap", async () => {
    const base = new DemoProvider();
    let repairCalls = 0;
    const overlapping = editableDashboard();
    overlapping.components[1]!.position = { x: 0, y: 0, width: 6, height: 2 };
    const provider: MorpheusProvider = {
      providerId: "test:overlap-repair",
      routeAndPlan: (input, call) => base.routeAndPlan(input, call),
      repairAnalysisCode: (input, call) => base.repairAnalysisCode(input, call),
      synthesize: async () => ({
        type: "dashboard_config",
        content: "Generated an overlapping dashboard.",
        dashboard: overlapping,
        analysis_steps: [],
      }),
      repairSynthesis: async (input, call) => {
        repairCalls += 1;
        return base.repairSynthesis(input, call);
      },
    };
    const test = dependencies(context(), provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-overlap-repair",
    });

    expect(result.run.status).toBe("completed");
    expect(repairCalls).toBe(1);
    expect(result.response).toMatchObject({ type: "dashboard_config" });
  });

  it("preserves the original dashboard when an edit remains invalid after repair", async () => {
    const base = new DemoProvider();
    const input = context();
    input.prompt = "Edit this chart";
    input.existing_dashboard = editableDashboard();
    input.edit_target = {
      dashboard_id: "database-dashboard-a",
      component_ids: ["component-target", "chart-target"],
    };
    const provider: MorpheusProvider = {
      providerId: "test:invalid-edit",
      routeAndPlan: (routeInput, call) => base.routeAndPlan(routeInput, call),
      repairAnalysisCode: (repairInput, call) => base.repairAnalysisCode(repairInput, call),
      synthesize: async () => ({ type: "chart_modification", dashboard: { bad: true } }),
      repairSynthesis: async () => ({ type: "chart_modification", dashboard: { still_bad: true } }),
    };
    const test = dependencies(input, provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("completed");
    expect(result.response).toMatchObject({
      type: "chart_modification",
      dashboard: { id: "dashboard-original" },
    });
  });

  it("accepts only an identity-preserving edit of the explicitly targeted component", async () => {
    const base = new DemoProvider();
    const input = context();
    input.prompt = "Edit the revenue chart";
    input.existing_dashboard = editableDashboard();
    input.edit_target = {
      dashboard_id: "database-dashboard-a",
      component_ids: ["component-target", "chart-target"],
    };
    const edited = editableDashboard();
    const target = edited.components[0];
    if (target?.type === "chart") {
      target.component_config = {
        ...target.component_config,
        type: "line",
        datasets: [{ label: "Revenue", data: [{ label: "A", value: 2 }] }],
      };
    }
    let seenTarget: unknown;
    const provider: MorpheusProvider = {
      providerId: "test:targeted-edit",
      routeAndPlan: async (routeInput) => {
        seenTarget = routeInput.context.edit_target;
        return {
          response_type: "chart_modification",
          requires_data: false,
          reasoning: "The request targets an existing chart.",
          analysis_code: null,
          clarification: null,
        };
      },
      repairAnalysisCode: (repairInput, call) => base.repairAnalysisCode(repairInput, call),
      synthesize: async () => ({
        type: "chart_modification",
        content: "Updated only the selected chart.",
        dashboard: edited,
      }),
      repairSynthesis: (repairInput, call) => base.repairSynthesis(repairInput, call),
    };
    const test = dependencies(input, provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-targeted-edit",
    });

    expect(result.run.status).toBe("completed");
    expect(result.response).toMatchObject({
      type: "chart_modification",
      dashboard: { id: "dashboard-original" },
    });
    expect(seenTarget).toEqual(input.edit_target);
  });

  it("supports an in-place table edit while preserving its component identity", async () => {
    const base = new DemoProvider();
    const input = context([]);
    input.prompt = "Edit the selected table";
    input.existing_dashboard = {
      id: "dashboard-table",
      title: "Table dashboard",
      theme_id: "default",
      layout: { type: "grid", grid_columns: 24 },
      components: [
        {
          id: "component-table",
          type: "table",
          position: { x: 0, y: 0, width: 12, height: 8 },
          component_config: {
            id: "table-products",
            title: "Top products",
            columns: [{ key: "name", label: "Product", type: "string" }],
            data: [{ name: "A" }],
          },
        },
      ],
    };
    input.edit_target = {
      dashboard_id: "database-dashboard-table",
      component_ids: ["component-table", "table-products"],
    };
    const edited = structuredClone(input.existing_dashboard);
    const table = edited.components[0];
    if (table?.type === "table") table.component_config.data.push({ name: "B" });
    const provider: MorpheusProvider = {
      providerId: "test:table-edit",
      routeAndPlan: async () => ({
        response_type: "chart_modification",
        requires_data: false,
        reasoning: "The table edit is bounded.",
        analysis_code: null,
        clarification: null,
      }),
      repairAnalysisCode: (repairInput, call) => base.repairAnalysisCode(repairInput, call),
      synthesize: async () => ({
        type: "chart_modification",
        content: "Expanded the selected table.",
        dashboard: edited,
      }),
      repairSynthesis: (repairInput, call) => base.repairSynthesis(repairInput, call),
    };
    const test = dependencies(input, provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-table-edit",
    });

    expect(result.run.status).toBe("completed");
    if (result.response?.type === "chart_modification") {
      expect(result.response.dashboard.components[0]).toMatchObject({
        id: "component-table",
        component_config: { id: "table-products", data: [{ name: "A" }, { name: "B" }] },
      });
    }
  });

  it("falls back to the original when a component edit changes an untargeted component", async () => {
    const base = new DemoProvider();
    const input = context();
    input.prompt = "Edit the revenue chart";
    input.existing_dashboard = editableDashboard();
    input.edit_target = {
      dashboard_id: "database-dashboard-a",
      component_ids: ["component-target", "chart-target"],
    };
    const invalid = editableDashboard();
    const stable = invalid.components[1];
    if (stable?.type === "metric") stable.component_config.value = 999;
    const provider: MorpheusProvider = {
      providerId: "test:cross-component-edit",
      routeAndPlan: async () => ({
        response_type: "chart_modification",
        requires_data: false,
        reasoning: "The request targets an existing chart.",
        analysis_code: null,
        clarification: null,
      }),
      repairAnalysisCode: (repairInput, call) => base.repairAnalysisCode(repairInput, call),
      synthesize: async () => ({
        type: "chart_modification",
        content: "Changed too much.",
        dashboard: invalid,
      }),
      repairSynthesis: async () => ({
        type: "chart_modification",
        content: "Still changed too much.",
        dashboard: invalid,
      }),
    };
    const test = dependencies(input, provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-cross-component-edit",
    });

    expect(result.run.status).toBe("completed");
    expect(result.response).toMatchObject({
      type: "chart_modification",
      dashboard: { components: [{ id: "component-target" }, { id: "component-stable" }] },
    });
    if (result.response?.type === "chart_modification") {
      expect(result.response.dashboard.components[1]?.component_config).toMatchObject({ value: 10 });
    }
  });

  it("retries transient provider errors with bounded backoff", async () => {
    const base = new DemoProvider();
    let routeCalls = 0;
    const provider: MorpheusProvider = {
      providerId: "test:retry",
      routeAndPlan: async (input, call) => {
        routeCalls += 1;
        if (routeCalls < 2) {
          throw new WorkflowFault({
            code: "MODEL_RATE_LIMIT",
            message: "retry later",
            retryable: true,
            failedStep: "routing",
          });
        }
        return base.routeAndPlan(input, call);
      },
      repairAnalysisCode: (input, call) => base.repairAnalysisCode(input, call),
      synthesize: (input, call) => base.synthesize(input, call),
      repairSynthesis: (input, call) => base.repairSynthesis(input, call),
    };
    const test = dependencies(context([]), provider);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("completed");
    expect(routeCalls).toBe(2);
    expect(test.clock.sleeps).toEqual([2_000]);
  });

  it("times out provider attempts at ninety seconds", async () => {
    vi.useFakeTimers();
    try {
      const base = new DemoProvider();
      let routeCalls = 0;
      const provider: MorpheusProvider = {
        providerId: "test:timeout",
        routeAndPlan: async (_input, call) => {
          routeCalls += 1;
          return new Promise((_resolve, reject) => {
            call.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
        },
        repairAnalysisCode: (input, call) => base.repairAnalysisCode(input, call),
        synthesize: (input, call) => base.synthesize(input, call),
        repairSynthesis: (input, call) => base.repairSynthesis(input, call),
      };
      const test = dependencies(context([]), provider);
      const pending = new BoundedMorpheusWorkflow(test.value).execute("run-1", {
        workflow_execution_id: "wdk-1",
      });

      await vi.advanceTimersByTimeAsync(90_000);
      await vi.advanceTimersByTimeAsync(90_000);
      const result = await pending;

      expect(result.run.status).toBe("failed");
      expect(result.run.error).toMatchObject({ code: "PROVIDER_TIMEOUT", retryable: true });
      expect(routeCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels safely between durable steps", async () => {
    const base = new DemoProvider();
    const input = context();
    const test = dependencies(input);
    const provider: MorpheusProvider = {
      providerId: "test:cancel",
      routeAndPlan: async (routeInput, call) => {
        await test.store.requestCancellation("run-1", "user");
        return base.routeAndPlan(routeInput, call);
      },
      repairAnalysisCode: (repairInput, call) => base.repairAnalysisCode(repairInput, call),
      synthesize: (synthesisInput, call) => base.synthesize(synthesisInput, call),
      repairSynthesis: (repairInput, call) => base.repairSynthesis(repairInput, call),
    };
    test.value.provider = provider;

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("cancelled");
    expect(result.response).toBeNull();
    expect(test.sandbox.cancelCalls).toBe(1);
    expect(test.capacity.activeCount).toBe(0);
  });

  it("prevents a superseded run from committing", async () => {
    const base = new DemoProvider();
    const input = context();
    const test = dependencies(input);
    const provider: MorpheusProvider = {
      providerId: "test:supersede",
      routeAndPlan: (routeInput, call) => base.routeAndPlan(routeInput, call),
      repairAnalysisCode: (repairInput, call) => base.repairAnalysisCode(repairInput, call),
      synthesize: async (synthesisInput, call) => {
        const response = await base.synthesize(synthesisInput, call);
        test.store.setActiveRun("conversation-1", "run-newer");
        return response;
      },
      repairSynthesis: (repairInput, call) => base.repairSynthesis(repairInput, call),
    };
    test.value.provider = provider;

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("cancelled");
    expect(result.run.result).toBeNull();
  });

  it("ignores a duplicate Workflow execution with a different execution id", async () => {
    const test = dependencies(context([]));
    await test.store.claimRun("run-1", "wdk-owner", {
      run_id: "run-1",
      event_key: "claim:completed",
      phase: "queued",
      status: "completed",
      title: "claimed",
      summary: null,
      detail: null,
      started_at: test.clock.now().toISOString(),
      completed_at: null,
      duration_ms: null,
      metadata: {},
    });

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-duplicate",
    });

    expect(result.ignored).toBe(true);
    expect(result.run.workflow_run_id).toBe("wdk-owner");
  });

  it("durably waits at most ten minutes for Sandbox capacity", async () => {
    const test = dependencies(context());
    test.value.capacity = new MemorySandboxCapacity(0, test.clock);

    const result = await new BoundedMorpheusWorkflow(test.value).execute("run-1", {
      workflow_execution_id: "wdk-1",
    });

    expect(result.run.status).toBe("failed");
    expect(result.run.error).toMatchObject({ code: "CAPACITY_BUSY", retryable: true });
    expect(test.clock.sleeps.reduce((sum, value) => sum + value, 0)).toBe(10 * 60_000);
    expect(test.sandbox.profileCalls).toBe(0);
  });
});

describe("run state machine", () => {
  it("rejects terminal-state regression", () => {
    expect(() => assertRunTransition("completed", "running")).toThrow(
      "invalid workflow transition: completed -> running",
    );
  });
});

describe("BYOK provider boundary", () => {
  it("passes only structured input and the stable idempotency key to the model client", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const provider = new ByokProviderAdapter({
      provider: "example",
      model: "model-1",
      generateStructured: async (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return { ok: true };
      },
    });

    await provider.routeAndPlan(
      { context: context([]), profile: null },
      { idempotency_key: "run-1:route" },
    );

    expect(provider.providerId).toBe("example:model-1");
    expect(calls[0]).toMatchObject({ purpose: "route", idempotencyKey: "run-1:route" });
  });

  it("normalizes provider failures as retryable workflow faults", async () => {
    const provider = new ByokProviderAdapter({
      provider: "example",
      model: "model-1",
      generateStructured: async () => {
        throw new Error("provider unavailable");
      },
    });

    await expect(
      provider.routeAndPlan(
        { context: context([]), profile: null },
        { idempotency_key: "run-1:route" },
      ),
    ).rejects.toMatchObject({ code: "MODEL_PROVIDER_ERROR", retryable: true });
  });
});
