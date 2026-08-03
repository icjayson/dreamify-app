import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { DispatchState } from "@dreamify/workflow";

export const WorkflowDispatchSchema = z
  .object({
    run_id: z.string().min(1).max(128),
    conversation_id: z.string().min(1).max(128),
    project_id: z.string().min(1).max(128),
    client_request_id: z.string().min(8).max(128),
    dispatch_lease_id: z.string().min(1).max(128),
  })
  .strict();

export type WorkflowDispatch = z.infer<typeof WorkflowDispatchSchema>;

export interface StartedWorkflow {
  runId: string;
}

export type WorkflowStarter = (runId: string) => Promise<StartedWorkflow>;

export interface DurableDispatchCoordinator {
  authorizeDispatch(runId: string, dispatchLeaseId: string): Promise<DispatchState>;
  recordDispatchReceipt(
    runId: string,
    dispatchLeaseId: string,
    workflowExecutionId: string,
  ): Promise<DispatchState>;
}

export interface DurableDispatchResult {
  outcome: "started" | "in_progress" | "recorded" | "invalid";
  workflowRunId?: string;
}

const instanceDispatches = new Map<string, Promise<StartedWorkflow>>();

function equalSecret(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function authorizeWorkflowDispatch(headers: Headers): boolean {
  const expected = process.env.INTERNAL_SERVICE_SHARED_SECRET;
  const supplied = headers.get("x-internal-service-secret");
  return Boolean(expected && supplied && equalSecret(expected, supplied));
}

export function parseWorkflowDispatch(value: unknown, headers: Headers): WorkflowDispatch {
  const parsed = WorkflowDispatchSchema.parse(value);
  if (headers.get("idempotency-key") !== parsed.run_id) {
    throw new Error("Idempotency-Key must equal run_id");
  }
  return parsed;
}

export async function dispatchWorkflowOnce(
  request: WorkflowDispatch,
  starter: WorkflowStarter,
): Promise<{ workflow: StartedWorkflow; duplicate: boolean }> {
  const existing = instanceDispatches.get(request.run_id);
  if (existing) return { workflow: await existing, duplicate: true };

  const pending = starter(request.run_id);
  instanceDispatches.set(request.run_id, pending);
  try {
    const workflow = await pending;
    if (instanceDispatches.size > 1_000) {
      const oldest = instanceDispatches.keys().next().value as string | undefined;
      if (oldest && oldest !== request.run_id) instanceDispatches.delete(oldest);
    }
    return { workflow, duplicate: false };
  } catch (error) {
    instanceDispatches.delete(request.run_id);
    throw error;
  }
}

export async function dispatchWithDurableLease(
  request: WorkflowDispatch,
  coordinator: DurableDispatchCoordinator,
  starter: WorkflowStarter,
): Promise<DurableDispatchResult> {
  const authorization = await coordinator.authorizeDispatch(
    request.run_id,
    request.dispatch_lease_id,
  );
  if (authorization.outcome === "invalid") return { outcome: "invalid" };
  if (authorization.outcome === "in_progress") return { outcome: "in_progress" };
  if (authorization.outcome === "recorded" || authorization.outcome === "conflict") {
    return authorization.workflow_execution_id
      ? { outcome: "recorded", workflowRunId: authorization.workflow_execution_id }
      : { outcome: "invalid" };
  }

  const started = await starter(request.run_id);
  const receipt = await coordinator.recordDispatchReceipt(
    request.run_id,
    request.dispatch_lease_id,
    started.runId,
  );
  if (receipt.outcome === "invalid" || !receipt.workflow_execution_id) {
    return { outcome: "invalid" };
  }
  return {
    outcome: receipt.workflow_execution_id === started.runId ? "started" : "recorded",
    workflowRunId: receipt.workflow_execution_id,
  };
}

export function resetDispatchesForTest(): void {
  if (process.env.NODE_ENV === "test") instanceDispatches.clear();
}
