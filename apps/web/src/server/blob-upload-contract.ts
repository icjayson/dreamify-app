export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "text/csv",
  "application/csv",
  "text/plain",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export interface BlobUploadClientPayload {
  intent_id: string;
  client_request_id: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256?: string;
}

export interface BlobTokenValidation extends BlobUploadClientPayload {
  valid: true;
  pathname: string;
  max_size_bytes: number;
}

const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;
const checksumPattern = /^[a-fA-F0-9]{64}$/;

export function isSafeBlobPathname(pathname: string) {
  if (!pathname.startsWith("uploads/") || pathname.length > 512) return false;
  if (pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("..")) return false;
  try {
    return decodeURIComponent(pathname) === pathname || !decodeURIComponent(pathname).includes("/");
  } catch {
    return false;
  }
}

export function parseBlobUploadPayload(clientPayload: string | null): BlobUploadClientPayload {
  if (!clientPayload) throw new Error("Missing upload intent payload");
  let input: unknown;
  try {
    input = JSON.parse(clientPayload);
  } catch {
    throw new Error("Invalid upload intent payload");
  }
  if (!input || typeof input !== "object") throw new Error("Invalid upload intent payload");

  const value = input as Record<string, unknown>;
  const intentId = String(value.intent_id ?? "");
  const requestId = String(value.client_request_id ?? "");
  const contentType = String(value.content_type ?? "").toLowerCase();
  const sizeBytes = Number(value.size_bytes);
  const checksum = value.checksum_sha256 == null ? undefined : String(value.checksum_sha256);

  if (!identifierPattern.test(intentId) || !identifierPattern.test(requestId)) throw new Error("Invalid upload intent identifiers");
  if (!(ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType)) throw new Error("Unsupported upload content type");
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) throw new Error("Upload exceeds the 10 MiB preview limit");
  if (checksum && !checksumPattern.test(checksum)) throw new Error("Invalid SHA-256 checksum");

  return {
    intent_id: intentId,
    client_request_id: requestId,
    content_type: contentType,
    size_bytes: sizeBytes,
    ...(checksum ? { checksum_sha256: checksum.toLowerCase() } : {}),
  };
}

export function parseTokenValidation(input: unknown, expectedPathname: string): BlobTokenValidation {
  if (!input || typeof input !== "object") throw new Error("Invalid upload validation response");
  const value = input as Record<string, unknown>;
  const parsed = parseBlobUploadPayload(JSON.stringify(value));
  const pathname = String(value.pathname ?? "");
  const maximum = Number(value.max_size_bytes);

  if (value.valid !== true || pathname !== expectedPathname || !isSafeBlobPathname(pathname)) {
    throw new Error("Upload intent does not authorize this pathname");
  }
  if (!Number.isInteger(maximum) || maximum <= 0 || maximum > MAX_UPLOAD_BYTES || parsed.size_bytes > maximum) {
    throw new Error("Invalid upload size authorization");
  }
  return { ...parsed, valid: true, pathname, max_size_bytes: maximum };
}

export function uploadApiBaseUrl() {
  const value = process.env.DREAMIFY_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!value) throw new Error("DREAMIFY_API_URL is not configured");
  return value.replace(/\/$/, "");
}
