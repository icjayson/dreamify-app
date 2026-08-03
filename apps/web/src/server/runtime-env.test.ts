import { describe, expect, it } from "vitest";

import {
  HostedWebEnvironmentError,
  assertHostedWebEnvironment,
} from "./runtime-env";

function clerkSecretKey(mode: "test" | "live"): string {
  return ["s", "k", `_${mode}_`, "fixturekey123456"].join("");
}

const VALID_HOSTED_ENVIRONMENT = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://dreamify-web.vercel.app",
  NEXT_PUBLIC_API_URL: "https://dreamify-api.vercel.app",
  DREAMIFY_API_URL: "https://dreamify-api.vercel.app",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_publickey123456",
  CLERK_SECRET_KEY: clerkSecretKey("test"),
  NEXT_PUBLIC_DEMO_AUTH_MODE: "false",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_token_material_123456",
  BLOB_GATEWAY_SHARED_SECRET: "blob-gateway-secret-material-1234567890",
  INTERNAL_SERVICE_SHARED_SECRET: "workflow-secret-material-123456789012",
  SANDBOX_SNAPSHOT_ID: "snap_123456789",
} as const;

function hostedEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { ...VALID_HOSTED_ENVIRONMENT, ...overrides };
}

describe("hosted web environment preflight", () => {
  it("does not impose hosted credentials on a local production build", () => {
    expect(() => assertHostedWebEnvironment({ NODE_ENV: "production" })).not.toThrow();
  });

  it.each(["production", "preview"])(
    "accepts a complete %s Vercel environment",
    (vercelEnvironment) => {
      expect(() =>
        assertHostedWebEnvironment(
          hostedEnvironment({ VERCEL_ENV: vercelEnvironment }),
        ),
      ).not.toThrow();
    },
  );

  it.each([
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_API_URL",
    "DREAMIFY_API_URL",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_DEMO_AUTH_MODE",
    "BLOB_GATEWAY_SHARED_SECRET",
    "INTERNAL_SERVICE_SHARED_SECRET",
    "SANDBOX_SNAPSHOT_ID",
  ])("rejects a hosted deployment missing %s", (name) => {
    expect(() =>
      assertHostedWebEnvironment(hostedEnvironment({ [name]: undefined })),
    ).toThrow(HostedWebEnvironmentError);
  });

  it("requires one private Blob token variable", () => {
    expect(() =>
      assertHostedWebEnvironment(
        hostedEnvironment({
          BLOB_READ_WRITE_TOKEN: undefined,
          BLOB_PRIVATE_READ_WRITE_TOKEN: undefined,
        }),
      ),
    ).toThrow(/Blob read\/write token/);

    expect(() =>
      assertHostedWebEnvironment(
        hostedEnvironment({
          BLOB_READ_WRITE_TOKEN: undefined,
          BLOB_PRIVATE_READ_WRITE_TOKEN: "private_blob_token_material_123456",
        }),
      ),
    ).not.toThrow();
  });

  it("uses a stable operator-facing error code", () => {
    expect(() =>
      assertHostedWebEnvironment(
        hostedEnvironment({ NEXT_PUBLIC_SITE_URL: undefined }),
      ),
    ).toThrow(/WEB_ENV_INVALID/);
  });

  it.each([
    [{ NEXT_PUBLIC_SITE_URL: "http://dreamify-web.vercel.app" }, /HTTPS origin/],
    [{ DREAMIFY_API_URL: "https://other-api.vercel.app" }, /same API origin/],
    [{ NEXT_PUBLIC_DEMO_AUTH_MODE: "true" }, /NEXT_PUBLIC_DEMO_AUTH_MODE/],
    [{ SANDBOX_SNAPSHOT_ID: "sandbox-latest" }, /Sandbox snapshot ID/],
    [
      { CLERK_SECRET_KEY: clerkSecretKey("live") },
      /same Clerk instance mode/,
    ],
    [
      {
        INTERNAL_SERVICE_SHARED_SECRET:
          VALID_HOSTED_ENVIRONMENT.BLOB_GATEWAY_SHARED_SECRET,
      },
      /generated independently/,
    ],
  ] as const)("rejects an unsafe hosted configuration", (overrides, message) => {
    expect(() =>
      assertHostedWebEnvironment(hostedEnvironment({ ...overrides })),
    ).toThrow(message);
  });

  it("redacts credential values from validation errors", () => {
    const leakedCandidate = "replace-with-a-real-secret-value-123456789";
    try {
      assertHostedWebEnvironment(
        hostedEnvironment({ BLOB_GATEWAY_SHARED_SECRET: leakedCandidate }),
      );
      throw new Error("Expected preflight to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostedWebEnvironmentError);
      expect(String(error)).not.toContain(leakedCandidate);
    }
  });
});
