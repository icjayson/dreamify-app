import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";

import { gatewaySecretMatches, parseBlobSignRequest } from "@/server/blob-sign-contract";

export const runtime = "nodejs";
export const maxDuration = 10;
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ code, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const expectedSecret = process.env.BLOB_GATEWAY_SHARED_SECRET;
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!expectedSecret || !token) {
    return errorResponse("BLOB_SIGNING_NOT_CONFIGURED", "Private object signing is unavailable", 503);
  }
  if (!gatewaySecretMatches(request.headers.get("x-blob-gateway-secret"), expectedSecret)) {
    return errorResponse("BLOB_SIGN_UNAUTHORIZED", "Service authentication is required", 401);
  }

  let payload;
  try {
    payload = parseBlobSignRequest(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signing request";
    return errorResponse("BLOB_SIGN_REQUEST_INVALID", message, 400);
  }

  try {
    const requestedExpiry = Date.now() + payload.valid_for_seconds * 1000;
    const signedToken = await issueSignedToken({
      pathname: payload.pathname,
      operations: ["get"],
      validUntil: requestedExpiry,
      token,
    });
    const expiresAt = Math.min(requestedExpiry, signedToken.validUntil);
    const { presignedUrl } = await presignUrl(signedToken, {
      access: "private",
      operation: "get",
      pathname: payload.pathname,
      validUntil: expiresAt,
    });
    return NextResponse.json(
      { url: presignedUrl, expires_at: new Date(expiresAt).toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return errorResponse("BLOB_SIGN_FAILED", "Private object signing failed", 502);
  }
}
