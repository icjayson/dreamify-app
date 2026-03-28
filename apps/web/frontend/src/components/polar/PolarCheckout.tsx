import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CreditCard } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';

interface PolarCheckoutProps {
  onCancel: () => void;
}

export const PolarCheckout: React.FC<PolarCheckoutProps> = ({
  onCancel
}) => {
  const { upgradeToPro, isLoading, error } = useSubscription();

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Upgrade to Pro
        </CardTitle>
        <CardDescription>
          You will be redirected to Polar.sh to safely complete your purchase.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md">
              {error}
            </div>
          )}
          
          <div className="text-sm text-muted-foreground">
            Polar.sh handles global tax and payment processing securely.
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="flex-1"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={upgradeToPro}
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Redirecting...
                </>
              ) : (
                'Continue to Checkout'
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
