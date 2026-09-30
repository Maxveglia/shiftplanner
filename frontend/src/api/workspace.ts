// What this business's ShiftPlanner is made of.
//
// Each business is served from its own folder on the server
// (backend/app/clients/<key>/), and this is where the browser asks what that
// folder says. Today that is which apps to mount, and whether the workspace
// is still being set up (the launcher says so); it will carry each app's
// settings as they become the business's own (the inventory's is next), which
// is why it is an object and why anything in it this client does not know
// yet is passed over rather than refused.
//
// Anybody signed in may ask -- an employee's screen is built from the same
// answer as the manager's -- and it is the one thing a business with no apps
// at all can still read.

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { knownAppKeys, type AppKey } from '../lib/apps';
import { isRole, knownPerms, type Perm } from '../lib/access';
import type { Role } from '../types';
import { queryKeys } from './keys';

export interface Workspace {
  /** The apps on, in the order of APPS, and only the ones this client knows. */
  apps: AppKey[];
  /** Still being set up: the launcher says so, above whatever apps it has. */
  preparing: boolean;
  /**
   * Who is asking, and what they may do (lib/access.ts). Absent when the
   * server did not say -- a release behind -- which is not "nothing": the
   * sign-in's, kept with the session, stay in charge.
   */
  role?: Role;
  permissions?: Perm[];
}

/**
 * The server's answer as this client keeps it. A key it has never heard of is
 * dropped (an app a release ahead of this bundle), and so is anything else in
 * the body: the answer is expected to grow.
 *
 * A body with no list of apps in it is not an answer, and throws: read as
 * "no apps" it would show a business that has everything the screen of one
 * that has nothing. Failing, it leaves the list from the sign-in in charge,
 * or an offer to try again (WorkspaceGate).
 *
 * `preparing` is yes only when the server says exactly `true`. A server a
 * release behind does not say it at all, and that is no: the launcher as it
 * was before there was such a thing to say.
 */
export function parseWorkspace(body: unknown): Workspace {
  const answer: { apps?: unknown; preparing?: unknown; role?: unknown; permissions?: unknown } =
    body && typeof body === 'object' ? body : {};
  if (!Array.isArray(answer.apps)) throw new Error('The workspace answer carries no list of apps.');
  const workspace: Workspace = { apps: knownAppKeys(answer.apps), preparing: answer.preparing === true };
  // Only what was said: a key set to undefined would read as "said nothing".
  if (isRole(answer.role)) workspace.role = answer.role;
  const permissions = knownPerms(answer.permissions);
  if (permissions) workspace.permissions = permissions;
  return workspace;
}

export const workspaceQuery = {
  queryKey: queryKeys.workspace,
  queryFn: async () => {
    const { data } = await api.get<unknown>('/workspace');
    return parseWorkspace(data);
  },
  // Apps are switched on by hand, a few times in a business's life: asked
  // once per page load (and per sign-in, the cache being emptied at every
  // sign-out) is plenty.
  staleTime: 5 * 60_000,
};

export function useWorkspace(enabled = true) {
  return useQuery({ ...workspaceQuery, enabled });
}
