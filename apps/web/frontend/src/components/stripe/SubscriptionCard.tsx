"""
Subscription card component for displaying subscription information.
"""

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  CreditCard, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Settings
} from 'lucide-react';

interface SubscriptionInfo {
  id: string;
  status: 'active' | 'inactive' | 'cancelled' | 'past_due' | 'unpaid' | 'trialing';
  tier: 'sandbox' | 'pro' | 'enterprise';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface CreditUsage {
  daily_credits_used: number;
  monthly_credits_used: number;
  daily_credits_limit: number;
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
  subscription,
  creditUsage,
  onManageBilling,
  onUpgrade
}) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'trialing':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'past_due':
      case 'unpaid':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <XCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'trialing':
        return 'bg-yellow-100 text-yellow-800';
      case 'past_due':
      case 'unpaid':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'pro':
        return 'bg-blue-100 text-blue-800';
      case 'enterprise':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getDailyProgress = () => {
    if (!creditUsage) return 0;
    return (creditUsage.daily_credits_used / creditUsage.daily_credits_limit) * 100;
  };

  const getMonthlyProgress = () => {
    if (!creditUsage) return 0;
    return (creditUsage.monthly_credits_used / creditUsage.monthly_credits_limit) * 100;
  };

  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            No Active Subscription
          </CardTitle>
          <CardDescription>
            You're currently on the free Sandbox plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Upgrade to Pro for more features and higher limits.
            </div>
            <Button onClick={onUpgrade} className="w-full">
              Upgrade to Pro
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={getTierColor(subscription.tier)}>
              {subscription.tier.toUpperCase()}
            </Badge>
            <Badge className={getStatusColor(subscription.status)}>
              {getStatusIcon(subscription.status)}
              <span className="ml-1">{subscription.status.toUpperCase()}</span>
            </Badge>
          </div>
        </div>
        <CardDescription>
          {subscription.cancel_at_period_end && (
            <div className="text-yellow-600 text-sm">
              Subscription will cancel at the end of the current period.
            </div>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Billing Period */}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4" />
          <span>
            Current period: {formatDate(subscription.current_period_start)} - {formatDate(subscription.current_period_end)}
          </span>
        </div>

        {/* Credit Usage */}
        {creditUsage && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Credit Usage</div>
            
            {/* Daily Credits */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>Daily Credits</span>
                <span className={!creditUsage.can_use_credits ? 'text-red-500' : ''}>
                  {creditUsage.daily_credits_used} / {creditUsage.daily_credits_limit}
                </span>
              </div>
              <Progress value={getDailyProgress()} className="h-2" />
            </div>

            {/* Monthly Credits */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>Monthly Credits</span>
                <span>
                  {creditUsage.monthly_credits_used} / {creditUsage.monthly_credits_limit}
                </span>
              </div>
              <Progress value={getMonthlyProgress()} className="h-2" />
            </div>

            {!creditUsage.can_use_credits && (
              <div className="text-sm text-red-500">
                Daily credit limit reached. Credits reset daily.
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onManageBilling} className="flex-1">
            <Settings className="h-4 w-4 mr-2" />
            Manage Billing
          </Button>
          {subscription.tier !== 'enterprise' && (
            <Button onClick={onUpgrade} className="flex-1">
              Upgrade Plan
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
