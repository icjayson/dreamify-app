import { describe, expect, it, vi } from "vitest";

import {
  DeepSeekModelClient,
  GeminiModelClient,
  OpenAIModelClient,
  createMorpheusProvider,
  createResolvingMorpheusProvider,
} from "../src/model-clients.js";

function envelope(value: unknown): string {
  return JSON.stringify({ result_json: JSON.stringify(value) });
}

describe("server-only BYOK model clients", () => {
  it("calls OpenAI Responses with a strict envelope and unwraps JSON", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(request.store).toBe(false);
      expect(request.text.format).toMatchObject({
        type: "json_schema",
        strict: true,
      });
      expect(String(init?.headers && (init.headers as Record<string, string>).authorization)).toBe(
        "Bearer local-provider-credential",
      );
      return new Response(JSON.stringify({ output_text: envelope({ ok: true }) }), {
        status: 200,
      });
    });
    const client = new OpenAIModelClient({
      apiKey: "local-provider-credential",
      model: "gpt-test",
      fetch,
    });

    await expect(client.generateStructured({
      purpose: "route",
      input: { prompt: "summarize" },
      idempotencyKey: "run:route",
    })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("calls DeepSeek Chat Completions in bounded JSON mode", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer local-deepseek-credential",
      );
      const request = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(request).toMatchObject({
        model: "deepseek-v4-flash",
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        stream: false,
      });
      return Response.json({
        choices: [{
          finish_reason: "stop",
          message: { content: envelope({ ok: true }) },
        }],
      });
    });
    const client = new DeepSeekModelClient({
      apiKey: "local-deepseek-credential",
      model: "deepseek-v4-flash",
      fetch,
    });

    await expect(client.generateStructured({
      purpose: "route",
      input: { prompt: "summarize" },
      idempotencyKey: "run:route",
    })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("calls Gemini Interactions and unwraps repaired code", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe(
        "local-gemini-credential",
      );
      const currentEnvelope = envelope({ code: "result = {}" });
      const splitAt = Math.floor(currentEnvelope.length / 2);
      return new Response(
        JSON.stringify({
          steps: [
            {
              content: [
                { type: "text", text: currentEnvelope.slice(0, splitAt) },
                { type: "text", text: currentEnvelope.slice(splitAt) },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const client = new GeminiModelClient({
      apiKey: "local-gemini-credential",
      model: "gemini-test",
      fetch,
    });

    await expect(client.generateStructured({
      purpose: "repair_code",
      input: { failure: { code: "invalid" } },
      idempotencyKey: "run:repair",
    })).resolves.toBe("result = {}");
  });

  it.each([
    ["output_text", { output_text: envelope({ ok: true }) }],
    ["outputText", { outputText: envelope({ ok: true }) }],
    [
      "legacy candidates",
      { candidates: [{ content: { parts: [{ text: envelope({ ok: true }) }] } }] },
    ],
  ])("preserves the %s Gemini response envelope", async (_name, providerResponse) => {
    const client = new GeminiModelClient({
      apiKey: "local-gemini-credential",
      model: "gemini-test",
      fetch: async () => Response.json(providerResponse),
    });

    await expect(client.generateStructured({
      purpose: "route",
      input: { prompt: "summarize" },
      idempotencyKey: "run:route",
    })).resolves.toEqual({ ok: true });
  });

  it("never forwards a provider error body or credential into workflow errors", async () => {
    const credential = "private-test-credential-value";
    const providerBody = `provider echoed ${credential}`;
    const client = new OpenAIModelClient({
      apiKey: credential,
      model: "gpt-test",
      fetch: async () => new Response(providerBody, { status: 401 }),
    });

    const error = await client.generateStructured({
      purpose: "route",
      input: {},
      idempotencyKey: "run:route",
    }).catch((failure: unknown) => failure as Error & { code: string });

    expect(error.code).toBe("MODEL_CREDENTIAL_REJECTED");
    expect(error.message).not.toContain(credential);
    expect(error.message).not.toContain(providerBody);
  });

  it("maps rate limits to a bounded retry hint without reading the response body", async () => {
    const client = new GeminiModelClient({
      apiKey: "local-gemini-credential",
      model: "gemini-test",
      fetch: async () => new Response("sensitive provider diagnostic", {
        status: 429,
        headers: { "retry-after": "2" },
      }),
    });

    const error = await client.generateStructured({
      purpose: "route",
      input: {},
      idempotencyKey: "run:rate-limit",
    }).catch((failure: unknown) => failure as Error & {
      code: string;
      retryable: boolean;
      retryAfterMs: number;
    });

    expect(error).toMatchObject({
      code: "MODEL_RATE_LIMITED",
      retryable: true,
      retryAfterMs: 2_000,
    });
    expect(error.message).not.toContain("sensitive provider diagnostic");
  });

  it("aborts provider I/O at the client deadline and emits a safe error", async () => {
    const credential = "credential-that-must-not-escape";
    const client = new OpenAIModelClient({
      apiKey: credential,
      model: "gpt-test",
      timeoutMs: 5,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error(`transport aborted for ${credential}`)),
          { once: true },
        );
      }),
    });

    const error = await client.generateStructured({
      purpose: "route",
      input: {},
      idempotencyKey: "run:timeout",
    }).catch((failure: unknown) => failure as Error & { code: string; retryable: boolean });

    expect(error).toMatchObject({ code: "MODEL_PROVIDER_TIMEOUT", retryable: true });
    expect(error.message).not.toContain(credential);
  });

  it("keeps the deterministic provider as the credential-free default", () => {
    const provider = createMorpheusProvider({
      mode: "demo",
      provider: "demo",
      model: "deterministic-v1",
      api_key: null,
    });
    expect(provider.providerId).toBe("demo:deterministic-v1");
  });

  it("resolves a run-pinned credential lazily and only once per server step", async () => {
    let resolutionCount = 0;
    const provider = createResolvingMorpheusProvider(
      async () => {
        resolutionCount += 1;
        return {
          mode: "byok" as const,
          provider: "openai" as const,
          model: "gpt-test",
          api_key: "local-provider-credential",
        };
      },
      async () => new Response(JSON.stringify({ output_text: envelope({ ok: true }) })),
    );

    expect(resolutionCount).toBe(0);
    const call = { idempotency_key: "run:route" } as never;
    await provider.routeAndPlan({} as never, call);
    await provider.routeAndPlan({} as never, call);
    expect(resolutionCount).toBe(1);
  });
});
