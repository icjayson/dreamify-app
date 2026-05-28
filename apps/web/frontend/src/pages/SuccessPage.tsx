import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, ArrowRight, Home, User, Clock } from 'lucide-react';
import WaveBackground from '../../../src/ui/lightswind/wave-background';
import { MetaPixel } from '@/hooks/useMetaPixel';

const SuccessPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const sessionIdParam = searchParams.get('session_id');
    if (sessionIdParam) {
      setSessionId(sessionIdParam);

      // Track Purchase/Subscribe events
      MetaPixel.track('Purchase', {
        content_name: 'Dreamify Pro',
        content_category: 'subscription',
        value: 25.00,
        currency: 'USD',
      });
      MetaPixel.track('Subscribe', {
        value: 25.00,
        currency: 'USD',
        predicted_ltv: 300.00,
      });
    }
  }, [searchParams]);

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
                Payment Successful
              </h2>
              <p className="text-sm sm:text-base font-light text-white/50">
                Congratulations! Your payment was received and your account has been created successfully.
              </p>
            </div>
            <div className="space-y-4">
              {/* Subscription Details Card */}
              <div className="bg-white/50 border border-white/20 rounded-xl mb-6">
                <div className="flex items-center gap-3 p-4">
                  <img 
                    src="/logo-watermark.png" 
                    alt="Dreamify Logo" 
                    className="w-8 h-8 object-contain"
                  />
                  <h3 className="text-lg font-semibold text-muted">Dreamify Pro</h3>
                </div>

                <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-white/70" />
                    <span className="text-sm font-medium text-white">PRO plan</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-white">$25</span>
                    <span className="text-sm text-white/60"> / month</span>
                  </div>
                </div>

                <ul className="space-y-2 mb-4">
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>1,000 credits per month</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>30-day data retention</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>Custom domains</span>
                  </li>
                  <li className="flex items-center gap-2 text-sm text-white/70">
                    <div className="w-1.5 h-1.5 bg-white/50 rounded-full"></div>
                    <span>Remove the Dreamify badge</span>
                  </li>
                </ul>

                <div className="flex items-center gap-2 text-sm text-white/60">
                  <Clock className="w-4 h-4" />
                  <span>Monthly subscription</span>
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
