import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

/**
 * Handles the OAuth SSO callback after Google consent.
 *
 * Clerk's <AuthenticateWithRedirectCallback /> processes the OAuth state
 * (exchange code for token, update external account, etc.).
 *
 * After that completes, we check the URL fragment for a final redirect
 * destination (set by useGoogleConnectorAuth) and navigate there.
 */
export default function SSOCallbackPage() {
  const navigate = useNavigate();
  const [callbackDone, setCallbackDone] = useState(false);

  useEffect(() => {
    if (callbackDone) {
      // Extract the final destination from the URL hash
      const hash = window.location.hash;
      const match = hash.match(/\/redirect=([^&]+)/);
      if (match) {
        const finalDest = decodeURIComponent(match[1]);
        navigate(finalDest, { replace: true });
      } else {
        // Fallback: go to workspace
        navigate('/workspace', { replace: true });
      }
    }
  }, [callbackDone, navigate]);

  return (
    <AuthenticateWithRedirectCallback
      afterSignInUrl="/workspace"
      afterSignUpUrl="/workspace"
    />
  );
}
