import React, { createContext, useContext, useState, useEffect } from 'react';

interface PolarContextType {
  isLoading: boolean;
  error: string | null;
}

const PolarContext = createContext<PolarContextType | undefined>(undefined);

interface PolarProviderProps {
  children: React.ReactNode;
}

export const PolarProvider: React.FC<PolarProviderProps> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Polar primarily uses hosted checkout and portal, so the context
  // is mainly for global loading states or errors during session creation.

  const value: PolarContextType = {
    isLoading,
    error
  };

  return (
    <PolarContext.Provider value={value}>
      {children}
    </PolarContext.Provider>
  );
};

export const usePolar = (): PolarContextType => {
  const context = useContext(PolarContext);
  if (context === undefined) {
    throw new Error('usePolar must be used within a PolarProvider');
  }
  return context;
};
