# `@dreamify/workflow`

This package contains the bounded, replay-safe Morpheus core and its concrete
Vercel Sandbox/internal-API adapters. The engine does not import a provider,
database, or Blob SDK. Those capabilities remain behind ports so secrets and
live clients are never serialized into durable Workflow state.

## Execution contract

`BoundedMorpheusWorkflow` performs the following bounded phases:

1. compare-and-swap claim of the queued run;
2. context and asset-manifest validation;
3. deterministic ask-first clarification for ambiguous files;
4. durable wait for one of two Sandbox leases, capped at ten minutes;
5. profile artifact creation;
6. one structured route/plan phase with at most two attempts;
7. one analysis command plus at most one code repair and rerun;
8. one synthesis call plus at most one schema-only repair;
9. active-run compare-and-swap persistence; and
10. lease cleanup.

Instantiate one `BoundedMorpheusWorkflow` per durable slice. Fixed per-phase
budgets cap the whole logical run at five model calls even though each slice
starts with fresh in-memory counters; durable run state remains in
`WorkflowStore`.

Profile, analysis, and response bodies are stored through `ArtifactStore`.
Only immutable object references, plans, lease IDs, and stable idempotency keys
belong in Workflow step results.

`MemoryWorkflowStore`, `MemoryArtifactStore`, `MemorySandboxCapacity`, and
`DemoSandboxAdapter` provide a durable in-process demo and replay test harness.
They model unique event keys, terminal-state monotonicity, step journals,
duplicate Workflow claims, cancellation, and active-run persistence guards.

## Production Vercel integration

The included adapters provide:

- `WorkflowStore`: Neon transactions for run claim, status plus event writes,
  step journaling, terminal monotonicity, and `conversation.active_run_id` CAS.
- `ArtifactStore`: immutable private Blob JSON objects with stable operation IDs.
- `SandboxCapacity`: access to the two seeded `workflow_slots` leases. Capacity
  backoff yields to the outer durable Workflow sleep.
- `VercelSandboxAdapter`: a 1-vCPU/2-GB Sandbox created from the pinned snapshot,
  service-authenticated asset resolution, hash verification, deny-all network
  policy before code execution, command timeout, and best-effort stop.
- `StructuredModelClient`: fixed-origin OpenAI Responses and Gemini Interactions
  clients with strict JSON envelopes, bounded bodies, safe error mapping, and a
  90-second provider-attempt timeout. The API resolves the run-pinned credential only inside
  the server step; it remains closed over by the adapter and never appears in
  Workflow arguments/results, status, events, artifacts, logs, Blob, or the
  Sandbox environment.

`apps/web/workflows/morpheus.ts` is the thin `"use workflow"` entry. Each
`"use step"` invocation persists at most one previously-incomplete engine step.
Provider attempts time out after 90 seconds, generated commands after 120
seconds, application steps retain a margin below 240 seconds, the application
deadline is 20 minutes, and Sandbox lifetime is 25 minutes. No additional queue
sits in front of Workflow.

The live adapter cannot be verified locally without a Vercel project, Workflow
deployment, private Blob store, `SANDBOX_SNAPSHOT_ID`, service resolver secret,
and at least one configured model provider. No live provider is required for the
deterministic default; an authenticated tenant can activate a verified OpenAI or
Gemini connection without changing Workflow code.

## Validation

```bash
npm run typecheck --workspace @dreamify/workflow
npm run test --workspace @dreamify/workflow
npm run build --workspace @dreamify/workflow
```
