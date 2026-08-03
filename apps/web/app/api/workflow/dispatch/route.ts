import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { InternalApiClient } from "@dreamify/workflow";

import {
  authorizeWorkflowDispatch,
  dispatchWithDurableLease,
  parseWorkflowDispatch,
} from "@/server/workflow-dispatch";
import { dreamifyMorpheusWorkflow } from "@/../workflows/morpheus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!authorizeWorkflowDispatch(request.headers)) {
    return NextResponse.json(
      { error: { code: "SERVICE_AUTH_INVALID", message: "Internal service authentication failed" } },
      { status: 401 },
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4_096) {
    return NextResponse.json(
      { error: { code: "PAYLOAD_TOO_LARGE", message: "Dispatch payload is too large" } },
      { status: 413 },
    );
  }

  try {
    const payload = parseWorkflowDispatch(await request.json(), request.headers);
    const coordinator = InternalApiClient.fromEnvironment(
      undefined,
      undefined,
      request.headers.get("x-request-id") ?? undefined,
    );
    const dispatched = await dispatchWithDurableLease(payload, coordinator, async (runId) => {
      const run = await start(dreamifyMorpheusWorkflow, [runId]);
      return { runId: run.runId };
    });
    if (dispatched.outcome === "invalid") {
      return NextResponse.json(
        { error: { code: "DISPATCH_LEASE_INVALID", message: "Dispatch lease is invalid" } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        workflow_run_id: dispatched.workflowRunId ?? null,
        status: dispatched.outcome,
      },
      { status: dispatched.outcome === "recorded" ? 200 : 202 },
    );
  } catch (error) {
    const invalid = error instanceof z.ZodError ||
      (error instanceof Error && error.message.startsWith("Idempotency-Key"));
    return NextResponse.json(
      {
        error: {
          code: invalid ? "INVALID_DISPATCH" : "WORKFLOW_DISPATCH_FAILED",
          message: invalid ? "Dispatch payload is invalid" : "Workflow could not be dispatched",
        },
      },
      { status: invalid ? 400 : 503 },
    );
  }
}
