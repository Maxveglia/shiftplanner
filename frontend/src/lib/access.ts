// What each account may do: the manager everything; an employee and a shop
// account (the till's tablet) the inventory and the shop's day-to-day -- see,
// count, receive, order, charge, void -- and nothing that changes what the
// business sells or keeps: no products, no suppliers, no menu, no recipes.
//
// The table is the server's (backend/app/access.py), and it says it in every
// user it returns and in `GET /workspace`: `permissions`, a list of these
// strings. This client never works it out from the role -- the role only
// decides what a session saved before the server said it is taken to have
// (`resolvePermissions`). Every screen asks `can()`, and what it may not do is
// not drawn at all: a button that only answers "not allowed" is a button to
// hide. The server refuses all of it anyway (403 `manager_role_required`).
//
// Pure: the React side (`usePermissions`, `useCan`) is in auth/useCan.ts,
// beside the other readings of the workspace.

import type { Role } from '../types';

/** Every permission there is, in the order of the server's table. */
export const PERMS = [
  'inventory.view',
  'inventory.count',
  'inventory.receive',
  'inventory.products',
  'inventory.records.delete',
  'inventory.suppliers',
  'menu.view',
  'menu.edit',
  'store.charge',
  'store.sales.manual',
  'store.sales.view',
  'store.sales.void',
  'store.stats',
  'store.stats.full',
  'store.recipes.view',
  'store.recipes.edit',
  'access.manage',
] as const;

export type Perm = (typeof PERMS)[number];

/** The roles the access window describes, in the order it lists them. */
export const ROLES: readonly Role[] = ['manager', 'employee', 'store'];

export function isPerm(value: unknown): value is Perm {
  return typeof value === 'string' && (PERMS as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * A list as the server sent it, as this client keeps it: each permission it
 * knows, once, in the table's order. One it has never heard of (a server a
 * release ahead) is passed over -- nothing here would ask for it -- and a body
 * that is not a list at all is no list: `undefined`, not "none", so that the
 * caller can tell "not said" from "said nothing".
 */
export function knownPerms(value: unknown): Perm[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return PERMS.filter((perm) => value.includes(perm));
}

/**
 * What an account may do, from the best source there is: the latest answer of
 * `GET /workspace`, then what the sign-in said (kept with the session), and
 * with neither -- a session saved before the server sent the list -- the
 * manager everything, as before this existed, and anybody else nothing.
 * Nothing is the safe side of not knowing: the screen of an employee who is
 * shown too little is fixed by the answer a moment later; one shown too much
 * has already pressed the button.
 */
export function resolvePermissions(
  role: Role | string | null | undefined,
  saved: unknown,
  fresh?: unknown,
): Perm[] {
  return knownPerms(fresh) ?? knownPerms(saved) ?? (role === 'manager' ? [...PERMS] : []);
}

/**
 * Whether the screens have to wait for `GET /workspace` before they are built,
 * because what this account may do is not known yet: a session saved before
 * the server sent `permissions` (UserOut), of anybody but a manager, while
 * the answer has not come. Without the wait, the router is built for "none"
 * (resolvePermissions) and an employee's link to /inventory is sent to `/`
 * before the answer arrives to say they may open it.
 *
 * A manager never waits: without a list they are taken to have everything,
 * as before this existed. Nor does anybody once the answer is in -- with the
 * list or without it (a server a release behind): what it did not say, it
 * will not say by waiting longer.
 */
export function permissionsPending(
  role: Role | string | null | undefined,
  saved: unknown,
  answered: boolean,
): boolean {
  if (answered || role === 'manager') return false;
  return knownPerms(saved) === undefined;
}

/** Whether the list allows `perm`. No list is no. */
export function can(permissions: readonly string[] | null | undefined, perm: Perm): boolean {
  return Array.isArray(permissions) && permissions.includes(perm);
}

/** The items of a list that the account may see: each with no `perm`, or one it has. */
export function allowed<T extends { perm?: Perm }>(
  items: readonly T[],
  permissions: readonly string[] | null | undefined,
): T[] {
  return items.filter((item) => item.perm === undefined || can(permissions, item.perm));
}

/** Whether two lists say the same, read as `knownPerms` reads them. A missing list is not an empty one. */
export function samePerms(a: unknown, b: unknown): boolean {
  const x = knownPerms(a);
  const y = knownPerms(b);
  if (x === undefined || y === undefined) return x === y;
  return x.length === y.length && x.every((perm, i) => perm === y[i]);
}

// --- The access window's table ------------------------------------------------
//
// "What each one can do": a row per permission, a column per role, from the
// table the server sends with the list of accounts (GET /access, `roles`).
// Only the rows of the apps the business has -- a shop's permissions mean
// nothing to a business without the shop -- and the business's own last.

export type PermGroup = 'inventory' | 'store' | 'business';

const GROUP_OF: Record<Perm, PermGroup> = {
  'inventory.view': 'inventory',
  'inventory.count': 'inventory',
  'inventory.receive': 'inventory',
  'inventory.products': 'inventory',
  'inventory.records.delete': 'inventory',
  'inventory.suppliers': 'inventory',
  'menu.view': 'store',
  'menu.edit': 'store',
  'store.charge': 'store',
  'store.sales.manual': 'store',
  'store.sales.view': 'store',
  'store.sales.void': 'store',
  'store.stats': 'store',
  'store.stats.full': 'store',
  'store.recipes.view': 'store',
  'store.recipes.edit': 'store',
  'access.manage': 'business',
};

export interface PermRow {
  /**
   * What the row says, as `access.perm.<label>`: the permission's own name,
   * or one of the things a permission covers that is worth a line of its own
   * (EXTRA_ROWS).
   */
  label: string;
  perm: Perm;
  /** Whether each role has it. */
  byRole: Record<Role, boolean>;
}

/**
 * Things the table says in a row of their own although no permission is
 * named after them: ordering from a supplier is seeing the stock and the
 * suppliers (`inventory.view`) and sending a message, and a manager looking
 * for "can they order?" should find it said. Each goes right after `after`.
 */
const EXTRA_ROWS: readonly { after: Perm; label: string; perm: Perm }[] = [
  { after: 'inventory.receive', label: 'inventory.order', perm: 'inventory.view' },
];

export function permissionTable(
  roles: Partial<Record<Role, readonly string[]>>,
  apps: readonly string[],
): { group: PermGroup; rows: PermRow[] }[] {
  const groups: PermGroup[] = [
    ...(apps.includes('inventory') ? (['inventory'] as const) : []),
    ...(apps.includes('store') ? (['store'] as const) : []),
    'business',
  ];
  const row = (label: string, perm: Perm): PermRow => ({
    label,
    perm,
    byRole: Object.fromEntries(ROLES.map((role) => [role, can(roles[role], perm)])) as Record<Role, boolean>,
  });
  return groups.map((group) => ({
    group,
    rows: PERMS.filter((perm) => GROUP_OF[perm] === group).flatMap((perm) => [
      row(perm, perm),
      ...EXTRA_ROWS.filter((extra) => extra.after === perm).map((extra) => row(extra.label, extra.perm)),
    ]),
  }));
}

/**
 * What an account of `role` gets into, app by app, for the sentence that
 * tells the manager before they give it (TeamAccessCard, the access window):
 * an employee their own shifts and the business's inventory and shop; a shop
 * account the same but the shifts. Only the apps the business has.
 */
export function accessScope(role: 'employee' | 'store', apps: readonly string[]): ('shifts' | 'inventory' | 'store')[] {
  const order = ['shifts', 'inventory', 'store'] as const;
  return order.filter((app) => apps.includes(app) && !(role === 'store' && app === 'shifts'));
}

/**
 * Whether an address has the shape of one: one @, something before it, a
 * domain with a dot, no spaces -- the server's own wall (routers/auth.py,
 * looks_like_an_email). Checked before sending, so the refusal is said in the
 * app's words and language, not in a bubble of the browser's.
 */
export function looksLikeEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}
