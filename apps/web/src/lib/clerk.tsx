"use client";

import * as Clerk from "@clerk/nextjs";
import React, { createContext, useContext, useMemo, useState } from "react";

export type AuthMode = "clerk" | "demo" | "unconfigured";

interface DreamifyEmailAddress {
  id: string;
  emailAddress: string;
  verification?: { status?: string } | null;
  destroy: () => Promise<unknown>;
  prepareVerification?: (...args: unknown[]) => Promise<unknown>;
}

interface DreamifyExternalAccount {
  id: string;
  provider: string;
  emailAddress?: string | null;
  approvedScopes?: string;
  verification?: { externalVerificationRedirectURL?: URL | string | null } | null;
  destroy: () => Promise<unknown>;
  reauthorize?: (options: Record<string, unknown>) => Promise<DreamifyExternalAccount>;
}

interface DreamifyUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  username: string | null;
  imageUrl: string;
  primaryEmailAddressId: string | null;
  primaryEmailAddress: DreamifyEmailAddress | null;
  emailAddresses: DreamifyEmailAddress[];
  externalAccounts: DreamifyExternalAccount[];
  publicMetadata: Record<string, unknown>;
  update: (value: Record<string, unknown>) => Promise<DreamifyUser>;
  updatePassword: (value: { newPassword: string }) => Promise<unknown>;
  setProfileImage: (value: { file: File }) => Promise<unknown>;
  createEmailAddress: (value: { email: string }) => Promise<DreamifyEmailAddress>;
  createExternalAccount: (value: Record<string, unknown>) => Promise<DreamifyExternalAccount>;
  reload: () => Promise<unknown>;
  delete: () => Promise<unknown>;
}

interface DreamifySession {
  id: string;
  status?: string;
  lastActiveAt?: Date | null;
  end?: () => Promise<unknown>;
  revoke?: () => Promise<unknown>;
}

interface DreamifySignIn {
  create: (value: Record<string, unknown>) => Promise<{
    status?: string;
    createdSessionId?: string | null;
  }>;
}

interface AuthContextValue {
  mode: AuthMode;
  isLoaded: boolean;
  isSignedIn: boolean;
  user: DreamifyUser | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  signIn: DreamifySignIn | null;
  setActive: ((value: { session: string }) => Promise<unknown>) | null;
  session: DreamifySession | null;
  sessions: DreamifySession[];
  signInDemo: () => void;
}

const noop = async () => undefined;

const createDemoUser = (): DreamifyUser => {
  const email: DreamifyEmailAddress = {
    id: "demo_email",
    emailAddress: "demo@dreamify.local",
    verification: { status: "verified" },
    destroy: noop,
    prepareVerification: noop,
  };
  const externalAccount: DreamifyExternalAccount = {
    id: "demo_external",
    provider: "demo",
    emailAddress: email.emailAddress,
    destroy: noop,
    reauthorize: async () => externalAccount,
  };
  return {
    id: "demo_user",
    firstName: "Dreamify",
    lastName: "Demo",
    fullName: "Dreamify Demo",
    username: "dreamify-demo",
    imageUrl: "/logo-favicon.png",
    primaryEmailAddressId: email.id,
    primaryEmailAddress: email,
    emailAddresses: [email],
    externalAccounts: [],
    publicMetadata: { role: "user", profile: "hobby_demo" },
    update: async (value: Record<string, unknown>) => ({ ...createDemoUser(), ...value } as DreamifyUser),
    updatePassword: noop,
    setProfileImage: noop,
    createEmailAddress: async ({ email: nextEmail }: { email: string }) => ({ ...email, emailAddress: nextEmail }),
    createExternalAccount: async () => externalAccount,
    reload: noop,
    delete: noop,
  };
};

const AuthContext = createContext<AuthContextValue | null>(null);

function ClerkBridge({ children }: { children: React.ReactNode }) {
  const auth = Clerk.useAuth() as any;
  const userState = Clerk.useUser() as any;
  const clerk = Clerk.useClerk() as any;
  const signInState = Clerk.useSignIn() as any;
  const sessionState = Clerk.useSession() as any;
  const sessionList = Clerk.useSessionList() as any;
  const value = useMemo<AuthContextValue>(() => ({
    mode: "clerk",
    isLoaded: Boolean(auth.isLoaded && userState.isLoaded),
    isSignedIn: Boolean(auth.isSignedIn),
    user: (userState.user ?? null) as DreamifyUser | null,
    getToken: auth.getToken as () => Promise<string | null>,
    signOut: clerk.signOut as () => Promise<void>,
    signIn: (signInState.signIn ?? null) as DreamifySignIn | null,
    setActive: (signInState.setActive ?? null) as AuthContextValue["setActive"],
    session: (sessionState.session ?? null) as DreamifySession | null,
    sessions: (sessionList.sessions ?? []) as DreamifySession[],
    signInDemo: () => undefined,
  }), [auth, userState, clerk, signInState, sessionState, sessionList]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function DemoBridge({ children }: { children: React.ReactNode }) {
  const [isSignedIn, setSignedIn] = useState(true);
  const user = useMemo(createDemoUser, []);
  const demoSession = useMemo<DreamifySession>(() => ({ id: "demo_session", status: "active", lastActiveAt: new Date(), revoke: noop }), []);
  const value = useMemo<AuthContextValue>(() => ({
    mode: "demo",
    isLoaded: true,
    isSignedIn,
    user: isSignedIn ? user : null,
    getToken: async () => null,
    signOut: async () => setSignedIn(false),
    signIn: {
      create: async () => ({ status: "complete", createdSessionId: demoSession.id }),
    },
    setActive: async () => setSignedIn(true),
    session: isSignedIn ? demoSession : null,
    sessions: isSignedIn ? [demoSession] : [],
    signInDemo: () => setSignedIn(true),
  }), [demoSession, isSignedIn, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function UnconfiguredBridge({ children }: { children: React.ReactNode }) {
  const value = useMemo<AuthContextValue>(() => ({
    mode: "unconfigured",
    isLoaded: true,
    isSignedIn: false,
    user: null,
    getToken: async () => null,
    signOut: noop,
    signIn: null,
    setActive: null,
    session: null,
    sessions: [],
    signInDemo: () => undefined,
  }), []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function resolveAuthMode(
  publishableKey: string | undefined,
  nodeEnv: string | undefined,
  demoAuthMode: string | undefined,
): AuthMode {
  if (publishableKey && /^pk_(test|live)_/.test(publishableKey)) return "clerk";
  if (nodeEnv !== "production" && demoAuthMode !== "false") return "demo";
  return "unconfigured";
}

export function DreamifyAuthProvider({ children }: { children: React.ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const mode = resolveAuthMode(
    publishableKey,
    process.env.NODE_ENV,
    process.env.NEXT_PUBLIC_DEMO_AUTH_MODE,
  );
  if (mode === "demo") return <DemoBridge>{children}</DemoBridge>;
  if (mode === "unconfigured") {
    return <UnconfiguredBridge>{children}</UnconfiguredBridge>;
  }

  return (
    <Clerk.ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/workspace"
      signUpFallbackRedirectUrl="/workspace"
    >
      <ClerkBridge>{children}</ClerkBridge>
    </Clerk.ClerkProvider>
  );
}

function useDreamifyAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Dreamify auth hooks must be used inside DreamifyAuthProvider");
  return value;
}

export const useAuth = () => {
  const value = useDreamifyAuth();
  return { isLoaded: value.isLoaded, isSignedIn: value.isSignedIn, userId: value.user?.id ?? null, getToken: value.getToken };
};

export const useUser = () => {
  const value = useDreamifyAuth();
  return { isLoaded: value.isLoaded, isSignedIn: value.isSignedIn, user: value.user };
};

export const useClerk = () => {
  const value = useDreamifyAuth();
  return { signOut: value.signOut, user: value.user };
};

export const useSignIn = () => {
  const value = useDreamifyAuth();
  return { isLoaded: value.isLoaded, signIn: value.signIn, setActive: value.setActive };
};

export const useSession = () => {
  const value = useDreamifyAuth();
  return { isLoaded: value.isLoaded, session: value.session };
};

export const useSessionList = () => {
  const value = useDreamifyAuth();
  return { isLoaded: value.isLoaded, sessions: value.sessions };
};

export function SignedIn({ children }: { children: React.ReactNode }) {
  return useDreamifyAuth().isSignedIn ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  return useDreamifyAuth().isSignedIn ? null : <>{children}</>;
}

function DemoAuthCard({ title }: { title: string }) {
  const { mode, signInDemo } = useDreamifyAuth();
  const isLocalDemo = mode === "demo";
  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-background/90 p-8 text-center shadow-xl">
      <img src="/logo-horizon-dark.png" alt="Dreamify" className="mx-auto mb-5 h-10 w-auto dark:hidden" />
      <img src="/logo-horizon.png" alt="Dreamify" className="mx-auto mb-5 hidden h-10 w-auto dark:block" />
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {isLocalDemo
          ? "Clerk is not configured, so local development is using the isolated demo identity."
          : "Authentication is not configured for this deployment. The operator must connect the invite-only Clerk application before access can be granted."}
      </p>
      {isLocalDemo && (
        <button type="button" className="button-gradient mt-6 w-full rounded-lg px-4 py-3 font-medium" onClick={signInDemo}>
          Continue to Free Preview
        </button>
      )}
    </div>
  );
}

function OptionalClerkComponent({ name, fallback, props }: { name: string; fallback: React.ReactNode; props: any }) {
  const { mode } = useDreamifyAuth();
  if (mode !== "clerk") return <>{fallback}</>;
  const Component = (Clerk as any)[name] as React.ComponentType<any> | undefined;
  return Component ? <Component {...props} /> : <>{fallback}</>;
}

export const SignIn = (props: any) => <OptionalClerkComponent name="SignIn" props={props} fallback={<DemoAuthCard title="Welcome back" />} />;
export const SignUp = (props: any) => <OptionalClerkComponent name="SignUp" props={props} fallback={<DemoAuthCard title="Join the preview" />} />;
export const Waitlist = (props: any) => <OptionalClerkComponent name="Waitlist" props={props} fallback={<DemoAuthCard title="Free Preview" />} />;
export const UserProfile = (props: any) => <OptionalClerkComponent name="UserProfile" props={props} fallback={<DemoAuthCard title="Demo profile" />} />;
export const AuthenticateWithRedirectCallback = (props: any) => <OptionalClerkComponent name="AuthenticateWithRedirectCallback" props={props} fallback={<DemoAuthCard title="Free Preview" />} />;
