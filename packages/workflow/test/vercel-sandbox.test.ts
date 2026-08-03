import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { RESOURCE_LIMITS } from "@dreamify/contracts";

import { InternalApiClient } from "../src/adapters/internal-api.js";
import {
  VercelSandboxAdapter,
  type SandboxFactory,
  type SandboxInstance,
} from "../src/adapters/vercel-sandbox.js";
import type { RunContext } from "../src/types.js";

const csv = Buffer.from("category,value\nA,1\nB,2\n", "utf8");
const sha256 = createHash("sha256").update(csv).digest("hex");

const context: RunContext = {
  run_id: "run-adapter",
  conversation_id: "conversation-1",
  project_id: "project-1",
  owner_id: "owner-1",
  prompt: "Analyze this file",
  assets: [
    {
      asset_id: "asset-1",
      object_id: "object-1",
      file_name: "data.csv",
      format: "csv",
      media_type: "text/csv",
      size_bytes: csv.byteLength,
      sha256,
      relative_path: "input/asset-1.csv",
    },
  ],
  theme_id: "default",
  focus_id: null,
  existing_dashboard: null,
  edit_target: null,
  conversation_revision_object_id: "revision-1",
};

class FakeSandbox implements SandboxInstance {
  readonly events: string[] = [];
  readonly files = new Map<string, Buffer>();
  command: Parameters<SandboxInstance["runCommand"]>[0] | null = null;
  stopped = false;
  deleted = false;

  readonly fs = {
    mkdir: async (_directory: string) => undefined,
    writeFile: async (file: string, data: string | Buffer | Uint8Array) => {
      this.events.push(file.endsWith(".csv") ? "asset-written" : "request-written");
      this.files.set(file, Buffer.from(data));
    },
    readFile: async (file: string) => {
      const value = this.files.get(file);
      if (!value) throw new Error("missing file");
      return value;
    },
  };

  async updateNetworkPolicy(): Promise<void> {
    this.events.push("network-deny-all");
  }

  async runCommand(options: Parameters<SandboxInstance["runCommand"]>[0]) {
    this.events.push("command");
    this.command = options;
    const outputIndex = options.args.indexOf("--output");
    const outputRelative = options.args[outputIndex + 1];
    if (!outputRelative) throw new Error("missing output argument");
    const outputPath = `${options.cwd}/${outputRelative}`;
    this.files.set(
      outputPath,
      Buffer.from(
        JSON.stringify({
          schema_version: "1",
          run_id: context.run_id,
          datasets: [
            {
              asset_id: "asset-1",
              file_name: "data.csv",
              format: "csv",
              sheet_name: null,
              row_count: 2,
              column_count: 1,
              columns: [
                {
                  name: "value",
                  data_type: "numeric",
                  non_null_count: 2,
                  missing_count: 0,
                  unique_count: 2,
                  minimum: 1,
                  maximum: 2,
                  mean: 1.5,
                  sample_values: [1, 2],
                },
              ],
              sample_rows: [{ value: 1 }, { value: 2 }],
            },
          ],
        }),
      ),
    );
    return {
      exitCode: 0,
      stdout: async () => "",
      stderr: async () => "",
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.events.push("stopped");
  }

  async delete(): Promise<void> {
    this.deleted = true;
    this.events.push("deleted");
  }
}

function harness(assetSha = sha256) {
  const fake = new FakeSandbox();
  let createOptions: Parameters<SandboxFactory["getOrCreate"]>[0] | null = null;
  let createCount = 0;
  let exists = false;
  const factory: SandboxFactory = {
    async getOrCreate(options) {
      createOptions = options;
      if (!exists) {
        exists = true;
        createCount += 1;
        await options.onCreate(fake);
      }
      return fake;
    },
    async get() {
      if (!exists || fake.deleted) throw new Error("not found");
      return fake;
    },
  };
  const api = new InternalApiClient({
    baseUrl: "https://api.example.test",
    sharedSecret: "server-only-secret",
    fetch: async (_url, init) => {
      expect(new Headers(init?.headers).get("x-internal-service-secret")).toBe("server-only-secret");
      return Response.json({
        ...context.assets[0],
        sha256: assetSha,
        download_url: "https://blob.example.test/signed-object",
        expires_at: "2099-08-03T00:00:00.000Z",
      });
    },
  });
  const options = {
    snapshotId: "snap_123456789",
    internalApi: api,
    factory,
    fetch: async () => new Response(csv, { status: 200, headers: { "content-length": String(csv.byteLength) } }),
  };
  const adapter = new VercelSandboxAdapter(options);
  return {
    adapter,
    fake,
    options,
    getCreateOptions: () => createOptions,
    getCreateCount: () => createCount,
  };
}

describe("Vercel Sandbox adapter", () => {
  it("defers a missing snapshot until data work and keeps text-only cleanup local", async () => {
    const originalSnapshotId = process.env.SANDBOX_SNAPSHOT_ID;
    delete process.env.SANDBOX_SNAPSHOT_ID;
    try {
      const api = new InternalApiClient({
        baseUrl: "https://api.example.test",
        sharedSecret: "server-only-secret",
        fetch: async () => {
          throw new Error("resolver must not be reached");
        },
      });
      const factory: SandboxFactory = {
        getOrCreate: vi.fn(async () => {
          throw new Error("Sandbox must not be created");
        }),
        get: vi.fn(async () => {
          throw new Error("Sandbox must not be resolved");
        }),
      };
      const adapter = VercelSandboxAdapter.fromEnvironment(api, { factory });

      await adapter.cleanup("pure-text-run");
      expect(factory.get).not.toHaveBeenCalled();
      await expect(
        adapter.profile(context, { idempotency_key: "run-adapter:profile:missing-snapshot" }),
      ).rejects.toMatchObject({
        code: "SANDBOX_NOT_CONFIGURED",
        retryable: false,
        failedStep: "profiling",
      });
      expect(factory.getOrCreate).not.toHaveBeenCalled();
    } finally {
      if (originalSnapshotId === undefined) delete process.env.SANDBOX_SNAPSHOT_ID;
      else process.env.SANDBOX_SNAPSHOT_ID = originalSnapshotId;
    }
  });

  it("creates the pinned 1-vCPU snapshot, verifies staging, locks network, and bounds the command", async () => {
    const test = harness();
    const result = await test.adapter.profile(context, { idempotency_key: "run-adapter:profile:1" });

    expect(result.run_id).toBe("run-adapter");
    expect(test.getCreateOptions()).toMatchObject({
      source: { type: "snapshot", snapshotId: "snap_123456789" },
      timeout: 25 * 60_000,
      resources: { vcpus: 1 },
      networkPolicy: "allow-all",
      persistent: true,
      snapshotExpiration: 25 * 60_000,
    });
    expect(test.fake.events.indexOf("asset-written")).toBeLessThan(
      test.fake.events.indexOf("network-deny-all"),
    );
    expect(test.fake.events.indexOf("network-deny-all")).toBeLessThan(
      test.fake.events.indexOf("command"),
    );
    expect(test.fake.command).toMatchObject({
      cmd: "python",
      timeoutMs: 120_000,
      env: { PYTHONHASHSEED: "0", PYTHONUNBUFFERED: "1" },
    });
    expect(test.fake.command?.env).not.toHaveProperty("INTERNAL_SERVICE_SHARED_SECRET");

    await test.adapter.cleanup("run-adapter");
    expect(test.fake.deleted).toBe(true);
  });

  it("resumes one named persistent workspace across durable adapter slices", async () => {
    const test = harness();
    await test.adapter.profile(context, { idempotency_key: "run-adapter:profile:1" });
    await test.adapter.suspend(context.run_id);
    expect(test.fake.stopped).toBe(true);
    expect(test.fake.deleted).toBe(false);

    const resumed = new VercelSandboxAdapter(test.options);
    await resumed.profile(context, { idempotency_key: "run-adapter:profile:2" });
    expect(test.getCreateCount()).toBe(1);
    await resumed.cleanup(context.run_id);
    expect(test.fake.deleted).toBe(true);
  });

  it("rejects a resolver manifest mismatch before running Python", async () => {
    const test = harness("f".repeat(64));
    await expect(
      test.adapter.profile(context, { idempotency_key: "run-adapter:profile:1" }),
    ).rejects.toMatchObject({ code: "ASSET_MANIFEST_MISMATCH" });
    expect(test.fake.events).not.toContain("command");
    await test.adapter.cancel("run-adapter");
    expect(test.fake.deleted).toBe(true);
  });

  it("aborts the whole Sandbox operation below the Workflow step ceiling", async () => {
    vi.useFakeTimers();
    try {
      const api = new InternalApiClient({
        baseUrl: "https://api.example.test",
        sharedSecret: "server-only-secret",
        fetch: async () => {
          throw new Error("resolver must not be reached");
        },
      });
      const factory: SandboxFactory = {
        getOrCreate: async (options) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
        get: async () => {
          throw new Error("not found");
        },
      };
      const adapter = new VercelSandboxAdapter({
        snapshotId: "snap_123456789",
        internalApi: api,
        factory,
      });
      const assertion = expect(
        adapter.profile(context, { idempotency_key: "run-adapter:profile" }),
      ).rejects.toMatchObject({ code: "WORKFLOW_STEP_TIMEOUT", retryable: true });

      await vi.advanceTimersByTimeAsync(RESOURCE_LIMITS.workflowStepTimeoutMs);
      await assertion;
      expect(RESOURCE_LIMITS.workflowStepTimeoutMs).toBeLessThan(240_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
