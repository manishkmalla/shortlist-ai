import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authClient, type SessionUser } from './authClient';

type Status = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: Status;
  user: SessionUser | null;
  /** Re-read the session after sign-in. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const refresh = useCallback(async () => {
    const current = await authClient.currentUser();
    setUser(current);
    setStatus(current ? 'signed-in' : 'signed-out');
  }, []);

  useEffect(() => {
    refresh().catch(() => setStatus('signed-out'));
  }, [refresh]);

  const signOut = useCallback(async () => {
    await authClient.logout();
    setUser(null);
    setStatus('signed-out');
  }, []);

  const value = useMemo(() => ({ status, user, refresh, signOut }), [status, user, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
