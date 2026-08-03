import { getWorkflowMetadata, sleep } from "workflow";

import { executeBoundedMorpheusSlice } from "@/server/workflow-runtime";

const MAX_DURABLE_SLICES = 64;

export async function dreamifyMorpheusWorkflow(runId: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  for (let slice = 0; slice < MAX_DURABLE_SLICES; slice += 1) {
    const result = await executeMorpheusStep(runId, workflowRunId);
    if (!result.paused) {
      if (result.status === "failed") {
        throw new Error(`Dreamify run ${runId} failed`);
      }
      return result;
    }
    if (result.retry_after_ms > 0) {
      await sleep(result.retry_after_ms);
    }
  }
  throw new Error(`Dreamify run ${runId} exceeded its durable slice budget`);
}

export async function executeMorpheusStep(runId: string, workflowExecutionId: string) {
  "use step";

  return executeBoundedMorpheusSlice(runId, workflowExecutionId);
}

executeMorpheusStep.maxRetries = 2;
