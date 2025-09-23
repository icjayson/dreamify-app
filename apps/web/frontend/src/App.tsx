import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, useLocation } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import Header from "./components/Header";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import WorkspacePage from "./pages/workspace";
import ProjectPage from "./pages/project";
import PreviewPage from "./pages/preview.tsx";
import WaitlistPage from "./pages/Waitlist.tsx";
import { useChatStore } from "./stores/useChatStore";

const queryClient = new QueryClient();

const AppContent = () => {
  const { messages } = useChatStore();
  const isStarted = messages.length > 1; // Check if user has started chatting
  const location = useLocation();
  const isAuthPath = location.pathname === "/login" || location.pathname === "/signup";
  const isWorkspacePath = location.pathname.startsWith("/workspace");

  return (
    <>
      {!isStarted && !isAuthPath && !isWorkspacePath && <Header />}
      <Routes>
        <Route path="/" element={<Index />} />
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
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppContent />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
