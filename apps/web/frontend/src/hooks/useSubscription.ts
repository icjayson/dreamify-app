import { useState, useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';

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

      // TODO: Replace with actual API call
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'}/stripe/subscriptions`, {
        headers: {
          'Authorization': `Bearer ${user.id}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch subscription');
      }

      const data = await response.json();
      
      if (data.success) {
        setSubscription(data.subscription);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch subscription';
      setError(errorMessage);
      console.error('Subscription fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCreditUsage = async () => {
    if (!user) return;

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'}/stripe/credits/usage?user_id=${user.id}&subscription_tier=sandbox`);
      
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

      // Create checkout session for Pro plan
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'}/stripe/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.id}`,
        },
        body: JSON.stringify({
          price_id: 'price_pro_monthly', // TODO: Get actual price ID
          user_id: user.id,
          success_url: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${window.location.origin}/cancel`,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      window.location.href = data.session_url;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upgrade subscription';
      setError(errorMessage);
      console.error('Upgrade error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const openBillingPortal = async () => {
    if (!user || !subscription) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'}/stripe/customer-portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.id}`,
        },
        body: JSON.stringify({
          customer_id: subscription.id, // TODO: Get actual customer ID
          user_id: user.id,
          return_url: window.location.href,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create portal session');
      }

      // Redirect to Stripe Customer Portal
      window.location.href = data.portal_url;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to open billing portal';
      setError(errorMessage);
      console.error('Billing portal error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const consumeCredits = async (action: string, credits: number): Promise<boolean> => {
    if (!user) return false;

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'}/stripe/credits/consume`, {
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
        // Refresh credit usage
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
