import { Waitlist } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import WaveBackground from "../../../src/ui/lightswind/wave-background";
import { dark } from "@clerk/themes";

export default function WaitlistPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 relative overflow-hidden">
      {/* Hide global header on this page */}
      <style dangerouslySetInnerHTML={{ __html: `header { display: none !important; }` }} />

      {/* Background */}
      <WaveBackground backdropBlurAmount="md" className="absolute inset-0 z-0" />
      <div className="absolute inset-0 bg-black/60 z-1"></div>

      {/* Back button */}
      <div className="absolute top-4 left-4 z-20">
        <button onClick={() => navigate("/")} aria-label="Back to homepage" className="button-outline px-3 py-1.5 rounded-xl flex items-center">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </button>
      </div>

      <main className="relative z-10 w-full max-w-[1450px]">
        {/* Hero Header (CTA-style, aligned like homepage sections) */}
        <div className="mx-auto max-w-4xl text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-8">
            <img src="/logo-watermark.png" alt="Dreamify Logo" className="w-10 h-10 object-contain hover:animate-spin transition-all duration-300" />
            <span className="text-2xl font-medium text-foreground font-outfit">Dreamify</span>
          </div>
          <h1 className="text-xl md:text-4xl font-bold tracking-tight text-foreground leading-relaxed flex flex-wrap items-center justify-center gap-2">
            Join the 
            <span className="inline-flex align-middle px-3 py-1 rounded-lg ml-1 mr-1 button-gradient">
              waitlist
            </span>
            - Get
            <span className="inline-flex align-middle px-3 py-1 rounded-lg ml-1 button-gradient">
              early access
            </span>
          </h1>
          <p className="mt-2 text-base md:text-lg text-white/60">
            Watch the product demo, then join the waitlist to be the first to try Dreamify.
          </p>
        </div>

        {/* Two-column layout (simple, no card, no padding) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-auto xl:gap-auto place-content-center lg:min-h-0 lg:place-content-stretch">
          {/* Video placeholder (left, 2/3 width) */}
          <section className="lg:col-span-2 flex items-center justify-center order-2 lg:order-1 z-0">
              <video className="w-full rounded-2xl border border-white/50 max-w-5xl aspect-video object-cover bg-card/50" controls preload="auto" loop={true} autoPlay src="/video-demo-test.mp4">
              </video>
          </section>

          {/* Waitlist (right, 1/3 width) */}
          <section className="order-1 lg:order-2 flex items-center justify-center z-10">
            <Waitlist
            appearance={{
                  baseTheme: dark,
                  elements: {
                    headerTitle: "text-white",
                    headerSubtitle: "text-white",
                    formButtonPrimary: "w-full button-gradient",
                    card: "bg-muted shadow-none border",
                    socialButtonsBlockButton: "w-full button-gradient mb-4",
                    dividerLine: "bg-border",
                    fontFamily: "Inter",
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
                    colorBackground: "#161C27",
                  },
                  layout: {
                    unsafe_disableDevelopmentModeWarnings: true,
                    animations: true,
                  }
                }}
                />
          </section>
        </div>
      </main>
    </div>
  );
}


