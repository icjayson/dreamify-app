import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, ArrowRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const SuccessPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const sessionIdParam = searchParams.get('session_id');
    if (sessionIdParam) {
      setSessionId(sessionIdParam);
    }
  }, [searchParams]);

  const handleGoToWorkspace = () => {
    navigate('/workspace');
  };

  const handleGoHome = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-green-600">
            Payment Successful!
          </CardTitle>
          <CardDescription className="text-gray-600">
            Thank you for upgrading to Pro! Your subscription is now active.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessionId && (
            <div className="text-sm text-gray-500 text-center">
              Session ID: {sessionId}
            </div>
          )}
          
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">What's next?</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Access to 100 monthly credits</li>
              <li>• 5 daily credits (up to 150/month)</li>
              <li>• 30-day data retention</li>
              <li>• Custom domains</li>
              <li>• Remove the Dreamify badge</li>
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <Button 
              onClick={handleGoToWorkspace}
              className="w-full"
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Go to Workspace
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

export default SuccessPage;
