import React from 'react';
import { useNavigate } from 'react-router-dom';
import { XCircle, ArrowLeft, Home, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const CancelPage: React.FC = () => {
  const navigate = useNavigate();

  const handleTryAgain = () => {
    navigate('/');
  };

  const handleGoHome = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-red-600">
            Payment Cancelled
          </CardTitle>
          <CardDescription className="text-gray-600">
            Your payment was cancelled. No charges have been made to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">What happened?</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• You cancelled the payment process</li>
              <li>• No subscription was created</li>
              <li>• No charges were made</li>
              <li>• You can try again anytime</li>
            </ul>
          </div>

          <div className="bg-blue-50 p-3 rounded-md">
            <div className="flex items-start gap-2">
              <CreditCard className="w-4 h-4 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium">Need help with payment?</p>
                <p>Contact our support team if you're experiencing payment issues.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button 
              onClick={handleTryAgain}
              className="w-full"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Try Again
            </Button>
            <Button 
              onClick={handleGoHome}
              variant="outline"
              className="w-full"
            >
              <Home className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CancelPage;
