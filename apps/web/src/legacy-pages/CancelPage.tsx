import React, { useState } from 'react';
import { useNavigate } from '@/lib/navigation';
import { XCircle, ArrowLeft, Home, CreditCard } from 'lucide-react';
import WaveBackground from "@/ui/lightswind/wave-background";
import { useSubscription } from '@/hooks/useSubscription';

const CancelPage: React.FC = () => {
  const navigate = useNavigate();
  const { upgradeToPro, isLoading } = useSubscription();
  const [isHovered, setIsHovered] = useState(false);

  const handleTryAgain = async () => {
    try {
      await upgradeToPro();
    } catch (error) {
      console.error('Failed to start checkout:', error);
      // Fallback to homepage if checkout fails
      navigate('/');
    }
  };

  const handleGoHome = () => {
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
      <div className="fixed inset-0 bg-muted z-1"></div>

      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="rounded-xl sm:rounded-2xl p-4 sm:p-6 w-[90vw] max-w-sm sm:max-w-md mx-4 sm:mx-0">
          <div className="w-full">
            <div className="text-center mb-6">
              <div className="mx-auto mb-4 w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-red-600 mb-2">
                Payment Cancelled
              </h2>
              <p className="text-sm sm:text-base font-light text-white/50">
                Your payment was cancelled. No charges have been made to your account.
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2 sm:space-y-3">
                <h3 className="text-sm sm:text-base font-semibold text-white">What happened?</h3>
                <ul className="text-xs sm:text-sm text-white/50 space-y-1">
                  <li>• You cancelled the payment process</li>
                  <li>• No subscription was created</li>
                  <li>• No charges were made</li>
                  <li>• You can try again anytime</li>
                </ul>
              </div>

              <div 
                className="bg-blue-50 hover:bg-blue-100 p-3 rounded-md transition-colors duration-200 cursor-pointer"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
              >
                <div className="flex items-start gap-2">
                  <CreditCard className="w-4 h-4 text-blue-600 mt-0.5" />
                  <div className="text-xs sm:text-sm text-blue-800">
                    {isHovered ? (
                      <p className="font-medium">Contact us via mail for help</p>
                    ) : (
                      <>
                        <p className="font-medium">Need help with payment?</p>
                        <p>Contact our support team if you're experiencing payment issues.</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:gap-3">
                <button 
                  onClick={handleTryAgain}
                  disabled={isLoading}
                  className="button-gradient rounded-xl text-sm sm:text-base py-2 flex items-center justify-center disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Try Again
                    </>
                  )}
                </button>
                <button 
                  onClick={handleGoHome}
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

export default CancelPage;
