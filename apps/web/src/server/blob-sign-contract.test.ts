import { describe, expect, it } from "vitest";

import {
  MAX_SIGNED_ACCESS_SECONDS,
  gatewaySecretMatches,
  parseBlobSignRequest,
} from "./blob-sign-contract";

describe("private Blob signing contract", () => {
  it("accepts exact-path GET access for at most 15 minutes", () => {
    expect(parseBlobSignRequest({
      pathname: "uploads/owner/run/data.csv",
      operation: "get",
      valid_for_seconds: MAX_SIGNED_ACCESS_SECONDS,
    })).toEqual({
      pathname: "uploads/owner/run/data.csv",
      operation: "get",
      valid_for_seconds: 900,
    });
  });

  it("rejects write operations, traversal, and overlong access", () => {
    expect(() => parseBlobSignRequest({ pathname: "uploads/a.csv", operation: "put", valid_for_seconds: 900 })).toThrow(/GET/);
    expect(() => parseBlobSignRequest({ pathname: "uploads/../a.csv", operation: "get", valid_for_seconds: 900 })).toThrow(/pathname/);
    expect(() => parseBlobSignRequest({ pathname: "uploads/a.csv", operation: "get", valid_for_seconds: 901 })).toThrow(/900/);
  });

  it("authenticates only the exact configured gateway secret", () => {
    expect(gatewaySecretMatches("service-secret", "service-secret")).toBe(true);
    expect(gatewaySecretMatches("wrong", "service-secret")).toBe(false);
    expect(gatewaySecretMatches(null, "service-secret")).toBe(false);
  });
});
