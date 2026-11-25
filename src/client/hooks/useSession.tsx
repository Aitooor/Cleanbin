import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SessionRole } from '../../shared/types';

export interface SessionState {
  loading: boolean;
  authenticated: boolean;
  email: string | null;
  role: SessionRole | null;
  totpEnabled: boolean;
  permanentDeleteLimit: number | null;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<SessionRole | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [permanentDeleteLimit, setPermanentDeleteLimit] = useState<number | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth', { cache: 'no-store' });
      if (!response.ok) throw new Error('auth check failed');
      const data = await response.json();
      setAuthenticated(!!data.authenticated);
      setEmail(data.email ?? null);
      setRole(data.role ?? null);
      setTotpEnabled(Boolean(data.totpEnabled));
      setPermanentDeleteLimit(
        typeof data.permanentDeleteLimit === 'number' ? data.permanentDeleteLimit : null
      );
    } catch {
      setAuthenticated(false);
      setEmail(null);
      setRole(null);
      setTotpEnabled(false);
      setPermanentDeleteLimit(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/sessions', { method: 'DELETE' });
    } catch {
      // Cookie cleared regardless
    }
    setAuthenticated(false);
    setEmail(null);
    setRole(null);
    setTotpEnabled(false);
    setPermanentDeleteLimit(null);
  }, []);

  const value = useMemo(
    () => ({
      loading,
      authenticated,
      email,
      role,
      totpEnabled,
      permanentDeleteLimit,
      refreshSession,
      signOut,
    }),
    [loading, authenticated, email, role, totpEnabled, permanentDeleteLimit, refreshSession, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
