import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DashboardConfigurationSchema,
  RESOURCE_LIMITS,
  RunRecordSchema,
  SandboxProfileRequestSchema,
  ThinkingEventSchema,
} from "../src/index.js";

const timestamp = "2026-08-03T08:00:00.000Z";

describe("run contracts", () => {
  it("accepts a durable queued run", () => {
    const parsed = RunRecordSchema.parse({
      run_id: "run-1",
      conversation_id: "conversation-1",
      project_id: "project-1",
      owner_id: "owner-1",
      status: "queued",
      current_step: "accepted",
      cancel_requested: false,
      version: 0,
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(parsed.parent_run_id).toBeNull();
    expect(parsed.result).toBeNull();
  });

  it("rejects unknown run states", () => {
    expect(() =>
      RunRecordSchema.parse({
        run_id: "run-1",
        conversation_id: "conversation-1",
        project_id: "project-1",
        owner_id: "owner-1",
        status: "processing_forever",
        current_step: "analysis",
        cancel_requested: false,
        version: 0,
        created_at: timestamp,
        updated_at: timestamp,
      }),
    ).toThrow();
  });
});

describe("resource contracts", () => {
  it("locks the Hobby demo hard limits", () => {
    expect(RESOURCE_LIMITS).toMatchObject({
      maxAssets: 3,
      maxFileBytes: 10 * 1024 * 1024,
      maxAggregateFileBytes: 25 * 1024 * 1024,
      maxRowsPerFile: 100_000,
      maxColumnsPerFile: 200,
      maxDashboardBytes: 1024 * 1024,
      maxDatabaseBytes: 350 * 1024 * 1024,
      maxEventBytes: 32 * 1024,
      maxProviderCalls: 5,
      providerAttemptTimeoutMs: 90_000,
      sandboxCommandTimeoutMs: 120_000,
      workflowDeadlineMs: 20 * 60_000,
      sandboxLifetimeMs: 25 * 60_000,
    });
    expect(RESOURCE_LIMITS.workflowStepTimeoutMs).toBeLessThan(240_000);
  });

  it("keeps the language-neutral resource manifest in sync", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../schemas/resource-limits.json", import.meta.url), "utf8"),
    ) as Record<string, number | string>;

    expect(manifest).toMatchObject({
      max_assets: RESOURCE_LIMITS.maxAssets,
      max_file_bytes: RESOURCE_LIMITS.maxFileBytes,
      max_aggregate_file_bytes: RESOURCE_LIMITS.maxAggregateFileBytes,
      max_rows_per_file: RESOURCE_LIMITS.maxRowsPerFile,
      max_columns_per_file: RESOURCE_LIMITS.maxColumnsPerFile,
      max_dashboard_bytes: RESOURCE_LIMITS.maxDashboardBytes,
      max_database_bytes: RESOURCE_LIMITS.maxDatabaseBytes,
      max_event_bytes: RESOURCE_LIMITS.maxEventBytes,
      max_sandbox_commands: RESOURCE_LIMITS.maxSandboxCommands,
      max_provider_calls: RESOURCE_LIMITS.maxProviderCalls,
      provider_attempt_timeout_ms: RESOURCE_LIMITS.providerAttemptTimeoutMs,
      sandbox_command_timeout_ms: RESOURCE_LIMITS.sandboxCommandTimeoutMs,
      workflow_step_timeout_ms: RESOURCE_LIMITS.workflowStepTimeoutMs,
      workflow_deadline_ms: RESOURCE_LIMITS.workflowDeadlineMs,
      sandbox_lifetime_ms: RESOURCE_LIMITS.sandboxLifetimeMs,
    });
  });

  it("rejects an oversized aggregate upload", () => {
    const asset = (index: number) => ({
      asset_id: `asset-${index}`,
      object_id: `object-${index}`,
      file_name: `data-${index}.csv`,
      format: "csv" as const,
      media_type: "text/csv",
      size_bytes: RESOURCE_LIMITS.maxFileBytes,
      sha256: "a".repeat(64),
      relative_path: `input/data-${index}.csv`,
    });

    expect(() =>
      SandboxProfileRequestSchema.parse({
        schema_version: "1",
        run_id: "run-1",
        assets: [asset(1), asset(2), asset(3)],
      }),
    ).toThrow(/aggregate asset size exceeded/);
  });

  it("enforces the serialized event ceiling", () => {
    expect(() =>
      ThinkingEventSchema.parse({
        id: "run-1:1",
        run_id: "run-1",
        sequence: 1,
        event_key: "profiling:active",
        phase: "profiling",
        status: "active",
        title: "Profiling data",
        summary: null,
        detail: null,
        started_at: timestamp,
        completed_at: null,
        duration_ms: null,
        metadata: { payload: "x".repeat(RESOURCE_LIMITS.maxEventBytes) },
      }),
    ).toThrow(/event exceeds/);
  });
});

describe("dashboard contracts", () => {
  const metric = (index: number) => ({
    id: `metric-${index}`,
    type: "metric" as const,
    position: { x: 0, y: index, width: 6, height: 2 },
    component_config: {
      id: `metric-config-${index}`,
      title: `Metric ${index}`,
      value: index,
    },
  });

  it("rejects duplicate component IDs", () => {
    const duplicate = metric(1);
    expect(() =>
      DashboardConfigurationSchema.parse({
        id: "dashboard-1",
        title: "Dashboard",
        theme_id: "default",
        layout: { type: "grid", grid_columns: 24 },
        components: [duplicate, duplicate],
      }),
    ).toThrow(/duplicate component id/);
  });

  it("rejects more than the bounded metric count", () => {
    expect(() =>
      DashboardConfigurationSchema.parse({
        id: "dashboard-1",
        title: "Dashboard",
        theme_id: "default",
        layout: { type: "grid", grid_columns: 24 },
        components: Array.from({ length: RESOURCE_LIMITS.maxMetrics + 1 }, (_, index) => metric(index)),
      }),
    ).toThrow(/too many metric components/);
  });
});
