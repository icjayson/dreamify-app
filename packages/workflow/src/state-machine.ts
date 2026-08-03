import type { RunStatus } from "@dreamify/contracts";

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "cancelling", "cancelled", "failed"],
  running: ["running", "awaiting_user_input", "completed", "failed", "cancelling", "cancelled"],
  awaiting_user_input: [],
  completed: [],
  failed: [],
  cancelling: ["cancelling", "cancelled", "failed"],
  cancelled: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new Error(`invalid workflow transition: ${from} -> ${to}`);
  }
}
