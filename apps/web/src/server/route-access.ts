const PRIVATE_PREFIXES = [
  "/admin",
  "/feedback",
  "/preview",
  "/sso-callback",
  "/templates",
  "/workspace",
  "/zalo-upload",
] as const;

export function isProtectedApplicationPath(pathname: string): boolean {
  // Published dashboard previews intentionally remain public and are
  // authorized by the API's preview policy. All other workspace routes are
  // invitation-only.
  if (pathname === "/workspace/project/preview") return false;
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
