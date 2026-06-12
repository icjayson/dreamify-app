import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { apiClient } from '@/services/api'
import ReactGA from 'react-ga4';

// Apply theme class before React mounts to prevent flash
try {
  const theme = localStorage.getItem('dreamify-theme') || 'light';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = theme === 'dark' || (theme === 'system' && prefersDark) ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.classList.toggle('light', resolved === 'light');
} catch {
  // localStorage may be unavailable in restricted contexts
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Clerk Publishable Key")
}

const CLERK_SIGN_IN_FORCE_REDIRECT_URL = import.meta.env.VITE_CLERK_SIGN_IN_FORCE_REDIRECT_URL ?? "/workspace";
const CLERK_SIGN_UP_FORCE_REDIRECT_URL = import.meta.env.VITE_CLERK_SIGN_UP_FORCE_REDIRECT_URL ?? "/workspace";
const CLERK_SIGN_IN_FALLBACK_REDIRECT_URL = import.meta.env.VITE_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ?? "/workspace";
const CLERK_SIGN_UP_FALLBACK_REDIRECT_URL = import.meta.env.VITE_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ?? "/workspace";

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_ID;
if (GA_MEASUREMENT_ID) {
  ReactGA.initialize(GA_MEASUREMENT_ID);
}

const AppWithRouter = () => {
  const TokenBridge = () => {
    const { getToken } = useAuth();
    // Update token provider on each render to ensure latest function is used
    apiClient.setAuthTokenProvider(async () => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    });
    return null;
  };

  return (
    <BrowserRouter>
      <HelmetProvider>
        <ClerkProvider
          publishableKey={PUBLISHABLE_KEY}
          afterSignOutUrl="/"
          signInForceRedirectUrl={CLERK_SIGN_IN_FORCE_REDIRECT_URL}
          signUpForceRedirectUrl={CLERK_SIGN_UP_FORCE_REDIRECT_URL}
          signInFallbackRedirectUrl={CLERK_SIGN_IN_FALLBACK_REDIRECT_URL}
          signUpFallbackRedirectUrl={CLERK_SIGN_UP_FALLBACK_REDIRECT_URL}
        >
          <TokenBridge />
            <App />
        </ClerkProvider>
      </HelmetProvider>
    </BrowserRouter>
  )
}

createRoot(document.getElementById("root")!).render(<AppWithRouter />);
