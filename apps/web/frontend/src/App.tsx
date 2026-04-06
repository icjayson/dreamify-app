import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, useLocation } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { PolarProvider } from "./contexts/PolarContext";
import ReactGA from "react-ga4";
import { useEffect } from "react";
import Header from "./components/homepage-section/Header";
import AboutPage from "./pages/About";
import PricingPage from "./pages/Pricing";
import FinancePage from "./pages/Finance";
import PrivacyPage from "./pages/Privacy";
import TermsPage from "./pages/Terms";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import WorkspacePage from "./pages/workspace";
import ProjectPage from "./pages/project";
import PreviewPage from "./pages/preview.tsx";
import FilePreviewPage from "./pages/FilePreviewPage";
import WaitlistPage from "./pages/Waitlist.tsx";
import CancelPage from "./pages/CancelPage";
import SuccessPage from "./pages/SuccessPage";
import AdminPage from "./pages/admin";
import AdminConversationPage from "./pages/admin/conversation";
import { useChatStore } from "./chat/useChatStore";
import GA4IntegrationModal from "./components/chat/GA4IntegrationModal";
import GoogleSheetsIntegrationModal from "./components/chat/GoogleSheetsIntegrationModal";
import MetaAdsIntegrationModal from "./components/chat/MetaAdsIntegrationModal";
import TikTokIntegrationModal from "./components/chat/TikTokIntegrationModal";

const queryClient = new QueryClient();

// Polar integration uses hosted checkout, no client-side initialization needed here

const AppContent = () => {
  const { messages } = useChatStore();
  const isStarted = messages.length > 1; // Check if user has started chatting
  const location = useLocation();

  useEffect(() => {
    ReactGA.send({ hitType: "pageview", page: location.pathname + location.search });
  }, [location]);

  const isAuthPath = location.pathname === "/login" || location.pathname === "/signup";
  const isWorkspacePath = location.pathname.startsWith("/workspace");
  const isAdminPath = location.pathname.startsWith("/admin");
  const isHomePath = location.pathname === "/";
  const isAboutPath = location.pathname === "/about";
  const isPricingPath = location.pathname === "/pricing";
  const isFinancePath = location.pathname === "/finance";
  const isPrivacyPath = location.pathname === "/privacy";
  const isTermsPath = location.pathname === "/terms";
  const isPreviewPath = location.pathname.startsWith("/preview/");

  return (
    <>
      {(isHomePath || isAboutPath || isPricingPath || isFinancePath || (!isStarted && !isAuthPath && !isWorkspacePath && !isAdminPath && !isPreviewPath && !isPrivacyPath && !isTermsPath)) && <Header />}
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
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
        <Route path="/workspace/project/preview" element={<PreviewPage />} />
        <Route path="/preview/:assetId" element={<FilePreviewPage />} />
        <Route path="/cancel" element={<CancelPage />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/conversation/:conversationId" element={<AdminConversationPage />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <GA4IntegrationModal />
      <GoogleSheetsIntegrationModal />
      <MetaAdsIntegrationModal />
      <TikTokIntegrationModal />
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PolarProvider>
      <TooltipProvider delayDuration={0}>
        <Toaster />
        <Sonner />
        <AppContent />
      </TooltipProvider>
    </PolarProvider>
  </QueryClientProvider>
);

export default App;
