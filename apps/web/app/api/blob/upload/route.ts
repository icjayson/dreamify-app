import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import {
  isSafeBlobPathname,
  parseBlobUploadPayload,
  parseTokenValidation,
  uploadApiBaseUrl,
} from "@/server/blob-upload-contract";

export const runtime = "nodejs";
export const maxDuration = 30;

const validatePath = process.env.BLOB_TOKEN_VALIDATE_PATH ?? "/api/v1/uploads/blob-token/validate";
const completedPath = process.env.BLOB_UPLOAD_COMPLETED_PATH ?? "/api/v1/uploads/blob-completed";

function userHeaders(request: Request) {
  const authorization = request.headers.get("authorization");
  const demoUser = request.headers.get("x-demo-user");
  if (!authorization && !demoUser) throw new Error("Authentication is required to create an upload token");
  return {
    "Content-Type": "application/json",
    ...(authorization ? { Authorization: authorization } : {}),
    ...(demoUser ? { "X-Demo-User": demoUser } : {}),
  };
}

async function validateIntent(request: Request, pathname: string, clientPayload: string | null, multipart: boolean) {
  if (!isSafeBlobPathname(pathname)) throw new Error("Invalid Blob pathname");
  const payload = parseBlobUploadPayload(clientPayload);
  const response = await fetch(`${uploadApiBaseUrl()}${validatePath}`, {
    method: "POST",
    headers: userHeaders(request),
    body: JSON.stringify({ ...payload, pathname, multipart }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Upload intent validation failed (${response.status})`);
  return parseTokenValidation(await response.json(), pathname);
}

async function notifyCompleted(blob: { pathname: string; contentType: string }, tokenPayload?: string | null) {
  const secret = process.env.BLOB_GATEWAY_SHARED_SECRET;
  if (!secret) throw new Error("BLOB_GATEWAY_SHARED_SECRET is not configured");
  const payload = parseBlobUploadPayload(tokenPayload ?? null);
  if (!isSafeBlobPathname(blob.pathname)) throw new Error("Invalid completed Blob pathname");

  const response = await fetch(`${uploadApiBaseUrl()}${completedPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Blob-Gateway-Secret": secret },
    body: JSON.stringify({
      ...payload,
      pathname: blob.pathname,
      content_type: blob.contentType,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Upload finalization failed (${response.status})`);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        const validation = await validateIntent(request, pathname, clientPayload, multipart);
        return {
          allowedContentTypes: [validation.content_type],
          maximumSizeInBytes: validation.max_size_bytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            intent_id: validation.intent_id,
            client_request_id: validation.client_request_id,
            content_type: validation.content_type,
            size_bytes: validation.size_bytes,
            checksum_sha256: validation.checksum_sha256,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        await notifyCompleted(blob, tokenPayload);
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload gateway failed";
    const status = /Authentication is required/.test(message) ? 401 : /configured|failed \(5\d\d\)/.test(message) ? 503 : 400;
    return NextResponse.json({ code: "BLOB_UPLOAD_GATEWAY_ERROR", message }, { status });
  }
}
