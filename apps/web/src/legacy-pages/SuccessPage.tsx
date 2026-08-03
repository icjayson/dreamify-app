import React from 'react';
import { useNavigate } from '@/lib/navigation';
import { CheckCircle, ArrowRight, Home, User, ShieldCheck } from 'lucide-react';
import WaveBackground from "@/ui/lightswind/wave-background";

const SuccessPage: React.FC = () => {
  const navigate = useNavigate();

  const handleCreateNewProject = () => {
    navigate('/workspace/project');
  };

  const handleBackToHome = () => {
    navigate('/');
  };


  return (
    <div className="min-h-screen overflow-y-auto">
      {/* Hide global header on this page */}
      <style dangerouslySetInnerHTML={{ __html: `header { display: none !important; }` }} />

      {/* Fixed WaveBackground Component for entire page */}
      <WaveBackground
        className="fixed inset-0 z-0"
      />

      {/* Fixed overlay for better text readability */}
      <div className="fixed inset-0 bg-black/60 z-1"></div>

      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <div className=" rounded-xl sm:rounded-2xl p-4 sm:p-6 w-[90vw] max-w-sm sm:max-w-md mx-4 sm:mx-0">
          <div className="w-full">
            <div className="text-center mb-6">
              <div className="mx-auto mb-4 w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-xl sm:text-3xl font-bold text-green-500 mb-2">
                Free Preview Ready
              </h2>
              <p className="text-sm sm:text-base font-light text-white/50">
                Billing is disabled for this invitation-only Hobby deployment. You can start a demo project now.
              </p>
            </div>
            <div className="space-y-4">
              {/* Preview profile details */}
              <div className="bg-white/50 border border-white/20 rounded-xl mb-6">
                <div className="flex items-center gap-3 p-4">
                  <img
                    src="/logo-watermark.png"
                    alt="Dreamify Logo"
                    className="w-8 h-8 object-contain"
                  />
                  <h3 className="text-lg font-semibold text-muted">Dreamify Free Preview</h3>
                </div>

                <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-white/70" />
                    <span className="text-sm font-medium text-white">Hobby demo profile</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-white">$0</span>
                    <span className="text-sm text-white/60"> billing disabled</span>
                  </div>
                </div>

                <ul className="space-y-2 mb-4">
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>Server-enforced daily demo limits</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>Deterministic provider without an API key</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>Private invitation-only access</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>Optional BYOK providers</span>
                  </li>
                </ul>

                <div className="flex items-center gap-2 text-sm text-white/60">
                  <ShieldCheck className="w-4 h-4" />
                  <span>No checkout or subscription was created</span>
                </div>
              </div>
              </div>

              <div className="flex flex-col gap-2 sm:gap-3">
                <button
                  onClick={handleCreateNewProject}
                  className="button-gradient rounded-xl text-sm sm:text-base py-2 flex items-center justify-center"
                >
                  <ArrowRight className="w-4 h-4 mr-2" />
                  Create new project
                </button>
                <button
                  onClick={handleBackToHome}
                  className="button-outline rounded-xl text-sm sm:text-base py-2 flex items-center justify-center"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuccessPage;
