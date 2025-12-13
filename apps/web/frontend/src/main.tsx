import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { BrowserRouter } from 'react-router-dom'
import { AdminAuthProvider } from '@/contexts/AdminAuthContext'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { apiClient } from '@/services/api'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Clerk Publishable Key")
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
      <ClerkProvider 
        publishableKey={PUBLISHABLE_KEY} 
        afterSignOutUrl="/"
        afterSignInUrl="/workspace"
      >
        <AdminAuthProvider>
          <TokenBridge />
          <App />
        </AdminAuthProvider>
      </ClerkProvider>
    </BrowserRouter>
  )
}

createRoot(document.getElementById("root")!).render(<AppWithRouter />);
