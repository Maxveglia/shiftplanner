// What the signed-in account may do, for a screen to ask (lib/access.ts). Here
// and not in lib/access.ts, which stays pure: the list is read off the
// workspace, as the apps are (useWorkspaceApps.ts).

import { useCallback } from 'react';
import { can, type Perm } from '../lib/access';
import { useWorkspaceState } from './useWorkspaceApps';

/** The permissions, in the table's order. */
export function usePermissions(): Perm[] {
  return useWorkspaceState().permissions;
}

/** `can(perm)`, for the signed-in account: `const allow = useCan(); allow('menu.edit')`. */
export function useCan(): (perm: Perm) => boolean {
  const permissions = usePermissions();
  return useCallback((perm: Perm) => can(permissions, perm), [permissions]);
}
