import { describe, expect, it } from "vitest";

import {
  MAX_UPLOAD_BYTES,
  isSafeBlobPathname,
  parseBlobUploadPayload,
  parseTokenValidation,
} from "./blob-upload-contract";

const payload = {
  intent_id: "intent_123",
  client_request_id: "request_123",
  content_type: "text/csv",
  size_bytes: 1024,
  checksum_sha256: "a".repeat(64),
};

describe("Blob upload gateway contract", () => {
  it("accepts a bounded file payload and exact authorized pathname", () => {
    const pathname = "uploads/demo/intent_123/data.csv";
    expect(parseBlobUploadPayload(JSON.stringify(payload))).toEqual(payload);
    expect(parseTokenValidation({ ...payload, valid: true, pathname, max_size_bytes: MAX_UPLOAD_BYTES }, pathname).pathname).toBe(pathname);
  });

  it("rejects traversal and oversized uploads", () => {
    expect(isSafeBlobPathname("uploads/demo/../secret.csv")).toBe(false);
    expect(() => parseBlobUploadPayload(JSON.stringify({ ...payload, size_bytes: MAX_UPLOAD_BYTES + 1 }))).toThrow(/10 MiB/);
  });

  it("rejects a validation response for a different pathname", () => {
    expect(() => parseTokenValidation({ ...payload, valid: true, pathname: "uploads/other.csv", max_size_bytes: MAX_UPLOAD_BYTES }, "uploads/data.csv")).toThrow(/authorize/);
  });
});
