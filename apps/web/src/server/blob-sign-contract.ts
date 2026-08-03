import { createHash, timingSafeEqual } from "node:crypto";

import { isSafeBlobPathname } from "./blob-upload-contract";

export const MAX_SIGNED_ACCESS_SECONDS = 15 * 60;

export interface BlobSignRequest {
  pathname: string;
  operation: "get";
  valid_for_seconds: number;
}

export function parseBlobSignRequest(input: unknown): BlobSignRequest {
  if (!input || typeof input !== "object") throw new Error("Invalid signing request");
  const value = input as Record<string, unknown>;
  const pathname = typeof value.pathname === "string" ? value.pathname : "";
  const duration = Number(value.valid_for_seconds);

  if (value.operation !== "get") throw new Error("Only private GET access can be signed");
  if (!isSafeBlobPathname(pathname)) throw new Error("Invalid private Blob pathname");
  if (!Number.isInteger(duration) || duration <= 0 || duration > MAX_SIGNED_ACCESS_SECONDS) {
    throw new Error("Signed access must expire within 900 seconds");
  }
  return { pathname, operation: "get", valid_for_seconds: duration };
}

export function gatewaySecretMatches(provided: string | null, expected: string | undefined) {
  if (!provided || !expected) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
