import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { PlatformAdminOut, PlatformAuthResponse } from '../types';
import { ADMIN_STORAGE_KEY, ADMIN_TOKEN_STORAGE_KEY } from '../lib/adminApi';

export interface AdminAuthContextValue {
  token: string | null;
  admin: PlatformAdminOut | null;
  isAuthenticated: boolean;
  setSession: (auth: PlatformAuthResponse) => void;
  logout: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(
  undefined,
);

function readStoredAdmin(): PlatformAdminOut | null {
  const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlatformAdminOut;
  } catch {
    return null;
  }
}

/**
 * The operator's session, kept entirely apart from the tenant one.
 *
 * Mirrors AuthContext deliberately rather than generalising both into a shared
 * provider: the two sessions have different tokens, different storage keys and
 * different failure redirects, and the one thing that must never happen is a
 * refactor that accidentally lets a manager's token satisfy an admin check.
 * Two small contexts that cannot be confused beat one clever one.
 */
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY),
  );
  const [admin, setAdmin] = useState<PlatformAdminOut | null>(() =>
    readStoredAdmin(),
  );

  const setSession = useCallback((auth: PlatformAuthResponse) => {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, auth.access_token);
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(auth.admin));
    setToken(auth.access_token);
    setAdmin(auth.admin);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    localStorage.removeItem(ADMIN_STORAGE_KEY);
    setToken(null);
    setAdmin(null);
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      token,
      admin,
      isAuthenticated: Boolean(token),
      setSession,
      logout,
    }),
    [token, admin, setSession, logout],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}
