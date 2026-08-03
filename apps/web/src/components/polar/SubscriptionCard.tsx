// Compatibility card for the billing-disabled Hobby profile.

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Sparkles } from 'lucide-react';

interface SubscriptionInfo {
  subscription_id: string;
  status: 'active' | 'inactive' | 'cancelled' | 'past_due' | 'unpaid' | 'trialing';
  tier: 'sandbox' | 'pro' | 'enterprise';
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface CreditUsage {
  monthly_credits_used: number;
  monthly_credits_limit: number;
  can_use_credits: boolean;
}

interface SubscriptionCardProps {
  subscription?: SubscriptionInfo;
  creditUsage?: CreditUsage;
  onManageBilling: () => void;
  onUpgrade: () => void;
}

export const SubscriptionCard: React.FC<SubscriptionCardProps> = ({
  creditUsage,
  onUpgrade
}) => {
  const dailyLimit = Math.max(creditUsage?.monthly_credits_limit ?? 5, 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Free Preview
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">HOBBY DEMO</Badge>
            <Badge variant="outline">BILLING DISABLED</Badge>
          </div>
        </div>
        <CardDescription>
          Invitation-only, non-commercial preview profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Up to {dailyLimit.toLocaleString()} data runs/day</span>
        </div>
        <p className="text-sm text-muted-foreground">
          The server enforces the daily cap. Live remaining usage is not exposed.
        </p>
        <Button variant="outline" onClick={onUpgrade} className="w-full">
          View preview limits
        </Button>
      </CardContent>
    </Card>
  );
};
