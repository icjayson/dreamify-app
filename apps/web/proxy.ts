import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isProtectedApplicationPath } from "@/server/route-access";
import { assertHostedWebEnvironment } from "@/server/runtime-env";

const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (isProtectedApplicationPath(request.nextUrl.pathname)) {
    await auth.protect();
  }
});

function clerkIsConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

function localDemoIsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DEMO_AUTH_MODE !== "false"
  );
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  assertHostedWebEnvironment();
  if (localDemoIsEnabled()) return NextResponse.next();
  if (clerkIsConfigured()) return clerkProxy(request, event);
  if (!isProtectedApplicationPath(request.nextUrl.pathname)) return NextResponse.next();

  const signIn = new URL("/login", request.url);
  signIn.searchParams.set(
    "redirect_url",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|woff2?)$).*)",
  ],
};
