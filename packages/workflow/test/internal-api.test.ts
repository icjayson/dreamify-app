import { describe, expect, it } from "vitest";

import {
  ApiSandboxCapacity,
  ApiWorkflowStore,
  InternalApiClient,
} from "../src/adapters/internal-api.js";

describe("internal workflow API adapter", () => {
  it("maps the API capacity contract to durable capacity backoff", async () => {
    const client = new InternalApiClient({
      baseUrl: "https://api.example.test",
      sharedSecret: "server-only-secret",
      requestId: "workflow-run-1.slice-2",
      fetch: async (url, init) => {
        expect(url).toBe("https://api.example.test/api/v1/internal/workflow/capacity/acquire");
        const headers = new Headers(init?.headers);
        expect(headers.get("x-internal-service-secret")).toBe(
          "server-only-secret",
        );
        expect(headers.get("x-request-id")).toBe("workflow-run-1.slice-2");
        expect(JSON.parse(String(init?.body))).toEqual({
          run_id: "run-1",
          idempotency_key: "run-1:capacity:profile",
        });
        return Response.json(
          { error: { code: "CAPACITY_UNAVAILABLE", message: "No slot" } },
          { status: 409 },
        );
      },
    });

    await expect(
      new ApiSandboxCapacity(client).acquire("run-1", "run-1:capacity:profile"),
    ).rejects.toMatchObject({
      code: "CAPACITY_BUSY",
      retryable: true,
      retryAfterMs: 15_000,
    });
  });

  it("rejects an unsafe request ID before making an internal request", () => {
    expect(
      () =>
        new InternalApiClient({
          baseUrl: "https://api.example.test",
          sharedSecret: "server-only-secret",
          requestId: "invalid\nheader",
        }),
    ).toThrow("requestId contains unsupported characters");
  });

  it("reserves a provider effect through the durable API", async () => {
    const client = new InternalApiClient({
      baseUrl: "https://api.example.test",
      sharedSecret: "server-only-secret",
      fetch: async (url, init) => {
        expect(url).toBe(
          "https://api.example.test/api/v1/internal/workflow/runs/run-1/provider-calls/reserve",
        );
        expect(JSON.parse(String(init?.body))).toEqual({ call_key: "route:attempt:1" });
        return Response.json({
          call_key: "route:attempt:1",
          ordinal: 1,
          remaining: 4,
          created: true,
        });
      },
    });

    expect(
      await new ApiWorkflowStore(client).reserveProviderCall("run-1", "route:attempt:1"),
    ).toEqual({ ordinal: 1, created: true });
  });

  it("authorizes and records a dispatch receipt through the durable API", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new InternalApiClient({
      baseUrl: "https://api.example.test",
      sharedSecret: "server-only-secret",
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return Response.json({
          outcome: requests.length === 1 ? "authorized" : "recorded",
          dispatch_lease_id: "lease-1",
          workflow_execution_id: requests.length === 1 ? null : "workflow-1",
        });
      },
    });

    expect(await client.authorizeDispatch("run-1", "lease-1")).toMatchObject({
      outcome: "authorized",
    });
    expect(
      await client.recordDispatchReceipt("run-1", "lease-1", "workflow-1"),
    ).toMatchObject({ outcome: "recorded", workflow_execution_id: "workflow-1" });
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/internal/workflow/runs/run-1/dispatch/authorize",
        body: { dispatch_lease_id: "lease-1" },
      },
      {
        url: "https://api.example.test/api/v1/internal/workflow/runs/run-1/dispatch/receipt",
        body: {
          dispatch_lease_id: "lease-1",
          workflow_execution_id: "workflow-1",
        },
      },
    ]);
  });
});
