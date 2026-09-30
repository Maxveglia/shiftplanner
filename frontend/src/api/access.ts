// Who can sign in to the business, and as what: the access window (/access),
// the manager's. Its employees are given a login -- or have it taken -- with
// the same calls as on each one's page (api/accounts.ts); the shop accounts,
// the till's tablets, are made and unmade here; and so are the old logins of
// people no longer on the team (`orphans`), which can only be deleted.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { knownPerms, ROLES, type Perm } from '../lib/access';
import type { Role } from '../types';
import { queryKeys } from './keys';

export interface AccessManager {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
}

export interface AccessEmployeeAccount {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  last_seen_at: string | null;
}

export interface AccessEmployee {
  employee_id: string;
  name: string;
  /** The address on their record, whether or not they have a login. */
  email: string | null;
  account: AccessEmployeeAccount | null;
}

export interface StoreAccount {
  id: string;
  /** What the manager called the device: "Tablet barra". */
  name: string;
  email: string;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * An employee's login whose person is no longer on the roster (deleted, or
 * gone for good): it cannot sign in -- the server finds nobody behind it --
 * and is listed only so the manager can delete it.
 */
export interface OrphanAccount {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
  last_seen_at: string | null;
}

export interface AccessOverview {
  managers: AccessManager[];
  employees: AccessEmployee[];
  stores: StoreAccount[];
  /** Old logins with nobody behind them; none from a server a release behind. */
  orphans: OrphanAccount[];
  /** What each role may do, as the server's table says it (lib/access.ts). */
  roles: Record<Role, Perm[]>;
}

/**
 * The answer as this client keeps it. The lists are taken as they come; the
 * table of roles is read the way every list of permissions is (knownPerms),
 * a role the server did not describe being one that may do nothing.
 */
export function parseAccessOverview(body: unknown): AccessOverview {
  const answer = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const rolesIn = (answer.roles && typeof answer.roles === 'object' ? answer.roles : {}) as Record<string, unknown>;
  const roles = Object.fromEntries(ROLES.map((role) => [role, knownPerms(rolesIn[role]) ?? []])) as Record<Role, Perm[]>;
  return {
    managers: list<AccessManager>(answer.managers),
    employees: list<AccessEmployee>(answer.employees),
    stores: list<StoreAccount>(answer.stores),
    orphans: list<OrphanAccount>(answer.orphans),
    roles,
  };
}

export function useAccessOverview() {
  return useQuery({
    queryKey: queryKeys.access,
    queryFn: async () => {
      const { data } = await api.get<unknown>('/access');
      return parseAccessOverview(data);
    },
  });
}

export interface StoreAccountCreate {
  name: string;
  email: string;
  password: string;
}

export function useCreateStoreAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: StoreAccountCreate) => {
      const { data } = await api.post<StoreAccount>('/access/stores', payload);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.access });
    },
  });
}

/** A new password: the tablet signed in with the old one is sent back to the sign-in. */
export function useSetStorePassword() {
  return useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      await api.put(`/access/stores/${id}/password`, { password });
    },
  });
}

export function useDeleteStoreAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/access/stores/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.access });
    },
  });
}

/** The path that deletes an old login with nobody behind it (404 `account_not_found` once it is gone). */
export function orphanAccountPath(id: string): string {
  return `/access/accounts/${encodeURIComponent(id)}`;
}

export function useDeleteOrphanAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(orphanAccountPath(id));
    },
    // Gone either way: deleted now, or by somebody else first (404), which
    // the list is asked again to show.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.access });
    },
  });
}
