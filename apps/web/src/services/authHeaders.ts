export function localDemoAuthIsEnabled(): boolean {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkIsConfigured = Boolean(clerkKey && /^pk_(test|live)_/.test(clerkKey));
  return (
    process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_DEMO_AUTH_MODE !== "false"
    && !clerkIsConfigured
  );
}

export function localDemoAuthHeaders(): Record<string, string> {
  return localDemoAuthIsEnabled() ? { "X-Demo-User": "demo_user" } : {};
}
