import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { SignedIn, SignedOut, AuthenticateWithRedirectCallback, useAuth } from "@clerk/clerk-react";
import { PolarProvider } from "./contexts/PolarContext";
import ReactGA from "react-ga4";
import { useEffect } from "react";
import { useMetaPixel } from "./hooks/useMetaPixel";
import Header from "./components/homepage-section/Header";
import AboutPage from "./pages/About";
import PricingPage from "./pages/Pricing";
import FinancePage from "./pages/Finance";
import PrivacyPage from "./pages/Privacy";
import TermsPage from "./pages/Terms";
import DocsPage from "./pages/Docs";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import WorkspacePage from "./pages/workspace";
import WorkspaceNewsPreviewPage from "./pages/WorkspaceNewsPreviewPage";
import ProjectPage from "./pages/project";
import PreviewPage from "./pages/preview.tsx";
import FilePreviewPage from "./pages/FilePreviewPage";
import WaitlistPage from "./pages/Waitlist.tsx";
import ZaloUploadPage from "./pages/ZaloUpload";
import CancelPage from "./pages/CancelPage";
import SuccessPage from "./pages/SuccessPage";
import AdminPage from "./pages/admin";
import AdminConversationPage from "./pages/admin/conversation";
import TemplateGalleryPage from "./pages/TemplateGalleryPage";
import OverallFeedbackPage from "./pages/OverallFeedbackPage";
import { useChatStore } from "./chat/useChatStore";
import GA4IntegrationModal from "./components/chat/GA4IntegrationModal";
import GoogleSheetsIntegrationModal from "./components/chat/GoogleSheetsIntegrationModal";
import MetaAdsIntegrationModal from "./components/chat/MetaAdsIntegrationModal";
import TikTokIntegrationModal from "./components/chat/TikTokIntegrationModal";
import AppsFlyerIntegrationModal from "./components/chat/AppsFlyerIntegrationModal";
import StripeIntegrationModal from "./components/chat/StripeIntegrationModal";
import GoogleAdsIntegrationModal from "./components/chat/GoogleAdsIntegrationModal";
import FirebaseIntegrationModal from "./components/chat/FirebaseIntegrationModal";
import WarehouseIntegrationModal from "./components/chat/WarehouseIntegrationModal";
import AllConnectorsModal from "./components/chat/AllConnectorsModal";

const queryClient = new QueryClient();

// Polar integration uses hosted checkout, no client-side initialization needed here

const AppContent = () => {
  const { messages } = useChatStore();
  const isStarted = messages.length > 1; // Check if user has started chatting
  const location = useLocation();
  const { isSignedIn, isLoaded } = useAuth();

  // Google Analytics pageview tracking
  useEffect(() => {
    ReactGA.send({ hitType: "pageview", page: location.pathname + location.search });
  }, [location]);

  // Meta Pixel pageview tracking
  useMetaPixel();

  const isAppPath =
    location.pathname.startsWith("/workspace") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/preview") ||
    location.pathname.startsWith("/templates") ||
    location.pathname === "/feedback";

  useEffect(() => {
    if (isAppPath) {
      document.documentElement.classList.remove("font-marketing");
    } else {
      document.documentElement.classList.add("font-marketing");
    }
  }, [isAppPath]);

  const isAuthPath = location.pathname === "/login" || location.pathname === "/signup";
  const isWorkspacePath = location.pathname.startsWith("/workspace");
  const isAdminPath = location.pathname.startsWith("/admin");
  const isHomePath = location.pathname === "/";
  const isAboutPath = location.pathname === "/about";
  const isPricingPath = location.pathname === "/pricing";
  const isFinancePath = location.pathname === "/finance";
  const isPrivacyPath = location.pathname === "/privacy";
  const isTermsPath = location.pathname === "/terms";
  const isDocsPath = location.pathname === "/docs";
  const isPreviewPath = location.pathname.startsWith("/preview/");
  const isFeedbackPath = location.pathname === "/feedback";

  const isAllowedSignedInPath =
    location.pathname.startsWith("/workspace") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/preview") ||
    location.pathname.startsWith("/templates") ||
    location.pathname === "/feedback" ||
    location.pathname === "/docs" ||
    location.pathname === "/sso-callback" ||
    location.pathname === "/cancel" ||
    location.pathname === "/success" ||
    location.pathname.startsWith("/zalo-upload");

  const isPublicLandingPath =
    location.pathname === "/" ||
    location.pathname === "/about" ||
    location.pathname === "/pricing" ||
    location.pathname === "/finance" ||
    location.pathname === "/privacy" ||
    location.pathname === "/terms" ||
    location.pathname === "/docs" ||
    location.pathname === "/login" ||
    location.pathname === "/signup" ||
    location.pathname === "/feedback";

  // Prevent public page flash while Clerk is still resolving auth state.
  if (!isLoaded && isPublicLandingPath) {
    return null;
  }

  if (isLoaded && isSignedIn && !isAllowedSignedInPath) {
    return <Navigate to="/workspace" replace />;
  }

  return (
    <>
      {(isHomePath || isAboutPath || isPricingPath || isFinancePath || (!isStarted && !isAuthPath && !isWorkspacePath && !isAdminPath && !isPreviewPath && !isPrivacyPath && !isTermsPath && !isDocsPath && !isFeedbackPath)) && <Header />}
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
        <Route path="/zalo-upload/:token" element={<ZaloUploadPage />} />
        <Route path="/workspace" element={
          <>
            <SignedIn>
              <WorkspacePage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/connectors/:connectorKey/:entityId" element={
          <>
            <SignedIn>
              <WorkspacePage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/project" element={
          <>
            <SignedIn>
              <ProjectPage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/news-preview" element={
          <>
            <SignedIn>
              <WorkspaceNewsPreviewPage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/project/preview" element={<PreviewPage />} />
        <Route path="/preview/:assetId" element={<FilePreviewPage />} />
        <Route path="/cancel" element={<CancelPage />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/conversation/:conversationId" element={<AdminConversationPage />} />
        <Route path="/templates" element={<TemplateGalleryPage />} />
        <Route path="/feedback" element={<OverallFeedbackPage />} />
        <Route path="/sso-callback" element={<AuthenticateWithRedirectCallback />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <GA4IntegrationModal />
      <GoogleSheetsIntegrationModal />
      <MetaAdsIntegrationModal />
      <TikTokIntegrationModal />
      <AppsFlyerIntegrationModal />
      <StripeIntegrationModal />
      <GoogleAdsIntegrationModal />
      <FirebaseIntegrationModal />
      <WarehouseIntegrationModal />
      <AllConnectorsModal />
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
