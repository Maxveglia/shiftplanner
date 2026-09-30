// Which apps this business has, for every screen that has to know: the router
// (which mounts only those), the launcher (a tile each), the first-run gate
// (the shifts app's questions). One reading, held here, so no two of them can
// disagree about the same business in the same second. With it, whether the
// workspace is still being set up, which the launcher says -- read the same
// way, from the same two sources.
//
// Two sources, and the order between them is the point. The user that signing
// in returned already carries the list, so the first screen after the sign-in
// -- and every reload after it, the user being kept on disk -- is built at
// once, without a request in front of it. `GET /workspace` is asked all the
// same, once per page load, and its answer wins: an app switched on or off
// since the sign-in shows up on the next load rather than on the next
// sign-in. Only a session with no list at all (saved before the server sent
// one) has to wait for the answer, and it waits once: the answer is written
// back onto the saved user.

import { createContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../api/workspace';
import { queryKeys } from '../api/keys';
import { onAppNotEnabled } from '../lib/api';
import { knownAppKeys, sameApps, type AppKey } from '../lib/apps';
import { permissionsPending, resolvePermissions, samePerms, type Perm } from '../lib/access';
import { useAuth } from './useAuth';

export interface WorkspaceState {
  /** The apps on, in the order of APPS; undefined while nobody has said. */
  apps: AppKey[] | undefined;
  /** Still being set up; false while nobody has said, and if nobody ever does. */
  preparing: boolean;
  /**
   * What the signed-in account may do (lib/access.ts): the answer's, else
   * the sign-in's, else -- a session saved before the server said -- all of
   * it for a manager and none for anybody else. Empty when signed out.
   */
  permissions: Perm[];
  /**
   * What the account may do is not known yet, so the screens wait for it
   * (WorkspaceGate): a session saved before the server sent the list, of
   * anybody but a manager, until `GET /workspace` answers (permissionsPending).
   */
  permissionsPending: boolean;
  /** Nobody has said, and asking failed: the screen offers to ask again. */
  failed: boolean;
  error: unknown;
  retry: () => void;
  /** Asking again after `failed`; false whenever the apps are known. */
  retrying: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, setWorkspace } = useAuth();
  const query = useWorkspace(isAuthenticated);
  const answer = isAuthenticated ? query.data : undefined;
  const fresh = answer?.apps;
  const signedIn = user?.apps;
  // The answer once there is one; until then, what the sign-in said. A
  // refetch that fails keeps the last answer: a dropped connection is not a
  // business without apps.
  const known = fresh ?? (isAuthenticated && signedIn ? knownAppKeys(signedIn) : undefined);
  // The router reads this, so a new list re-renders whatever page is open.
  // The answer arriving and agreeing with the sign-in -- every page load --
  // is not a new list: the one already out is kept. (A ref written while
  // rendering, which is safe here because it only ever settles on the same
  // value for the same inputs.)
  const held = useRef<AppKey[] | undefined>(undefined);
  if (known === undefined || !sameApps(held.current, known)) held.current = known;
  const apps = held.current;
  // A plain yes or no, so the same answer again is the same value and the
  // open page does not render for it. Before the answer, the sign-in's; a
  // session saved before the server said it has nothing to say, which is no.
  const preparing = answer ? answer.preparing : isAuthenticated && user?.preparing === true;
  // Held like the apps: the same list again is the same array, so a page
  // that reads it does not render for an answer that changed nothing.
  const resolved = isAuthenticated
    ? resolvePermissions(answer?.role ?? user?.role, user?.permissions, answer?.permissions)
    : NO_PERMS;
  const heldPerms = useRef<Perm[]>(NO_PERMS);
  if (!samePerms(heldPerms.current, resolved)) heldPerms.current = resolved;
  const permissions = heldPerms.current;
  const permsPending = isAuthenticated && permissionsPending(user?.role, user?.permissions, answer !== undefined);

  useEffect(() => {
    if (answer) setWorkspace(answer);
  }, [answer, setWorkspace]);

  // The server refused a route because this business no longer has its app:
  // the list is out of date, so ask again. The answer drops the app, the
  // router unmounts its screens, and the manager lands where `/` now leads.
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onAppNotEnabled(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      }),
    [queryClient],
  );

  const { isError, error, isFetching, refetch } = query;
  // Waiting for either -- the apps, or what this account may do -- and the
  // asking failed.
  const failed = (apps === undefined || permsPending) && isError;
  // Only while failed: a request in flight is otherwise no news to anybody,
  // and would re-render the open page twice per load for nothing.
  const retrying = failed && isFetching;
  const shownError = failed ? error : null;
  const value = useMemo<WorkspaceState>(
    () => ({
      apps,
      preparing,
      permissions,
      permissionsPending: permsPending,
      failed,
      error: shownError,
      retry: () => void refetch(),
      retrying,
    }),
    [apps, preparing, permissions, permsPending, failed, shownError, retrying, refetch],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

const NO_PERMS: Perm[] = [];
