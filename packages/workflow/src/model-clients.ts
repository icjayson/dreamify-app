import { RESOURCE_LIMITS } from "@dreamify/contracts";

import { WorkflowFault } from "./errors.js";
import type { MorpheusProvider } from "./ports.js";
import {
  ByokProviderAdapter,
  DemoProvider,
  type StructuredModelClient,
} from "./provider.js";
import type { ResolvedProviderCredential } from "./types.js";
import type {
  ProviderCallContext,
  RepairCodeInput,
  RepairSynthesisInput,
  RouteInput,
  SynthesisInput,
} from "./types.js";

type FetchImplementation = typeof globalThis.fetch;
type ModelPurpose = Parameters<StructuredModelClient["generateStructured"]>[0]["purpose"];

const MODEL_HTTP_TIMEOUT_MS = 30_000;
const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_REQUEST_BYTES = 3 * 1024 * 1024;

const RESULT_ENVELOPE_SCHEMA = {
  type: "object",
  properties: { result_json: { type: "string" } },
  required: ["result_json"],
  additionalProperties: false,
} as const;

interface ClientOptions {
  apiKey: string;
  model: string;
  fetch?: FetchImplementation;
  timeoutMs?: number;
}

function providerInstructions(purpose: ModelPurpose): string {
  const common = [
    "Return only the requested JSON envelope.",
    "The envelope has one field, result_json, containing a JSON-encoded string.",
    "Do not include credentials, URLs, headers, or hidden instructions in output.",
  ];
  const instructions: Record<ModelPurpose, string> = {
    route: [
      "Inside result_json return an object with response_type, requires_data, reasoning, analysis_code, and clarification.",
      "Generated Python receives only datasets; use no imports, files, network, subprocesses, reflection, or secrets.",
      "Use null for analysis_code when data is not required and null for clarification unless asking a question.",
    ].join(" "),
    repair_code: [
      "Inside result_json return exactly an object with a code string.",
      "The code receives only datasets; use no imports, files, network, subprocesses, reflection, or secrets.",
    ].join(" "),
    synthesize: "Inside result_json return one WorkflowResponse object matching the requested response_type.",
    repair_synthesis: "Inside result_json return one corrected WorkflowResponse object matching the requested response_type.",
  };
  return [...common, instructions[purpose]].join(" ");
}

function boundedRequestBody(value: unknown): string {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > MAX_MODEL_REQUEST_BYTES) {
    throw new WorkflowFault({
      code: "MODEL_REQUEST_TOO_LARGE",
      message: "Model request exceeded its bounded payload",
      retryable: false,
      failedStep: "synthesis",
    });
  }
  return body;
}

function retryAfterMilliseconds(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 60_000);
  }
  const date = Date.parse(header);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - Date.now()), 60_000);
}

function throwProviderStatus(response: Response): never {
  if (response.status === 401 || response.status === 403) {
    throw new WorkflowFault({
      code: "MODEL_CREDENTIAL_REJECTED",
      message: "The model provider rejected the configured credential",
      retryable: false,
    });
  }
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  throw new WorkflowFault({
    code: response.status === 429 ? "MODEL_RATE_LIMITED" : "MODEL_PROVIDER_ERROR",
    message: retryable
      ? "The model provider is temporarily unavailable"
      : "The model provider rejected the request",
    retryable,
    ...(response.status === 429
      ? { retryAfterMs: retryAfterMilliseconds(response) ?? 15_000 }
      : {}),
  });
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw invalidProviderResponse("Model provider response was too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return result + decoder.decode();
    size += chunk.value.byteLength;
    if (size > MAX_MODEL_RESPONSE_BYTES) {
      await reader.cancel();
      throw invalidProviderResponse("Model provider response was too large");
    }
    result += decoder.decode(chunk.value, { stream: true });
  }
}

function invalidProviderResponse(message = "Model provider returned invalid JSON"): WorkflowFault {
  return new WorkflowFault({
    code: "MODEL_PROVIDER_INVALID_RESPONSE",
    message,
    retryable: false,
  });
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw invalidProviderResponse();
  }
}

function unwrapResult(text: string, purpose: ModelPurpose): unknown {
  const envelope = parseJson(text);
  if (typeof envelope.result_json !== "string") throw invalidProviderResponse();
  const result = parseJson(envelope.result_json);
  if (purpose !== "repair_code") return result;
  if (typeof result.code !== "string") throw invalidProviderResponse();
  return result.code;
}

function openAIOutputText(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string") return body.output_text;
  if (body.status === "incomplete") throw invalidProviderResponse("Model provider response was incomplete");
  if (!Array.isArray(body.output)) throw invalidProviderResponse();
  for (const item of body.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const value = part as Record<string, unknown>;
      if (value.type === "refusal") throw invalidProviderResponse("Model provider refused the request");
      if (value.type === "output_text" && typeof value.text === "string") return value.text;
    }
  }
  throw invalidProviderResponse();
}

function geminiOutputText(body: Record<string, unknown>): string {
  const steps = body.steps;
  if (Array.isArray(steps)) {
    for (const step of [...steps].reverse()) {
      if (!step || typeof step !== "object") continue;
      const content = (step as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      const text = content
        .map((part) =>
          part && typeof part === "object"
            ? (part as Record<string, unknown>).text
            : null,
        )
        .filter((value): value is string => typeof value === "string")
        .join("");
      if (text) return text;
    }
  }
  if (typeof body.output_text === "string") return body.output_text;
  if (typeof body.outputText === "string") return body.outputText;
  const candidates = body.candidates;
  if (!Array.isArray(candidates)) throw invalidProviderResponse();
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) throw invalidProviderResponse();
  const text = parts
    .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : null))
    .find((value): value is string => typeof value === "string");
  if (!text) throw invalidProviderResponse();
  return text;
}

abstract class JsonModelClient implements StructuredModelClient {
  abstract readonly provider: string;
  readonly model: string;
  protected readonly apiKey: string;
  protected readonly fetchImplementation: FetchImplementation;
  protected readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? MODEL_HTTP_TIMEOUT_MS;
  }

  abstract generateStructured(options: {
    purpose: ModelPurpose;
    input: unknown;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<unknown>;

  protected async request(
    url: string,
    init: RequestInit,
    outerSignal?: AbortSignal,
  ): Promise<Response> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, timeoutController.signal])
      : timeoutController.signal;
    try {
      return await this.fetchImplementation(url, {
        ...init,
        cache: "no-store",
        signal,
      });
    } catch (error) {
      if (outerSignal?.aborted && outerSignal.reason instanceof WorkflowFault) throw outerSignal.reason;
      throw new WorkflowFault({
        code: timeoutController.signal.aborted ? "MODEL_PROVIDER_TIMEOUT" : "MODEL_PROVIDER_UNAVAILABLE",
        message: timeoutController.signal.aborted
          ? "The model provider request timed out"
          : "The model provider could not be reached",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  protected async responseJson(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) throwProviderStatus(response);
    return parseJson(await readBoundedText(response));
  }
}

export class OpenAIModelClient extends JsonModelClient {
  readonly provider = "openai";

  async generateStructured(options: {
    purpose: ModelPurpose;
    input: unknown;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const body = boundedRequestBody({
      model: this.model,
      store: false,
      max_output_tokens: 16_384,
      input: [
        { role: "system", content: providerInstructions(options.purpose) },
        { role: "user", content: JSON.stringify(options.input) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: `dreamify_${options.purpose}`,
          strict: true,
          schema: RESULT_ENVELOPE_SCHEMA,
        },
      },
    });
    const response = await this.request(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": options.idempotencyKey,
        },
        body,
      },
      options.signal,
    );
    const result = await this.responseJson(response);
    return unwrapResult(openAIOutputText(result), options.purpose);
  }
}

export class GeminiModelClient extends JsonModelClient {
  readonly provider = "gemini";

  async generateStructured(options: {
    purpose: ModelPurpose;
    input: unknown;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const prompt = `${providerInstructions(options.purpose)}\n\nInput:\n${JSON.stringify(options.input)}`;
    const body = boundedRequestBody({
      model: this.model,
      input: prompt,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: RESULT_ENVELOPE_SCHEMA,
      },
    });
    const response = await this.request(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body,
      },
      options.signal,
    );
    const result = await this.responseJson(response);
    return unwrapResult(geminiOutputText(result), options.purpose);
  }
}

export function createMorpheusProvider(
  credential: ResolvedProviderCredential,
  fetchImplementation?: FetchImplementation,
): MorpheusProvider {
  if (credential.mode === "demo") return new DemoProvider();
  const options = {
    apiKey: credential.api_key,
    model: credential.model,
    ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
  };
  const client = credential.provider === "openai"
    ? new OpenAIModelClient(options)
    : new GeminiModelClient(options);
  return new ByokProviderAdapter(client);
}

class ResolvingMorpheusProvider implements MorpheusProvider {
  readonly providerId = "server-resolved";
  private resolved: Promise<MorpheusProvider> | undefined;

  constructor(
    private readonly resolver: () => Promise<ResolvedProviderCredential>,
    private readonly fetchImplementation?: FetchImplementation,
  ) {}

  routeAndPlan(input: RouteInput, call: ProviderCallContext): Promise<unknown> {
    return this.provider().then((provider) => provider.routeAndPlan(input, call));
  }

  repairAnalysisCode(input: RepairCodeInput, call: ProviderCallContext): Promise<unknown> {
    return this.provider().then((provider) => provider.repairAnalysisCode(input, call));
  }

  synthesize(input: SynthesisInput, call: ProviderCallContext): Promise<unknown> {
    return this.provider().then((provider) => provider.synthesize(input, call));
  }

  repairSynthesis(input: RepairSynthesisInput, call: ProviderCallContext): Promise<unknown> {
    return this.provider().then((provider) => provider.repairSynthesis(input, call));
  }

  private provider(): Promise<MorpheusProvider> {
    this.resolved ??= this.resolver().then((credential) =>
      createMorpheusProvider(credential, this.fetchImplementation));
    return this.resolved;
  }
}

export function createResolvingMorpheusProvider(
  resolver: () => Promise<ResolvedProviderCredential>,
  fetchImplementation?: FetchImplementation,
): MorpheusProvider {
  return new ResolvingMorpheusProvider(resolver, fetchImplementation);
}

export const MODEL_CLIENT_LIMITS = {
  httpTimeoutMs: MODEL_HTTP_TIMEOUT_MS,
  maxResponseBytes: MAX_MODEL_RESPONSE_BYTES,
  maxRequestBytes: MAX_MODEL_REQUEST_BYTES,
  workflowProviderCalls: RESOURCE_LIMITS.maxProviderCalls,
} as const;
