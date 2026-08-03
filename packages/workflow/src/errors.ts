import type { RunError, WorkflowStep } from "@dreamify/contracts";

export class WorkflowFault extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly failedStep: WorkflowStep | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(options: {
    code: string;
    message: string;
    retryable: boolean;
    failedStep?: WorkflowStep;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = "WorkflowFault";
    this.code = options.code;
    this.retryable = options.retryable;
    this.failedStep = options.failedStep;
    this.retryAfterMs = options.retryAfterMs;
  }

  toRunError(): RunError {
    return {
      code: this.code,
      message: this.message.slice(0, 1_000),
      retryable: this.retryable,
      ...(this.failedStep ? { failed_step: this.failedStep } : {}),
    };
  }
}

export class CancellationFault extends WorkflowFault {
  constructor(message = "Workflow cancellation requested") {
    super({ code: "CANCELLED", message, retryable: false });
    this.name = "CancellationFault";
  }
}

export class SupersededFault extends CancellationFault {
  constructor() {
    super("Workflow superseded by a newer run");
    this.name = "SupersededFault";
  }
}

export function normalizeWorkflowFault(error: unknown, failedStep?: WorkflowStep): WorkflowFault {
  if (error instanceof WorkflowFault) {
    return error;
  }
  return new WorkflowFault({
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unexpected workflow failure",
    retryable: false,
    ...(failedStep ? { failedStep } : {}),
  });
}
