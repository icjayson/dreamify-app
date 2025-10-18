import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ExternalLink, CreditCard } from 'lucide-react';

interface BillingPortalProps {
  customerId: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export const BillingPortal: React.FC<BillingPortalProps> = ({
  customerId,
  onSuccess,
  onError
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenPortal = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/stripe/customer-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer_id: customerId,
          return_url: window.location.href,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to create portal session');
      }

      // Redirect to Stripe Customer Portal
      window.location.href = result.portal_url;
      onSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Billing Management
        </CardTitle>
        <CardDescription>
          Manage your subscription, payment methods, and billing information.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Access your billing portal to:
          </div>
          
          <ul className="text-sm space-y-1 text-muted-foreground">
            <li>• Update payment methods</li>
            <li>• Download invoices</li>
            <li>• Change subscription plan</li>
            <li>• Cancel subscription</li>
            <li>• Update billing address</li>
          </ul>

          <Button
            onClick={handleOpenPortal}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Opening Portal...
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Billing Portal
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
