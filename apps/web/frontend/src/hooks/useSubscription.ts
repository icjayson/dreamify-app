import { useState, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/clerk-react';
import { API_CONFIG } from '@/api/config';
import { MetaPixel } from '@/hooks/useMetaPixel';

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

interface UseSubscriptionReturn {
  subscription: SubscriptionInfo | null;
  creditUsage: CreditUsage | null;
  creditsRemaining: number | null;
  isLoading: boolean;
  error: string | null;
  refreshSubscription: () => Promise<void>;
  upgradeToPro: () => Promise<void>;
  openBillingPortal: () => Promise<void>;
  consumeCredits: (action: string, credits: number) => Promise<boolean>;
}

export const useSubscription = (): UseSubscriptionReturn => {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [creditUsage, setCreditUsage] = useState<CreditUsage | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Helper to get a fresh Clerk JWT for API calls. */
  const getBearerToken = async (): Promise<string> => {
    try {
      const token = await getToken();
      return token || '';
    } catch {
      return '';
    }
  };

  const fetchSubscription = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      const token = await getBearerToken();
      // Fetch subscription from Polar backend
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/v1/polar/subscriptions?user_id=${user.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
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
      const token = await getBearerToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/v1/polar/credits/usage`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch credit usage');
      }

      const data = await response.json();
      
      if (data.success && data.usage) {
        setCreditUsage(data.usage);
        // creditsRemaining is derived by the tier-aware useEffect below
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

      const token = await getBearerToken();
      // Create checkout session for Polar Pro plan
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/v1/polar/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
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

      // Track InitiateCheckout event
      MetaPixel.track('InitiateCheckout', {
        content_name: 'Dreamify Pro',
        content_category: 'subscription',
        value: 25.00,
        currency: 'USD',
      });

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
      const token = await getBearerToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/v1/polar/credits/consume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: user.id,
          action,
          credits_required: credits,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh credit display after consumption
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
    } else {
      setSubscription(null);
      setCreditUsage(null);
      setCreditsRemaining(null);
      setIsLoading(false);
    }
  }, [user?.id]);

  // Recompute creditsRemaining using tier-aware limits once both subscription and
  // creditUsage are available. This overrides the raw API monthly_credits_limit
  // (which may reflect stale backend data) with the canonical frontend tier limits:
  // Pro → 1000 / month, Standard/Sandbox → 100 / month.
  useEffect(() => {
    if (!creditUsage) return;
    // All users currently have Pro access (1000 credits/month).
    // Update this when the backend enforces tier-based limits correctly.
    const tierLimit = 1000;
    setCreditsRemaining(Math.max(0, tierLimit - creditUsage.monthly_credits_used));
  }, [subscription, creditUsage]);

  return {
    subscription,
    creditUsage,
    creditsRemaining,
    isLoading,
    error,
    refreshSubscription,
    upgradeToPro,
    openBillingPortal,
    consumeCredits,
  };
};
