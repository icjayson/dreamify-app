import { describe, expect, it } from "vitest";

import { resolveAuthMode } from "./clerk";

describe("Dreamify auth mode", () => {
  it("uses Clerk when a publishable key is configured", () => {
    expect(resolveAuthMode("pk_test_example", "production", undefined)).toBe("clerk");
  });

  it("permits the deterministic identity only outside production", () => {
    expect(resolveAuthMode(undefined, "development", undefined)).toBe("demo");
    expect(resolveAuthMode(undefined, "test", "true")).toBe("demo");
    expect(resolveAuthMode(undefined, "development", "false")).toBe("unconfigured");
  });

  it("fails closed when production Clerk configuration is missing", () => {
    expect(resolveAuthMode(undefined, "production", "true")).toBe("unconfigured");
    expect(resolveAuthMode("invalid", "production", undefined)).toBe("unconfigured");
  });
});
