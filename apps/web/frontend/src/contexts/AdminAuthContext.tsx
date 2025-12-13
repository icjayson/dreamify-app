import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AdminCredentials {
  username: string;
  password: string;
}

interface AdminAuthContextType {
  isAuthenticated: boolean;
  credentials: AdminCredentials | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  getAuthHeader: () => string | null;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

const STORAGE_KEY = 'admin_credentials';

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<AdminCredentials | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check localStorage on mount
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const decoded = atob(stored);
        const [username, password] = decoded.split(':');
        if (username && password) {
          setCredentials({ username, password });
          setIsAuthenticated(true);
        }
      } catch (e) {
        // Invalid stored credentials, clear them
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      // Test authentication by making a simple request
      const authHeader = `Basic ${btoa(`${username}:${password}`)}`;
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/v1/admin/conversations?limit=1`,
        {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        // Store credentials (base64 encoded)
        const encoded = btoa(`${username}:${password}`);
        localStorage.setItem(STORAGE_KEY, encoded);
        setCredentials({ username, password });
        setIsAuthenticated(true);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCredentials(null);
    setIsAuthenticated(false);
  };

  const getAuthHeader = (): string | null => {
    if (!credentials) return null;
    return `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;
  };

  return (
    <AdminAuthContext.Provider
      value={{
        isAuthenticated,
        credentials,
        login,
        logout,
        getAuthHeader,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return context;
}

