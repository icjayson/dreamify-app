import {
  ApiArtifactStore,
  ApiSandboxCapacity,
  ApiWorkflowStore,
  BoundedMorpheusWorkflow,
  InternalApiClient,
  RESOURCE_LIMITS,
  SystemWorkflowClock,
  VercelSandboxAdapter,
  WorkflowFault,
  createResolvingMorpheusProvider,
} from "@dreamify/workflow";

export interface WorkflowSliceSummary {
  run_id: string;
  status:
    | "queued"
    | "running"
    | "awaiting_user_input"
    | "completed"
    | "failed"
    | "cancelling"
    | "cancelled";
  ignored: boolean;
  paused: boolean;
  retry_after_ms: number;
}

/**
 * Runs inside a Workflow step. Environment secrets are closed over here and
 * never become workflow arguments, step results, artifacts, or Sandbox env.
 */
export async function executeBoundedMorpheusSlice(
  runId: string,
  workflowExecutionId: string,
): Promise<WorkflowSliceSummary> {
  const controller = new AbortController();
  const operationBudgetMs = RESOURCE_LIMITS.workflowStepTimeoutMs - 10_000;
  const timer = setTimeout(
    () =>
      controller.abort(
        new WorkflowFault({
          code: "WORKFLOW_STEP_TIMEOUT",
          message: "Durable workflow step exceeded its bounded execution window",
          retryable: true,
        }),
      ),
    operationBudgetMs,
  );
  try {
    const internalApi = InternalApiClient.fromEnvironment(undefined, controller.signal);
    const sandbox = VercelSandboxAdapter.fromEnvironment(internalApi);
    const provider = createResolvingMorpheusProvider(() => internalApi.resolveProvider(runId));
    const engine = new BoundedMorpheusWorkflow({
      store: new ApiWorkflowStore(internalApi),
      artifacts: new ApiArtifactStore(internalApi),
      capacity: new ApiSandboxCapacity(internalApi),
      sandbox,
      provider,
      clock: new SystemWorkflowClock(),
    });
    const result = await engine.execute(runId, {
      workflow_execution_id: workflowExecutionId,
      max_completed_steps: 1,
      yield_on_capacity_wait: true,
      signal: controller.signal,
    });
    return {
      run_id: result.run.run_id,
      status: result.run.status,
      ignored: result.ignored,
      paused: result.paused ?? false,
      retry_after_ms: result.retry_after_ms ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
