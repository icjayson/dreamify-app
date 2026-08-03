/**
 * Sanitizes raw API error messages into user-friendly text.
 * Prevents leaking internal API details (JSON, stack traces, etc.) to users.
 */

const TOKEN_ERROR_PATTERNS = [
  /expired/i,
  /not found/i,
  /reconnect/i,
  /oauth/i,
  /revoked/i,
  /permissions/i,
  /unauthorized/i,
  /insufficient/i,
  /scope/i,
  /access.token/i,
  /PERMISSION_DENIED/i,
];

/**
 * Returns true if the error message indicates a token/scope/auth issue
 * that can be resolved by re-granting OAuth permissions.
 */
export function isOAuthScopeError(errorMessage: string): boolean {
  return TOKEN_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

/**
 * Converts a raw API error into a short, user-friendly message.
 * If the error is an OAuth/scope issue, returns a permission-specific message.
 * Otherwise returns a generic fallback.
 */
export function sanitizeConnectorError(
  rawError: string,
  connectorName: string = 'this service',
): string {
  if (isOAuthScopeError(rawError)) {
    return `Your Google account doesn't have the required permissions for ${connectorName}. Please grant access below.`;
  }

  // Generic non-token errors — keep it short and vague
  // Log the raw error for debugging
  console.warn(`[Connector Error] ${connectorName}:`, rawError);

  if (/network|timeout|fetch|ECONNREFUSED/i.test(rawError)) {
    return 'A network error occurred. Please check your connection and try again.';
  }

  if (/rate.limit|too many requests|429/i.test(rawError)) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  return `Something went wrong while connecting to ${connectorName}. Please try again.`;
}
