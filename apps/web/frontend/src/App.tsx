import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, useLocation } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import Header from "./components/homepage-section/Header";
import AboutPage from "./pages/About";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import WorkspacePage from "./pages/workspace";
import ProjectPage from "./pages/project";
import PreviewPage from "./pages/preview.tsx";
import WaitlistPage from "./pages/Waitlist.tsx";
import SuccessPage from "./pages/SuccessPage";
import CancelPage from "./pages/CancelPage";
import { useChatStore } from "./chat/useChatStore";

const queryClient = new QueryClient();

// Initialize Stripe
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

const AppContent = () => {
  const { messages } = useChatStore();
  const isStarted = messages.length > 1; // Check if user has started chatting
  const location = useLocation();
  const isAuthPath = location.pathname === "/login" || location.pathname === "/signup";
  const isWorkspacePath = location.pathname.startsWith("/workspace");
  const isHomePath = location.pathname === "/";
  const isAboutPath = location.pathname === "/about";

  return (
    <>
      {(isHomePath || isAboutPath || (!isStarted && !isAuthPath && !isWorkspacePath)) && <Header />}
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
        <Route path="/workspace" element={
          <SignedIn>
            <WorkspacePage />
          </SignedIn>
        } />
        <Route path="/workspace/project" element={
          <SignedIn>
            <ProjectPage />
          </SignedIn>
        } />
        <Route path="/workspace/project/preview" element={
          <SignedIn>
            <PreviewPage />
          </SignedIn>
        } />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/cancel" element={<CancelPage />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Elements stripe={stripePromise}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AppContent />
      </TooltipProvider>
    </Elements>
  </QueryClientProvider>
);

export default App;
