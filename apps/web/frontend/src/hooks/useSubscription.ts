import { useState, useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';

interface SubscriptionInfo {
  subscription_id: string;
  status: 'active' | 'inactive' | 'cancelled' | 'past_due' | 'unpaid' | 'trialing';
  tier: 'sandbox' | 'pro' | 'enterprise';
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

interface UseSubscriptionReturn {
  subscription: SubscriptionInfo | null;
  creditUsage: CreditUsage | null;
  isLoading: boolean;
  error: string | null;
  refreshSubscription: () => Promise<void>;
  upgradeToPro: () => Promise<void>;
  openBillingPortal: () => Promise<void>;
  consumeCredits: (action: string, credits: number) => Promise<boolean>;
}

export const useSubscription = (): UseSubscriptionReturn => {
  const { user } = useUser();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [creditUsage, setCreditUsage] = useState<CreditUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // Fetch subscription from Polar backend
      const response = await fetch(`/api/v1/polar/subscriptions?user_id=${user.id}`, {
        headers: {
          'Authorization': `Bearer ${user.id}`,
        },
      });

      if (!response.ok) {
        let errorMessage = 'Failed to fetch subscription';
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.error || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (data.success) {
        setSubscription(data.subscription || null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch subscription';
      // Don't set error for 404/no subscription which is normal for new users
      console.log('Subscription fetch info:', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCreditUsage = async () => {
    if (!user) return;

    try {
      const response = await fetch(`/api/v1/polar/credits/usage?user_id=${user.id}&subscription_tier=sandbox`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch credit usage');
      }

      const data = await response.json();
      
      if (data.success) {
        setCreditUsage(data.usage);
      }
    } catch (err) {
      console.error('Credit usage fetch error:', err);
    }
  };

  const refreshSubscription = async () => {
    await Promise.all([fetchSubscription(), fetchCreditUsage()]);
  };

  const upgradeToPro = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      // Create checkout session for Polar Pro plan
      const response = await fetch(`/api/v1/polar/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.id}`,
        },
        body: JSON.stringify({
          product_id: 'pro_product_id', // TODO: Get from backend or config
          user_id: user.id,
          success_url: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Polar Checkout
      window.location.href = data.url;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upgrade subscription';
      setError(errorMessage);
      console.error('Upgrade error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const openBillingPortal = async () => {
    // Polar handles this via their hosted account page or we can redirect to their customer portal
    // For now, redirect to a generic Polar portal or use their API to get a specific link
    window.location.href = "https://polar.sh/purchases"; 
  };

  const consumeCredits = async (action: string, credits: number): Promise<boolean> => {
    if (!user) return false;

    try {
      const response = await fetch(`/api/v1/polar/credits/consume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.id}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          action,
          credits_required: credits,
        }),
      });

      const data = await response.json();

      if (data.success) {
        await fetchCreditUsage();
        return true;
      } else {
        setError(data.error || 'Failed to consume credits');
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to consume credits';
      setError(errorMessage);
      console.error('Credit consumption error:', err);
      return false;
    }
  };

  useEffect(() => {
    if (user) {
      refreshSubscription();
    }
  }, [user]);

  return {
    subscription,
    creditUsage,
    isLoading,
    error,
    refreshSubscription,
    upgradeToPro,
    openBillingPortal,
    consumeCredits,
  };
};
