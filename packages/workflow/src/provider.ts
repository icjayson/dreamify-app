import {
  DashboardConfigurationSchema,
  RESOURCE_LIMITS,
  type DashboardConfiguration,
} from "@dreamify/contracts";

import { WorkflowFault } from "./errors.js";
import type { MorpheusProvider } from "./ports.js";
import type {
  ProviderCallContext,
  RepairCodeInput,
  RepairSynthesisInput,
  RouteInput,
  SynthesisInput,
} from "./types.js";

export interface StructuredModelClient {
  readonly provider: string;
  readonly model: string;
  generateStructured(options: {
    purpose: "route" | "repair_code" | "synthesize" | "repair_synthesis";
    input: unknown;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export class ByokProviderAdapter implements MorpheusProvider {
  readonly providerId: string;

  constructor(private readonly client: StructuredModelClient) {
    this.providerId = `${client.provider}:${client.model}`;
  }

  routeAndPlan(input: RouteInput, call: ProviderCallContext): Promise<unknown> {
    return this.generate("route", input, call);
  }

  repairAnalysisCode(input: RepairCodeInput, call: ProviderCallContext): Promise<unknown> {
    return this.generate("repair_code", input, call);
  }

  synthesize(input: SynthesisInput, call: ProviderCallContext): Promise<unknown> {
    return this.generate("synthesize", input, call);
  }

  repairSynthesis(input: RepairSynthesisInput, call: ProviderCallContext): Promise<unknown> {
    return this.generate("repair_synthesis", input, call);
  }

  private async generate(
    purpose: "route" | "repair_code" | "synthesize" | "repair_synthesis",
    input: unknown,
    call: ProviderCallContext,
  ): Promise<unknown> {
    try {
      return await this.client.generateStructured({
        purpose,
        input,
        idempotencyKey: call.idempotency_key,
        ...(call.signal ? { signal: call.signal } : {}),
      });
    } catch (error) {
      if (error instanceof WorkflowFault) {
        throw error;
      }
      throw new WorkflowFault({
        code: "MODEL_PROVIDER_ERROR",
        message: error instanceof Error ? error.message : "Model provider failed",
        retryable: true,
        failedStep: purpose.startsWith("repair_code") ? "analysis" : "synthesis",
      });
    }
  }
}

function demoDashboard(input: SynthesisInput): DashboardConfiguration {
  const firstDataset = input.profile?.datasets[0];
  const rowCount = firstDataset?.row_count ?? 0;
  const firstColumn = firstDataset?.columns[0]?.name ?? "Rows";
  return DashboardConfigurationSchema.parse({
    id: `dashboard-${input.context.run_id}`,
    title: "Demo analytics dashboard",
    description: "Deterministic demo output. Configure a BYOK model provider for production analysis.",
    theme_id: input.context.theme_id,
    layout: { type: "grid", grid_columns: 24 },
    components: [
      {
        id: "metric-row-count",
        type: "metric",
        position: { x: 0, y: 0, width: 6, height: 2 },
        component_config: {
          id: "metric-row-count-config",
          title: "Rows analyzed",
          value: rowCount,
          trend: "stable",
        },
      },
      {
        id: "chart-demo",
        type: "chart",
        position: { x: 0, y: 2, width: 12, height: 8 },
        component_config: {
          id: "chart-demo-config",
          type: "bar",
          title: `Profile for ${firstColumn}`,
          datasets: [
            {
              label: "Rows",
              data: [{ label: firstColumn, value: rowCount }],
            },
          ],
        },
      },
    ],
  });
}

export class DemoProvider implements MorpheusProvider {
  readonly providerId = "demo:deterministic-v1";

  async routeAndPlan(input: RouteInput): Promise<unknown> {
    const prompt = input.context.prompt.toLowerCase();
    if (prompt.includes("clarify")) {
      return {
        response_type: "clarification_request",
        requires_data: false,
        reasoning: "The deterministic demo was explicitly asked to clarify.",
        analysis_code: null,
        clarification: {
          clarification_id: `clarification-${input.context.run_id}`,
          reason_code: "scope",
          question: "Which business question should this analysis answer?",
          options: [],
        },
      };
    }

    const hasData = input.context.assets.length > 0;
    const responseType = prompt.includes("visual")
      ? "answer_with_visual"
      : prompt.includes("edit") && input.context.existing_dashboard && input.context.edit_target
        ? "chart_modification"
        : hasData
          ? "dashboard_config"
          : "message";
    return {
      response_type: responseType,
      requires_data: hasData,
      reasoning: hasData ? "The request uses the supplied bounded dataset." : "No dataset is needed.",
      analysis_code: hasData
        ? "first = next(iter(datasets.values()))\nresult = {'row_count': len(first), 'columns': list(first.columns)}"
        : null,
      clarification: null,
    };
  }

  async repairAnalysisCode(_input: RepairCodeInput): Promise<unknown> {
    return "first = next(iter(datasets.values()))\nresult = {'row_count': len(first), 'columns': list(first.columns)}";
  }

  async synthesize(input: SynthesisInput): Promise<unknown> {
    switch (input.plan.response_type) {
      case "message":
        return {
          type: "message",
          content: "Demo mode is ready. Add a BYOK provider to generate a model-backed answer.",
        };
      case "answer_with_visual":
        return {
          type: "answer_with_visual",
          content: "The supplied data was profiled successfully.",
          visual_artifacts: [
            {
              id: `visual-${input.context.run_id}`,
              kind: "chart",
              title: "Rows analyzed",
              data: { value: input.profile?.datasets[0]?.row_count ?? 0 },
            },
          ],
        };
      case "chart_modification":
        return {
          type: "chart_modification",
          content: "The deterministic demo preserved the existing dashboard.",
          dashboard: input.context.existing_dashboard ?? demoDashboard(input),
          edit_note: "Demo mode does not alter production dashboard values.",
        };
      default:
        return {
          type: "dashboard_config",
          content: "The bounded analysis completed successfully.",
          dashboard: demoDashboard(input),
          analysis_steps: [
            {
              title: "Profile data",
              explanation: "Validated rows, columns, types, and resource limits.",
            },
          ],
        };
    }
  }

  async repairSynthesis(input: RepairSynthesisInput): Promise<unknown> {
    return this.synthesize(input);
  }
}

export function assertProviderPayloadSize(value: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > RESOURCE_LIMITS.maxDashboardBytes) {
    throw new WorkflowFault({
      code: "MODEL_OUTPUT_TOO_LARGE",
      message: `Model output exceeded ${RESOURCE_LIMITS.maxDashboardBytes} bytes`,
      retryable: false,
      failedStep: "synthesis",
    });
  }
}
