import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'
import { BrowserRouter } from 'react-router-dom'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Clerk Publishable Key")
}

const AppWithRouter = () => {
  return (
    <BrowserRouter>
      <ClerkProvider 
        publishableKey={PUBLISHABLE_KEY} 
        afterSignOutUrl="/"
        afterSignInUrl="/workspace"
      >
        <App />
      </ClerkProvider>
    </BrowserRouter>
  )
}

createRoot(document.getElementById("root")!).render(<AppWithRouter />);
