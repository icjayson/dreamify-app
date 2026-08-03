import type {
  NewThinkingEvent,
  RunError,
  RunRecord,
  RunResultReference,
  RunStatus,
  SandboxAnalysisResult,
  SandboxProfileResult,
  WorkflowResponse,
  WorkflowStep,
} from "@dreamify/contracts";

import type {
  ArtifactReference,
  ProviderCallContext,
  RepairCodeInput,
  RepairSynthesisInput,
  RouteInput,
  RoutePlan,
  RunContext,
  SandboxLease,
  SynthesisInput,
} from "./types.js";

export type ClaimOutcome = "claimed" | "resume" | "busy" | "terminal";

export interface RunTransition {
  allowed_from: readonly RunStatus[];
  status: RunStatus;
  current_step: WorkflowStep;
  response_type?: RunRecord["response_type"];
  error?: RunError | null;
  event: NewThinkingEvent;
}

export interface StepResult<T> {
  found: boolean;
  value: T | null;
}

export interface ProviderCallReservation {
  ordinal: number;
  created: boolean;
}

export interface WorkflowStore {
  getContext(runId: string): Promise<RunContext>;
  getRun(runId: string): Promise<RunRecord>;
  claimRun(runId: string, workflowExecutionId: string, event: NewThinkingEvent): Promise<ClaimOutcome>;
  reserveProviderCall(runId: string, callKey: string): Promise<ProviderCallReservation>;
  beginStep(runId: string, stepKey: string, step: WorkflowStep, event: NewThinkingEvent): Promise<void>;
  getStepResult<T>(runId: string, stepKey: string): Promise<StepResult<T>>;
  completeStep<T>(runId: string, stepKey: string, result: T, event: NewThinkingEvent): Promise<void>;
  transition(runId: string, transition: RunTransition): Promise<RunRecord>;
  commitResponse(
    runId: string,
    terminalStatus: "completed" | "awaiting_user_input",
    response: WorkflowResponse,
    responseArtifact: ArtifactReference,
    resultReference: RunResultReference,
    event: NewThinkingEvent,
  ): Promise<RunRecord>;
  getResponse(runId: string): Promise<WorkflowResponse | null>;
  requestCancellation(runId: string, reason: "user" | "superseded"): Promise<RunRecord>;
}

export interface ArtifactStore {
  putJson(
    runId: string,
    kind: ArtifactReference["kind"],
    value: unknown,
    idempotencyKey: string,
    maxBytes: number,
  ): Promise<ArtifactReference>;
  getJson<T>(runId: string, reference: ArtifactReference): Promise<T>;
}

export interface SandboxCapacity {
  acquire(runId: string, idempotencyKey: string): Promise<SandboxLease>;
  release(lease: SandboxLease, idempotencyKey: string): Promise<void>;
}

export interface SandboxAdapter {
  profile(context: RunContext, call: ProviderCallContext): Promise<SandboxProfileResult>;
  execute(context: RunContext, code: string, call: ProviderCallContext): Promise<SandboxAnalysisResult>;
  cancel(runId: string): Promise<void>;
  /** Stop compute while retaining the named persistent workspace for the next durable slice. */
  suspend(runId: string): Promise<void>;
  cleanup?(runId: string): Promise<void>;
}

export interface MorpheusProvider {
  readonly providerId: string;
  routeAndPlan(input: RouteInput, call: ProviderCallContext): Promise<unknown>;
  repairAnalysisCode(input: RepairCodeInput, call: ProviderCallContext): Promise<unknown>;
  synthesize(input: SynthesisInput, call: ProviderCallContext): Promise<unknown>;
  repairSynthesis(input: RepairSynthesisInput, call: ProviderCallContext): Promise<unknown>;
}

export interface WorkflowClock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export interface WorkflowDependencies {
  store: WorkflowStore;
  artifacts: ArtifactStore;
  capacity: SandboxCapacity;
  sandbox: SandboxAdapter;
  provider: MorpheusProvider;
  clock: WorkflowClock;
}
