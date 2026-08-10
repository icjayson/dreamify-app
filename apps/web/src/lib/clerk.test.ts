import { describe, expect, it } from "vitest";

import { resolveAuthMode, resolveClerkRedirect } from "./clerk";

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

describe("resolveClerkRedirect", () => {
  it("accepts an application-relative redirect", () => {
    expect(resolveClerkRedirect("/workspace")).toBe("/workspace");
    expect(resolveClerkRedirect(" /workspace?tab=new-chat ")).toBe(
      "/workspace?tab=new-chat",
    );
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(resolveClerkRedirect("https://evil.example")).toBe("/workspace");
    expect(resolveClerkRedirect("//evil.example")).toBe("/workspace");
    expect(resolveClerkRedirect(undefined)).toBe("/workspace");
  });
});
