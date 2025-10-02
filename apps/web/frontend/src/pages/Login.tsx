import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SignIn } from "@clerk/clerk-react";
import { dark } from '@clerk/themes';
import { CheckCircle2, ArrowLeft } from "lucide-react";
import WaveBackground from "../../../src/ui/lightswind/wave-background";

const REDIRECT_AFTER_AUTH = "/workspace";

const Login = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 relative overflow-hidden">
      <WaveBackground backdropBlurAmount="md" className="absolute inset-0 z-0" />
      <div className="absolute inset-0 bg-black/60 z-1"></div>

      {/* Back button */}
      <div className="absolute top-4 left-4 z-20">
        <button onClick={() => navigate("/")} aria-label="Back to homepage" className="button-outline px-3 py-1.5 rounded-xl flex items-center">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </button>
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        {/* Minimal Header */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-3">
            <img src="/logo-watermark.png" alt="Dreamify Logo" className="w-10 h-10 object-contain" />
            <span className="text-2xl font-medium text-foreground font-outfit">Dreamify</span>
          </div>
        </div>

        {/* Split Card */}
        <div className="glass-panel border border-border/30 rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-2">
          {/* Brand panel */}
          <div className="hidden md:flex flex-col justify-center gap-6 p-10 bg-gradient-to-br from-primary/10 via-background to-accent/10">
            <div>
              <h2 className="text-2xl font-bold text-white">Welcome to Dreamify</h2>
              <p className="text-white/70 mt-1">Build beautiful dashboards in minutes.</p>
            </div>
            <ul className="space-y-3 text-white/80">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> AI‑assisted insights</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Real‑time analytics</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Secure by design</li>
            </ul>
          </div>

          {/* Form panel */}
          <div className="p-8 md:p-10">
            <h3 className="text-2xl font-semibold text-foreground mb-2">Login</h3>
            <p className="text-muted-foreground mb-6">Welcome back! Please sign in to continue.</p>

            <div className="space-y-4">
              <SignIn 
                appearance={{
                  baseTheme: dark,
                  elements: {
                    formButtonPrimary: "w-full button-gradient",
                    fontFamily: "Inter",
                    card: "bg-transparent shadow-none border-none",
                    headerTitle: "hidden",
                    headerSubtitle: "hidden",
                    socialButtonsBlockButton: "w-full button-gradient mb-4",
                    dividerLine: "bg-border",
                    dividerText: "text-xs text-muted-foreground",
                    formFieldInput: "bg-input border-border text-foreground",
                    formFieldLabel: "text-sm font-medium text-foreground",
                    footerActionLink: "text-white hover:text-accent hover:underline",
                    identityPreviewText: "text-muted-foreground",
                    formFieldSuccessText: "text-green-500",
                    formFieldErrorText: "text-red-500"

                   },
                  variables: {
                    colorText: "#ffffff",
                    colorBackground: "primary",
                  },
                  layout: {
                    unsafe_disableDevelopmentModeWarnings: true,
                    animations: true,
                  }
                }}
                redirectUrl="/workspace"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;


