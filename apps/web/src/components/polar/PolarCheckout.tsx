import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';

interface PolarCheckoutProps {
  onCancel: () => void;
}

export const PolarCheckout: React.FC<PolarCheckoutProps> = ({
  onCancel
}) => {
  const { dailyDataRunLimit } = useSubscription();

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Free Preview
        </CardTitle>
        <CardDescription>
          Checkout and subscriptions are disabled for this Hobby deployment.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            The preview allows up to {dailyDataRunLimit.toLocaleString()} data runs/day. No payment method is required.
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              disabled
              className="flex-1"
            >
              Checkout disabled
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
