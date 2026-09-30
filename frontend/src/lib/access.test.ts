// What each account may do, read the one way every screen reads it. The
// table itself is the server's (backend/app/access.py); these are the lists
// it sends for each role today, written out so a change on either side shows.

import { describe, expect, it } from 'vitest';
import {
  looksLikeEmail,
  accessScope,
  allowed,
  can,
  isPerm,
  knownPerms,
  PERMS,
  permissionsPending,
  permissionTable,
  resolvePermissions,
  samePerms,
  type Perm,
} from './access';

/** The employee's and the shop account's list, as the contract says it. */
const TEAM: Perm[] = [
  'inventory.view',
  'inventory.count',
  'inventory.receive',
  'menu.view',
  'store.charge',
  'store.sales.view',
  'store.sales.void',
  'store.stats',
  'store.recipes.view',
];

describe('can', () => {
  it('lets the manager do everything', () => {
    for (const perm of PERMS) expect(can(PERMS, perm)).toBe(true);
  });

  it("keeps an employee off the products, the suppliers, the menu and the recipes -- Max's four", () => {
    expect(can(TEAM, 'inventory.products')).toBe(false);
    expect(can(TEAM, 'inventory.suppliers')).toBe(false);
    expect(can(TEAM, 'menu.edit')).toBe(false);
    expect(can(TEAM, 'store.recipes.edit')).toBe(false);
    // The full statistics are the manager's; the ones there are today, theirs.
    expect(can(TEAM, 'store.stats.full')).toBe(false);
    expect(can(TEAM, 'store.stats')).toBe(true);
  });

  it('lets them count, receive, charge and void', () => {
    for (const perm of ['inventory.count', 'inventory.receive', 'store.charge', 'store.sales.void'] as const) {
      expect(can(TEAM, perm)).toBe(true);
    }
  });

  it('keeps deleting a record, a sale by hand and the access window for the manager', () => {
    expect(can(TEAM, 'inventory.records.delete')).toBe(false);
    expect(can(TEAM, 'store.sales.manual')).toBe(false);
    expect(can(TEAM, 'access.manage')).toBe(false);
  });

  it('says no with no list', () => {
    expect(can(undefined, 'inventory.view')).toBe(false);
    expect(can(null, 'inventory.view')).toBe(false);
    expect(can([], 'inventory.view')).toBe(false);
  });
});

describe('knownPerms', () => {
  it("keeps the table's order and what it knows, once", () => {
    expect(knownPerms(['store.charge', 'inventory.view', 'inventory.view', 'menu.teleport', 7])).toEqual([
      'inventory.view',
      'store.charge',
    ]);
  });

  it('tells "not said" from "nothing"', () => {
    expect(knownPerms(undefined)).toBeUndefined();
    expect(knownPerms('inventory.view')).toBeUndefined();
    expect(knownPerms([])).toEqual([]);
  });

  it('knows each permission by name', () => {
    expect(isPerm('access.manage')).toBe(true);
    expect(isPerm('access')).toBe(false);
  });
});

describe('resolvePermissions', () => {
  it("takes the workspace's answer over the sign-in's", () => {
    expect(resolvePermissions('employee', ['inventory.view'], ['store.charge'])).toEqual(['store.charge']);
  });

  it("takes the sign-in's while the answer has not come", () => {
    expect(resolvePermissions('employee', TEAM, undefined)).toEqual(TEAM);
  });

  it('gives a manager saved before the server said everything, as before', () => {
    expect(resolvePermissions('manager', undefined)).toEqual([...PERMS]);
  });

  it('gives anybody else saved before the server said nothing', () => {
    expect(resolvePermissions('employee', undefined)).toEqual([]);
    expect(resolvePermissions('store', undefined)).toEqual([]);
    expect(resolvePermissions(undefined, undefined)).toEqual([]);
  });

  it('believes a manager the server says less of', () => {
    // The server's table is the truth, whatever the role.
    expect(resolvePermissions('manager', ['inventory.view'])).toEqual(['inventory.view']);
  });
});

describe('permissionsPending', () => {
  it('holds an employee or a shop account saved without a list until the answer comes', () => {
    expect(permissionsPending('employee', undefined, false)).toBe(true);
    expect(permissionsPending('store', undefined, false)).toBe(true);
    // Something that is not a list is no list.
    expect(permissionsPending('employee', 'inventory.view', false)).toBe(true);
  });

  it('holds nobody once the answer is in, with a list or without one', () => {
    expect(permissionsPending('employee', undefined, true)).toBe(false);
    expect(permissionsPending('store', undefined, true)).toBe(false);
  });

  it('never holds a manager, who without a list has everything', () => {
    expect(permissionsPending('manager', undefined, false)).toBe(false);
  });

  it('does not hold a session that came with its list, even an empty one', () => {
    expect(permissionsPending('employee', TEAM, false)).toBe(false);
    expect(permissionsPending('store', [], false)).toBe(false);
  });
});

describe('samePerms', () => {
  it('compares as knownPerms reads', () => {
    expect(samePerms(['store.charge', 'inventory.view'], ['inventory.view', 'store.charge'])).toBe(true);
    expect(samePerms(['inventory.view'], ['inventory.view', 'store.charge'])).toBe(false);
    expect(samePerms(undefined, [])).toBe(false);
    expect(samePerms(undefined, undefined)).toBe(true);
  });
});

describe('allowed', () => {
  it('keeps what needs nothing and what the list has', () => {
    const items = [{ id: 1 }, { id: 2, perm: 'menu.edit' as Perm }, { id: 3, perm: 'menu.view' as Perm }];
    expect(allowed(items, TEAM).map((i) => i.id)).toEqual([1, 3]);
    expect(allowed(items, PERMS).map((i) => i.id)).toEqual([1, 2, 3]);
    expect(allowed(items, undefined).map((i) => i.id)).toEqual([1]);
  });
});

describe('permissionTable', () => {
  const roles = { manager: [...PERMS], employee: TEAM, store: TEAM };

  it("has a group per app the business has, and the business's own last", () => {
    expect(permissionTable(roles, ['shifts', 'inventory', 'store']).map((g) => g.group)).toEqual([
      'inventory',
      'store',
      'business',
    ]);
    expect(permissionTable(roles, ['shifts']).map((g) => g.group)).toEqual(['business']);
  });

  it('says for each role whether it may, from the server’s table', () => {
    const inventory = permissionTable(roles, ['inventory'])[0];
    const products = inventory.rows.find((r) => r.perm === 'inventory.products')!;
    expect(products.byRole).toEqual({ manager: true, employee: false, store: false });
    const count = inventory.rows.find((r) => r.perm === 'inventory.count')!;
    expect(count.byRole).toEqual({ manager: true, employee: true, store: true });
  });

  it('lists every permission of a business with every app once, under its own name', () => {
    const rows = permissionTable(roles, ['inventory', 'store']).flatMap((g) => g.rows);
    expect(rows.filter((r) => r.label === r.perm).map((r) => r.perm)).toEqual([...PERMS]);
  });

  it('says ordering from a supplier in a row of its own, right after receiving, as seeing the stock', () => {
    const inventory = permissionTable(roles, ['inventory'])[0];
    const labels = inventory.rows.map((r) => r.label);
    expect(labels.slice(0, 4)).toEqual(['inventory.view', 'inventory.count', 'inventory.receive', 'inventory.order']);
    const order = inventory.rows.find((r) => r.label === 'inventory.order')!;
    expect(order.perm).toBe('inventory.view');
    expect(order.byRole).toEqual({ manager: true, employee: true, store: true });
    // Taken away with the stock, should the server's table ever do so.
    const without = permissionTable({ manager: [...PERMS], employee: [], store: TEAM }, ['inventory'])[0];
    expect(without.rows.find((r) => r.label === 'inventory.order')!.byRole.employee).toBe(false);
  });

  it('has no ordering row without the inventory', () => {
    const labels = permissionTable(roles, ['store']).flatMap((g) => g.rows.map((r) => r.label));
    expect(labels).not.toContain('inventory.order');
  });

  it('reads a role the server did not describe as one that may do nothing', () => {
    const [business] = permissionTable({ manager: ['access.manage'] }, []);
    expect(business.rows[0].byRole).toEqual({ manager: true, employee: false, store: false });
  });
});

describe('accessScope', () => {
  it('gives an employee their shifts and the business’s inventory and shop', () => {
    expect(accessScope('employee', ['store', 'inventory', 'shifts'])).toEqual(['shifts', 'inventory', 'store']);
    expect(accessScope('employee', ['shifts'])).toEqual(['shifts']);
  });

  it('gives a shop account the same without the shifts', () => {
    expect(accessScope('store', ['shifts', 'inventory', 'store'])).toEqual(['inventory', 'store']);
    expect(accessScope('store', ['shifts'])).toEqual([]);
  });
});

describe('looksLikeEmail', () => {
  it('takes an address, spaces around it and all', () => {
    expect(looksLikeEmail('barra@bar.es')).toBe(true);
    expect(looksLikeEmail('  Tienda@Bar.es ')).toBe(true);
  });

  it('refuses what the server refuses', () => {
    for (const bad of ['barra', 'barra@', '@bar.es', 'barra@tablet', 'bar ra@bar.es', 'a@b@bar.es', 'barra@bar es', '']) {
      expect(looksLikeEmail(bad), bad).toBe(false);
    }
  });
});
