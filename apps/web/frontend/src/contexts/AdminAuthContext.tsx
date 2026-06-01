import { useAuth, useUser, useClerk, useSignIn } from '@clerk/clerk-react';

interface AdminAuthInfo {
  isSignedIn: boolean;
  isAdmin: boolean;
  userEmail: string | null;
  userId: string | null;
  /** Returns a fresh Clerk JWT (Clerk caches internally, auto-refreshes on expiry) */
  getToken: () => Promise<string | null>;
  login: (identifier: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

/**
 * Hook to check admin authentication via Clerk.
 * Checks user.publicMetadata.role === "admin" for admin access.
 *
 * Exposes Clerk's `getToken()` directly — each API call should
 * call it to get a valid token. Clerk handles short-lived token
 * caching and automatic refresh internally.
 */
export function useAdminAuth(): AdminAuthInfo {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { signIn, setActive } = useSignIn();

  const isAdmin = !!(
    isSignedIn &&
    user &&
    (user.publicMetadata as Record<string, unknown>)?.role === 'admin'
  );

  const userEmail =
    user?.emailAddresses?.[0]?.emailAddress ?? null;

  return {
    isSignedIn: !!isSignedIn,
    isAdmin,
    userEmail,
    userId: user?.id ?? null,
    getToken,
    login: async (identifier: string, password: string) => {
      if (!signIn || !setActive) return false;
      const result = await signIn.create({ identifier, password });
      if (result.status !== 'complete' || !result.createdSessionId) return false;
      await setActive({ session: result.createdSessionId });
      return true;
    },
    signOut: () => signOut(),
  };
}
