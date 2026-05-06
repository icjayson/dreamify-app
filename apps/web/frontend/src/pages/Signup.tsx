import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SignUp } from "@clerk/clerk-react";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import WaveBackground from "../../../src/ui/lightswind/wave-background";
import { dark } from "@clerk/themes";
import { useTheme } from "@/hooks/useTheme";

const REDIRECT_AFTER_AUTH = "/workspace?tab=new-chat";

const Signup = () => {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const logoWatermark = resolvedTheme === 'dark' ? "/logo-watermark.png" : "/logo-horizon-dark.png";

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
            <img src={logoWatermark} alt="Dreamify Logo" className="w-10 h-10 object-contain" />
            <span className="text-2xl font-medium text-foreground font-outfit">Dreamify</span>
          </div>
        </div>

        {/* Split Card */}
        <div className="glass-panel border border-border rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-2">
          {/* Brand panel */}
          <div className="hidden md:flex flex-col justify-center gap-6 p-10 bg-gradient-to-br from-primary/10 via-background to-accent/10">
            <div>
              <h2 className="text-2xl font-bold text-white">Create your account</h2>
              <p className="text-white/70 mt-1">Join and build dashboards faster.</p>
            </div>
            <ul className="space-y-3 text-white/80">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> No credit card required</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Get started in minutes</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Cancel anytime</li>
            </ul>
          </div>

          {/* Form panel */}
          <div className="p-8 md:p-10">
            <h3 className="text-2xl font-semibold text-foreground mb-2">Sign up</h3>
            <p className="text-muted-foreground mb-6">Create your account to continue.</p>

            <div className="space-y-4">
              <SignUp 
                appearance={{
                  baseTheme: dark,
                  elements: {
                    formButtonPrimary: "w-full button-gradient",
                    card: "bg-transparent shadow-none border-none",
                    headerTitle: "hidden",
                    headerSubtitle: "hidden",
                    socialButtonsBlockButton: "w-full button-gradient mb-4",
                    dividerLine: "bg-border",
                    fontFamily: "Outfit",
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
                redirectUrl="/workspace?tab=new-chat"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;


