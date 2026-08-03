import { useCallback, useState } from 'react';
import { useUser } from '@/lib/clerk';

interface UseGoogleConnectorAuthOptions {
  /** The connector name for post-redirect auto-open (e.g. 'ga4', 'google-sheets') */
  connectorKey: string;
}

interface UseGoogleConnectorAuthReturn {
  /** Whether a Google account is linked to the user's Clerk profile */
  isGoogleLinked: boolean;
  /** Whether we're currently in the middle of an OAuth redirect flow */
  isAuthorizing: boolean;
  /** Error message if authorization failed */
  error: string | null;
  /**
   * Triggers a Google OAuth reauthorization flow to request additional scopes.
   * This redirects the browser to Google's consent screen.
   */
  requestScopes: (requiredScopes: string[]) => Promise<void>;
  /**
   * Checks if the given scopes are already approved on the Google external account.
   * Useful for connectors like Google Sheets where client-side APIs (Picker)
   * need the scope before any backend call can be made.
   * Note: approvedScopes can be stale — use backend errors as the primary check.
   */
  hasScopes: (requiredScopes: string[]) => boolean;
  /** Clear the error state */
  clearError: () => void;
}

/**
 * Hook that provides incremental Google OAuth authorization via Clerk.
 *
 * Flow:
 * 1. Modal opens → tries to load data from backend as usual
 * 2. If backend fails with a token/scope error → modal shows "Grant Access" button
 * 3. User clicks "Grant Access" → `requestScopes()` is called
 * 4. `reauthorize()` returns an ExternalAccount with a verification redirect URL
 * 5. We manually redirect to that URL (Google consent screen)
 * 6. After consent, Google redirects to /sso-callback → Clerk processes → redirects to final page
 * 7. Final page has ?connector= param → modal auto-opens → data loads
 */
export function useGoogleConnectorAuth({
  connectorKey,
}: UseGoogleConnectorAuthOptions): UseGoogleConnectorAuthReturn {
  const { user } = useUser();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const googleAccount = user?.externalAccounts?.find(
    (account) => (account.provider as string) === 'oauth_google' || (account.provider as string) === 'google'
  );

  const isGoogleLinked = !!googleAccount;

  const buildRedirectUrl = useCallback(() => {
    // After SSO callback completes, Clerk will redirect back to this URL
    const url = new URL(window.location.href);
    url.searchParams.set('connector', connectorKey);
    return url.pathname + url.search;
  }, [connectorKey]);

  const requestScopes = useCallback(
    async (requiredScopes: string[]): Promise<void> => {
      if (!user) {
        setError('User not loaded. Please try again.');
        return;
      }

      setIsAuthorizing(true);
      setError(null);

      try {
        const redirectUrl = buildRedirectUrl();

        if (googleAccount) {
          // Merge existing approved scopes with new ones so we don't lose
          // previously-granted permissions. Google issues a new token on each
          // reauthorize() containing ONLY what we ask for — so we must always
          // include the scopes that are already approved.
          const existingScopes: string = (googleAccount as any).approvedScopes ?? '';
          const existingSet = new Set(existingScopes.split(' ').filter(Boolean));
          requiredScopes.forEach((s) => existingSet.add(s));
          const mergedScopes = Array.from(existingSet);

          // oidcPrompt: 'consent' forces Google to show the consent screen
          // so the user can see and approve the new permissions
          const updatedAccount = await (googleAccount as any).reauthorize({
            additionalScopes: mergedScopes,
            redirectUrl,
            oidcPrompt: 'consent',
          });

          // reauthorize() returns an ExternalAccountResource with a verification object
          // We need to manually redirect to the externalVerificationRedirectURL
          const verificationUrl = updatedAccount?.verification?.externalVerificationRedirectURL;
          if (verificationUrl) {
            const finalUrl = new URL(verificationUrl.toString());
            finalUrl.searchParams.set('prompt', 'consent');
            window.location.href = finalUrl.toString();
            return; // Page will navigate away
          }

          // If no redirect URL (scopes already granted?), just reload user
          await user.reload();
        } else {
          // No Google account linked — create one with the required scopes
          const newAccount = await user.createExternalAccount({
            strategy: 'oauth_google',
            additionalScopes: requiredScopes,
            redirectUrl,
          });

          // Same pattern: check for verification redirect URL
          const verificationUrl = (newAccount as any)?.verification?.externalVerificationRedirectURL;
          if (verificationUrl) {
            window.location.href = verificationUrl.toString();
            return;
          }

          await user.reload();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to request Google permissions.';
        setError(message);
      } finally {
        setIsAuthorizing(false);
      }
    },
    [user, googleAccount, buildRedirectUrl],
  );

  const hasScopes = useCallback(
    (requiredScopes: string[]): boolean => {
      if (!googleAccount) return false;
      const approvedScopes: string = (googleAccount as any).approvedScopes ?? '';
      const approvedSet = new Set(approvedScopes.split(' ').filter(Boolean));
      return requiredScopes.every((scope) => approvedSet.has(scope));
    },
    [googleAccount],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    isGoogleLinked,
    isAuthorizing,
    error,
    requestScopes,
    hasScopes,
    clearError,
  };
}
