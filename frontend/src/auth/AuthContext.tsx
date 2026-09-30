import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, UserOut } from '../types';
import type { Workspace } from '../api/workspace';
import { clearSessionEnded, TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from '../lib/api';
import { sameWorkspace } from '../lib/apps';

export interface AuthContextValue {
  token: string | null;
  user: UserOut | null;
  isAuthenticated: boolean;
  setSession: (auth: AuthResponse) => void;
  /** What `GET /workspace` just said: kept on the user, here and on disk. */
  setWorkspace: (workspace: Workspace) => void;
  logout: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** The user with what `GET /workspace` said on it; what it did not say is left as it was. */
function withWorkspace(user: UserOut, { apps, preparing, role, permissions }: Workspace): UserOut {
  return {
    ...user,
    apps,
    preparing,
    ...(role !== undefined ? { role } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
  };
}

function readStoredUser(): UserOut | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserOut;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY),
  );
  const [user, setUser] = useState<UserOut | null>(() => readStoredUser());
  const queryClient = useQueryClient();

  const setSession = useCallback((auth: AuthResponse) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, auth.access_token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(auth.user));
    setToken(auth.access_token);
    setUser(auth.user);
  }, []);

  // The apps a business has, and whether its workspace is still being set up,
  // are sent with the user at sign-in, and asked for again once the app is
  // open (WorkspaceContext). A different answer is kept on the user -- in
  // memory, and in the copy on disk -- so the next reload opens on it straight
  // away instead of on what the sign-in said, and a session saved before the
  // server sent the list at all learns it once and stops waiting for it. The
  // same answer again changes nothing: no render.
  //
  // With them, who is asking and what they may do (lib/access.ts), when the
  // answer says: kept the same way, so a reload opens on what the server
  // said last rather than on what the sign-in said.
  const setWorkspace = useCallback((workspace: Workspace) => {
    setUser((prev) => (prev && !sameWorkspace(prev, workspace) ? withWorkspace(prev, workspace) : prev));
  }, []);

  useEffect(() => {
    if (!user?.apps) return;
    const stored = readStoredUser();
    // Only onto the same person's copy: another tab may have signed somebody
    // else in since, and their session is not this one's to edit.
    if (!stored || stored.id !== user.id || sameWorkspace(stored, user)) return;
    localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({
        ...stored,
        apps: user.apps,
        preparing: user.preparing,
        role: user.role,
        permissions: user.permissions,
      }),
    );
  }, [user]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    // Signed out by choice: the sign-in has nothing to explain (lib/api.ts).
    clearSessionEnded();
    setToken(null);
    setUser(null);
    // Query keys carry no organisation, so a manager of another company
    // signing in on this browser would be served the previous one's cached
    // rows -- and, since the draft now loads from the server, adopt them as
    // their calendar. Nothing cached survives a sign-out.
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
      setSession,
      setWorkspace,
      logout,
    }),
    [token, user, setSession, setWorkspace, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
