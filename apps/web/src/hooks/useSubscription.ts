import { useCallback, useMemo } from "react";

import { useCapabilities } from "@/hooks/useCapabilities";

interface SubscriptionInfo {
  subscription_id: string;
  status: "active";
  tier: "sandbox";
  current_period_end: string;
  cancel_at_period_end: false;
}

interface CreditUsage {
  monthly_credits_used: number | null;
  monthly_credits_limit: number;
  can_use_credits: boolean;
}

interface UseSubscriptionReturn {
  subscription: SubscriptionInfo;
  creditUsage: CreditUsage;
  dailyDataRunLimit: number;
  isLoading: boolean;
  error: string | null;
  refreshSubscription: () => Promise<void>;
  upgradeToPro: () => Promise<void>;
  openBillingPortal: () => Promise<void>;
  consumeCredits: (action: string, credits: number) => Promise<boolean>;
}

/**
 * Compatibility facade for legacy plan widgets.
 *
 * Hobby Preview has no billing and never calls a checkout, portal, credit-read,
 * or credit-debit endpoint. Capabilities expose a technical daily run limit,
 * but there is no live usage endpoint, so this hook never invents a remaining
 * balance. Server-side quota enforcement remains authoritative.
 */
export const useSubscription = (): UseSubscriptionReturn => {
  const { capabilities, isLoading, refresh } = useCapabilities();
  const dailyLimit = capabilities.limits.data_runs_per_user_per_day;

  const subscription = useMemo<SubscriptionInfo>(() => ({
    subscription_id: "hobby_demo",
    status: "active",
    tier: "sandbox",
    current_period_end: "",
    cancel_at_period_end: false,
  }), []);

  const creditUsage = useMemo<CreditUsage>(() => ({
    monthly_credits_used: null,
    monthly_credits_limit: dailyLimit,
    can_use_credits: true,
  }), [dailyLimit]);

  const refreshSubscription = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const disabledAction = useCallback(async () => undefined, []);
  const consumeCredits = useCallback(async () => true, []);

  return {
    subscription,
    creditUsage,
    dailyDataRunLimit: dailyLimit,
    isLoading,
    error: null,
    refreshSubscription,
    upgradeToPro: disabledAction,
    openBillingPortal: disabledAction,
    consumeCredits,
  };
};
