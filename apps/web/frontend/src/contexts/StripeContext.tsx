import React, { createContext, useContext, useState, useEffect } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';

interface StripeContextType {
  stripe: Stripe | null;
  isLoading: boolean;
  error: string | null;
}

const StripeContext = createContext<StripeContextType | undefined>(undefined);

interface StripeProviderProps {
  children: React.ReactNode;
}

export const StripeProvider: React.FC<StripeProviderProps> = ({ children }) => {
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeStripe = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Get publishable key from environment or API
        const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        
        if (!publishableKey) {
          throw new Error('Stripe publishable key not found');
        }

        const stripeInstance = await loadStripe(publishableKey);
        
        if (!stripeInstance) {
          throw new Error('Failed to load Stripe');
        }

        setStripe(stripeInstance);
      } catch (err) {
        console.error('Error initializing Stripe:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize Stripe');
      } finally {
        setIsLoading(false);
      }
    };

    initializeStripe();
  }, []);

  const value: StripeContextType = {
    stripe,
    isLoading,
    error
  };

  return (
    <StripeContext.Provider value={value}>
      {children}
    </StripeContext.Provider>
  );
};

export const useStripe = (): StripeContextType => {
  const context = useContext(StripeContext);
  if (context === undefined) {
    throw new Error('useStripe must be used within a StripeProvider');
  }
  return context;
};
