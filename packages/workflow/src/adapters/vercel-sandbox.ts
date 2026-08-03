import { createHash } from "node:crypto";
import { posix as path } from "node:path";

import { Sandbox } from "@vercel/sandbox";
import {
  DataAssetReferenceSchema,
  RESOURCE_LIMITS,
  SandboxAnalysisResultSchema,
  SandboxProfileResultSchema,
  type DataAssetReference,
  type SandboxAnalysisResult,
  type SandboxProfileResult,
} from "@dreamify/contracts";
import { z } from "zod";

import { CancellationFault, WorkflowFault } from "../errors.js";
import type { SandboxAdapter } from "../ports.js";
import type { ProviderCallContext, RunContext } from "../types.js";
import { InternalApiClient } from "./internal-api.js";

const WORKSPACE_ROOT = "/vercel/sandbox/workspaces";
const PROFILE_OUTPUT_LIMIT = RESOURCE_LIMITS.maxProfileBytes;
const ANALYSIS_OUTPUT_LIMIT = RESOURCE_LIMITS.maxAnalysisResultBytes + 128 * 1024;

const ResolvedAssetSchema = DataAssetReferenceSchema.extend({
  download_url: z.string().url().max(4_096),
  expires_at: z.string().datetime({ offset: true }),
}).strict();

type ResolvedAsset = z.infer<typeof ResolvedAssetSchema>;
type FetchImplementation = typeof globalThis.fetch;

interface SandboxCommandResult {
  exitCode: number;
  stdout(options?: { signal?: AbortSignal }): Promise<string>;
  stderr(options?: { signal?: AbortSignal }): Promise<string>;
}

export interface SandboxInstance {
  readonly fs: {
    mkdir(directory: string, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<unknown>;
    writeFile(file: string, data: string | Buffer | Uint8Array, options?: { signal?: AbortSignal }): Promise<void>;
    readFile(file: string, options?: { signal?: AbortSignal } | null): Promise<Buffer>;
  };
  runCommand(options: {
    cmd: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<SandboxCommandResult>;
  updateNetworkPolicy(policy: "deny-all", options?: { signal?: AbortSignal }): Promise<unknown>;
  stop(options?: { signal?: AbortSignal }): Promise<unknown>;
  delete(options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface SandboxFactory {
  getOrCreate(options: {
    name: string;
    source: { type: "snapshot"; snapshotId: string };
    timeout: number;
    resources: { vcpus: number };
    networkPolicy: "allow-all";
    tags: Record<string, string>;
    persistent: true;
    snapshotExpiration: number;
    onCreate(instance: SandboxInstance): Promise<void>;
    signal?: AbortSignal;
  }): Promise<SandboxInstance>;
  get(options: { name: string; resume: false; signal?: AbortSignal }): Promise<SandboxInstance>;
}

interface ActiveSandbox {
  instance: SandboxInstance;
  workspace: string;
  staged: boolean;
  networkLocked: boolean;
}

export interface VercelSandboxAdapterOptions {
  snapshotId?: string;
  internalApi: InternalApiClient;
  factory?: SandboxFactory;
  fetch?: FetchImplementation;
}

const vercelFactory: SandboxFactory = {
  async getOrCreate(options) {
    return Sandbox.getOrCreate(options);
  },
  async get(options) {
    return Sandbox.get(options);
  },
};

function sandboxName(runId: string): string {
  return `dreamify-${createHash("sha256").update(runId).digest("hex").slice(0, 24)}`;
}

function safeWorkspace(runId: string): string {
  const digest = createHash("sha256").update(runId).digest("hex").slice(0, 24);
  return `${WORKSPACE_ROOT}/run-${digest}`;
}

function validateSnapshotId(snapshotId: string): string {
  if (!/^snap_[A-Za-z0-9_-]{6,190}$/.test(snapshotId)) {
    throw new Error("SANDBOX_SNAPSHOT_ID is invalid");
  }
  return snapshotId;
}

function safeAssetPath(workspace: string, relativePath: string): string {
  if (
    !relativePath.startsWith("input/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath) ||
    path.normalize(relativePath) !== relativePath ||
    relativePath.split("/").includes("..")
  ) {
    throw new WorkflowFault({
      code: "UNSAFE_ASSET_PATH",
      message: "Asset path is outside the isolated workspace",
      retryable: false,
      failedStep: "profiling",
    });
  }
  return path.join(workspace, relativePath);
}

function verifyManifest(expected: DataAssetReference, resolved: ResolvedAsset): void {
  const stableFields = [
    "asset_id",
    "object_id",
    "file_name",
    "format",
    "media_type",
    "size_bytes",
    "sha256",
    "relative_path",
  ] as const;
  for (const field of stableFields) {
    if (resolved[field] !== expected[field]) {
      throw new WorkflowFault({
        code: "ASSET_MANIFEST_MISMATCH",
        message: `Resolved asset ${field} does not match the accepted run manifest`,
        retryable: false,
        failedStep: "profiling",
      });
    }
  }
  if (Date.parse(resolved.expires_at) <= Date.now()) {
    throw new WorkflowFault({
      code: "ASSET_ACCESS_EXPIRED",
      message: "Resolved asset access expired before staging",
      retryable: true,
      failedStep: "profiling",
    });
  }
}

async function boundedDownload(
  asset: ResolvedAsset,
  fetchImplementation: FetchImplementation,
  signal?: AbortSignal,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetchImplementation(asset.download_url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new WorkflowFault({
      code: "ASSET_DOWNLOAD_FAILED",
      message: "Asset download request failed",
      retryable: true,
      failedStep: "profiling",
    });
  }
  if (!response.ok) {
    throw new WorkflowFault({
      code: "ASSET_DOWNLOAD_FAILED",
      message: `Asset download returned HTTP ${response.status}`,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      failedStep: "profiling",
    });
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > asset.size_bytes) {
    throw new WorkflowFault({
      code: "ASSET_SIZE_MISMATCH",
      message: "Asset download exceeds its accepted size",
      retryable: false,
      failedStep: "profiling",
    });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== asset.size_bytes || bytes.byteLength > RESOURCE_LIMITS.maxFileBytes) {
    throw new WorkflowFault({
      code: "ASSET_SIZE_MISMATCH",
      message: "Downloaded asset size does not match its accepted manifest",
      retryable: false,
      failedStep: "profiling",
    });
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== asset.sha256) {
    throw new WorkflowFault({
      code: "ASSET_CHECKSUM_MISMATCH",
      message: "Downloaded asset checksum does not match its accepted manifest",
      retryable: false,
      failedStep: "profiling",
    });
  }
  return bytes;
}

/** Concrete adapter for the pinned, command-only Python runner snapshot. */
export class VercelSandboxAdapter implements SandboxAdapter {
  private readonly snapshotId: string | null;
  private readonly factory: SandboxFactory;
  private readonly fetchImplementation: FetchImplementation;
  private readonly active = new Map<string, Promise<ActiveSandbox>>();

  constructor(private readonly options: VercelSandboxAdapterOptions) {
    this.snapshotId = options.snapshotId ? validateSnapshotId(options.snapshotId) : null;
    this.factory = options.factory ?? vercelFactory;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  static fromEnvironment(
    internalApi: InternalApiClient,
    overrides: Pick<VercelSandboxAdapterOptions, "factory" | "fetch"> = {},
  ): VercelSandboxAdapter {
    const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;
    return new VercelSandboxAdapter({
      internalApi,
      ...overrides,
      ...(snapshotId ? { snapshotId } : {}),
    });
  }

  async profile(context: RunContext, call: ProviderCallContext): Promise<SandboxProfileResult> {
    this.requireSnapshotId("profiling");
    return this.withStepDeadline(call, "profiling", async (boundedCall) => {
      const active = await this.prepare(context, boundedCall);
      const request = { schema_version: "1" as const, run_id: context.run_id, assets: context.assets };
      const output = await this.invoke(active, "profile", request, "profile", boundedCall);
      try {
        return SandboxProfileResultSchema.parse(output);
      } catch (error) {
        throw this.invalidRunnerOutput(error, "profiling");
      }
    });
  }

  async execute(
    context: RunContext,
    code: string,
    call: ProviderCallContext,
  ): Promise<SandboxAnalysisResult> {
    this.requireSnapshotId("analysis");
    return this.withStepDeadline(call, "analysis", async (boundedCall) => {
      const active = await this.prepare(context, boundedCall);
      const request = {
        schema_version: "1" as const,
        run_id: context.run_id,
        assets: context.assets,
        code,
      };
      const output = await this.invoke(active, "execute", request, "analysis", boundedCall);
      try {
        return SandboxAnalysisResultSchema.parse(output);
      } catch (error) {
        throw this.invalidRunnerOutput(error, "analysis");
      }
    });
  }

  async cancel(runId: string): Promise<void> {
    await this.remove(runId);
  }

  async suspend(runId: string): Promise<void> {
    await this.stopSession(runId);
  }

  async cleanup(runId: string): Promise<void> {
    await this.remove(runId);
  }

  private async prepare(context: RunContext, call: ProviderCallContext): Promise<ActiveSandbox> {
    let pending = this.active.get(context.run_id);
    if (!pending) {
      pending = this.createAndStage(context, call);
      this.active.set(context.run_id, pending);
      pending.catch(() => this.active.delete(context.run_id));
    }
    return pending;
  }

  private async createAndStage(
    context: RunContext,
    call: ProviderCallContext,
  ): Promise<ActiveSandbox> {
    const snapshotId = this.requireSnapshotId("profiling");
    const workspace = safeWorkspace(context.run_id);
    let created: ActiveSandbox | null = null;
    try {
      const instance = await this.factory.getOrCreate({
        name: sandboxName(context.run_id),
        source: { type: "snapshot", snapshotId },
        timeout: RESOURCE_LIMITS.sandboxLifetimeMs,
        resources: { vcpus: 1 },
        networkPolicy: "allow-all",
        tags: { app: "dreamify", run: createHash("sha256").update(context.run_id).digest("hex").slice(0, 16) },
        persistent: true,
        snapshotExpiration: RESOURCE_LIMITS.sandboxLifetimeMs,
        onCreate: async (fresh) => {
          const active: ActiveSandbox = {
            instance: fresh,
            workspace,
            staged: false,
            networkLocked: false,
          };
          try {
            await fresh.fs.mkdir(workspace, {
              recursive: true,
              ...(call.signal ? { signal: call.signal } : {}),
            });
            await this.stageAssets(active, context, call.signal);
            await fresh.updateNetworkPolicy(
              "deny-all",
              call.signal ? { signal: call.signal } : undefined,
            );
            active.networkLocked = true;
            await this.writeReadyMarker(active, context, call.signal);
            created = active;
          } catch (error) {
            await fresh.delete().catch(() => undefined);
            throw error;
          }
        },
        ...(call.signal ? { signal: call.signal } : {}),
      });
      if (created) return created;
      const resumed: ActiveSandbox = {
        instance,
        workspace,
        staged: true,
        networkLocked: true,
      };
      await this.validateReadyMarker(resumed, context, call.signal);
      return resumed;
    } catch (error) {
      throw error;
    }
  }

  private markerPath(workspace: string): string {
    return path.join(workspace, ".dreamify-ready.json");
  }

  private contextFingerprint(context: RunContext): string {
    const manifest = context.assets.map(({ object_id, relative_path, sha256, size_bytes }) => ({
      object_id,
      relative_path,
      sha256,
      size_bytes,
    }));
    return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  }

  private async writeReadyMarker(
    active: ActiveSandbox,
    context: RunContext,
    signal?: AbortSignal,
  ): Promise<void> {
    await active.instance.fs.writeFile(
      this.markerPath(active.workspace),
      Buffer.from(JSON.stringify({ run_id: context.run_id, fingerprint: this.contextFingerprint(context) })),
      signal ? { signal } : undefined,
    );
  }

  private async validateReadyMarker(
    active: ActiveSandbox,
    context: RunContext,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const value = JSON.parse(
        (await active.instance.fs.readFile(
          this.markerPath(active.workspace),
          signal ? { signal } : undefined,
        )).toString("utf8"),
      ) as { run_id?: string; fingerprint?: string };
      if (value.run_id !== context.run_id || value.fingerprint !== this.contextFingerprint(context)) {
        throw new Error("marker mismatch");
      }
    } catch {
      throw new WorkflowFault({
        code: "SANDBOX_STATE_INVALID",
        message: "Persistent Sandbox state does not match the workflow run",
        retryable: false,
        failedStep: "profiling",
      });
    }
  }

  private async stageAssets(
    active: ActiveSandbox,
    context: RunContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const seenPaths = new Set<string>();
    let totalBytes = 0;
    for (const expected of context.assets) {
      const resolvedBody = await this.options.internalApi.api<unknown>("/internal/assets/resolve", {
        method: "POST",
        body: JSON.stringify({ run_id: context.run_id, object_id: expected.object_id }),
        ...(signal ? { signal } : {}),
      });
      const resolved = ResolvedAssetSchema.parse(resolvedBody);
      verifyManifest(expected, resolved);
      const destination = safeAssetPath(active.workspace, resolved.relative_path);
      if (seenPaths.has(destination)) {
        throw new WorkflowFault({
          code: "DUPLICATE_ASSET_PATH",
          message: "Asset manifests resolve to the same isolated path",
          retryable: false,
          failedStep: "profiling",
        });
      }
      seenPaths.add(destination);
      totalBytes += resolved.size_bytes;
      if (totalBytes > RESOURCE_LIMITS.maxAggregateFileBytes) {
        throw new WorkflowFault({
          code: "INPUT_TOO_LARGE",
          message: "Aggregate asset size exceeded during staging",
          retryable: false,
          failedStep: "profiling",
        });
      }
      const content = await boundedDownload(resolved, this.fetchImplementation, signal);
      await active.instance.fs.mkdir(path.dirname(destination), {
        recursive: true,
        ...(signal ? { signal } : {}),
      });
      await active.instance.fs.writeFile(destination, content, signal ? { signal } : undefined);
    }
    active.staged = true;
  }

  private async invoke(
    active: ActiveSandbox,
    command: "profile" | "execute",
    request: unknown,
    outputName: "profile" | "analysis",
    call: ProviderCallContext,
  ): Promise<unknown> {
    if (!active.staged || !active.networkLocked) {
      throw new WorkflowFault({
        code: "SANDBOX_NOT_LOCKED",
        message: "Sandbox input was not staged and network-isolated",
        retryable: false,
        failedStep: command === "profile" ? "profiling" : "analysis",
      });
    }
    const suffix = createHash("sha256").update(call.idempotency_key).digest("hex").slice(0, 16);
    const requestRelative = `requests/${outputName}-${suffix}.json`;
    const outputRelative = `results/${outputName}-${suffix}.json`;
    const requestPath = path.join(active.workspace, requestRelative);
    const outputPath = path.join(active.workspace, outputRelative);
    await active.instance.fs.mkdir(path.dirname(requestPath), {
      recursive: true,
      ...(call.signal ? { signal: call.signal } : {}),
    });
    await active.instance.fs.mkdir(path.dirname(outputPath), {
      recursive: true,
      ...(call.signal ? { signal: call.signal } : {}),
    });
    await active.instance.fs.writeFile(
      requestPath,
      Buffer.from(JSON.stringify(request), "utf8"),
      call.signal ? { signal: call.signal } : undefined,
    );

    const result = await active.instance.runCommand({
      cmd: "python",
      args: [
        "-m",
        "runner.main",
        command,
        "--workspace",
        active.workspace,
        "--request",
        requestRelative,
        "--output",
        outputRelative,
      ],
      cwd: active.workspace,
      env: { PYTHONHASHSEED: "0", PYTHONUNBUFFERED: "1" },
      timeoutMs: RESOURCE_LIMITS.sandboxCommandTimeoutMs,
      ...(call.signal ? { signal: call.signal } : {}),
    });

    let output: Buffer;
    try {
      output = await active.instance.fs.readFile(
        outputPath,
        call.signal ? { signal: call.signal } : undefined,
      );
    } catch {
      throw new WorkflowFault({
        code: "SANDBOX_OUTPUT_MISSING",
        message: "Sandbox runner did not produce structured output",
        retryable: result.exitCode !== 2,
        failedStep: command === "profile" ? "profiling" : "analysis",
      });
    }
    const limit = command === "profile" ? PROFILE_OUTPUT_LIMIT : ANALYSIS_OUTPUT_LIMIT;
    if (output.byteLength <= 0 || output.byteLength > limit) {
      throw new WorkflowFault({
        code: "SANDBOX_OUTPUT_TOO_LARGE",
        message: "Sandbox runner output exceeded its bounded result size",
        retryable: false,
        failedStep: command === "profile" ? "profiling" : "analysis",
      });
    }
    try {
      return JSON.parse(output.toString("utf8")) as unknown;
    } catch {
      throw new WorkflowFault({
        code: "SANDBOX_INVALID_JSON",
        message: "Sandbox runner output was not strict JSON",
        retryable: false,
        failedStep: command === "profile" ? "profiling" : "analysis",
      });
    }
  }

  private async stopSession(runId: string): Promise<void> {
    const pending = this.active.get(runId);
    this.active.delete(runId);
    if (!pending) return;
    try {
      const active = await pending;
      await active.instance.stop();
    } catch {
      // Sandbox lifetime is capped at 25 minutes; stop is best effort on failures.
    }
  }

  private async remove(runId: string): Promise<void> {
    const pending = this.active.get(runId);
    this.active.delete(runId);
    if (!pending && !this.snapshotId) return;
    try {
      const instance = pending
        ? (await pending).instance
        : await this.factory.get({ name: sandboxName(runId), resume: false });
      await instance.delete();
    } catch {
      // Missing/expired named Sandboxes are already clean.
    }
  }

  private async withStepDeadline<T>(
    call: ProviderCallContext,
    failedStep: "profiling" | "analysis",
    operation: (boundedCall: ProviderCallContext) => Promise<T>,
  ): Promise<T> {
    if (call.signal?.aborted) throw new CancellationFault();
    const controller = new AbortController();
    const cancel = () => controller.abort(call.signal?.reason);
    call.signal?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const fault = new WorkflowFault({
          code: "WORKFLOW_STEP_TIMEOUT",
          message: "Sandbox step exceeded its bounded execution window",
          retryable: true,
          failedStep,
        });
        reject(fault);
        controller.abort(fault);
      }, RESOURCE_LIMITS.workflowStepTimeoutMs);
    });
    try {
      return await Promise.race([
        operation({ idempotency_key: call.idempotency_key, signal: controller.signal }),
        timeout,
      ]);
    } catch (error) {
      if (call.signal?.aborted) {
        if (call.signal.reason instanceof WorkflowFault) throw call.signal.reason;
        throw new CancellationFault();
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      call.signal?.removeEventListener("abort", cancel);
    }
  }

  private invalidRunnerOutput(
    error: unknown,
    failedStep: "profiling" | "analysis",
  ): WorkflowFault {
    return new WorkflowFault({
      code: "SANDBOX_INVALID_RESULT",
      message: error instanceof Error ? error.message.slice(0, 1_000) : "Invalid Sandbox result",
      retryable: false,
      failedStep,
    });
  }

  private requireSnapshotId(failedStep: "profiling" | "analysis"): string {
    if (this.snapshotId) return this.snapshotId;
    throw new WorkflowFault({
      code: "SANDBOX_NOT_CONFIGURED",
      message: "Pinned Sandbox snapshot is not configured",
      retryable: false,
      failedStep,
    });
  }
}
