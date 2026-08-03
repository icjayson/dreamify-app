import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authorizeWorkflowDispatch,
  dispatchWithDurableLease,
  dispatchWorkflowOnce,
  parseWorkflowDispatch,
  resetDispatchesForTest,
} from "./workflow-dispatch";

const body = {
  run_id: "run-12345678",
  conversation_id: "conversation-1",
  project_id: "project-1",
  client_request_id: "request-12345678",
  dispatch_lease_id: "lease-12345678",
};

afterEach(() => {
  resetDispatchesForTest();
  delete process.env.INTERNAL_SERVICE_SHARED_SECRET;
});

describe("Workflow dispatch integration", () => {
  it("keeps the Workflow and step directives in the concrete entry", () => {
    const source = readFileSync(new URL("../../workflows/morpheus.ts", import.meta.url), "utf8");
    expect(source).toMatch(/dreamifyMorpheusWorkflow[\s\S]*?"use workflow"/);
    expect(source).toMatch(/executeMorpheusStep[\s\S]*?"use step"/);
    expect(source).toContain("await sleep(result.retry_after_ms)");
  });

  it("authenticates the exact service secret and run id idempotency key", () => {
    process.env.INTERNAL_SERVICE_SHARED_SECRET = "shared-secret";
    const headers = new Headers({
      "x-internal-service-secret": "shared-secret",
      "idempotency-key": body.run_id,
    });
    expect(authorizeWorkflowDispatch(headers)).toBe(true);
    expect(parseWorkflowDispatch(body, headers)).toEqual(body);
    expect(authorizeWorkflowDispatch(new Headers({ "x-internal-service-secret": "wrong" }))).toBe(false);
  });

  it("coalesces duplicate dispatches without serializing API context or secrets", async () => {
    const starter = vi.fn(async (runId: string) => ({ runId: `wf-${runId}` }));
    const first = await dispatchWorkflowOnce(body, starter);
    const second = await dispatchWorkflowOnce(body, starter);

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ workflow: first.workflow, duplicate: true });
    expect(starter).toHaveBeenCalledOnce();
    expect(starter).toHaveBeenCalledWith(body.run_id);
  });

  it("uses durable authorization rather than process memory across isolated calls", async () => {
    let authorized = false;
    const coordinator = {
      authorizeDispatch: vi.fn(async () => {
        if (authorized) return { outcome: "in_progress" as const };
        authorized = true;
        return { outcome: "authorized" as const };
      }),
      recordDispatchReceipt: vi.fn(async (_runId: string, leaseId: string, workflowExecutionId: string) => ({
        outcome: "recorded" as const,
        dispatch_lease_id: leaseId,
        workflow_execution_id: workflowExecutionId,
      })),
    };
    const starter = vi.fn(async () => ({ runId: "workflow-first" }));

    const first = await dispatchWithDurableLease(body, coordinator, starter);
    const second = await dispatchWithDurableLease(body, coordinator, starter);

    expect(first).toEqual({ outcome: "started", workflowRunId: "workflow-first" });
    expect(second).toEqual({ outcome: "in_progress" });
    expect(starter).toHaveBeenCalledOnce();
  });

  it("keeps a workflow id already won by a concurrent claim", async () => {
    const coordinator = {
      authorizeDispatch: vi.fn(async () => ({ outcome: "authorized" as const })),
      recordDispatchReceipt: vi.fn(async (_runId: string, leaseId: string) => ({
        outcome: "conflict" as const,
        dispatch_lease_id: leaseId,
        workflow_execution_id: "workflow-existing",
      })),
    };

    const result = await dispatchWithDurableLease(
      body,
      coordinator,
      async () => ({ runId: "workflow-late" }),
    );

    expect(result).toEqual({ outcome: "recorded", workflowRunId: "workflow-existing" });
  });
});
