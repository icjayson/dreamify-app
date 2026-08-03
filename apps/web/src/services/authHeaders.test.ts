import { afterEach, describe, expect, it, vi } from "vitest";

import { localDemoAuthHeaders } from "./authHeaders";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local demo authentication", () => {
  it("uses the canonical demo identity only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEMO_AUTH_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(localDemoAuthHeaders()).toEqual({ "X-Demo-User": "demo_user" });
  });

  it("fails closed in production or when Clerk is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_AUTH_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(localDemoAuthHeaders()).toEqual({});

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_configured");
    expect(localDemoAuthHeaders()).toEqual({});
  });
});
