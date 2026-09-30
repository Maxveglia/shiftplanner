// Which links each account is shown in the sidebar of each app.

import { describe, expect, it } from 'vitest';
import { PERMS, type Perm } from './access';
import { COMMON_NAV, INVENTORY_NAV, SECTIONS, sidebarFor, STORE_NAV } from './nav';

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

const to = (items: { to: string }[]) => items.map((i) => i.to);

describe('sidebarFor', () => {
  it('shows the manager every page of the app, and Access under them', () => {
    expect(to(sidebarFor('inventory', PERMS).items)).toEqual(to(INVENTORY_NAV));
    expect(to(sidebarFor('store', PERMS).items)).toEqual(to(STORE_NAV));
    expect(to(sidebarFor('shifts', PERMS).common)).toEqual(['/access']);
    expect(to(sidebarFor('store', PERMS).common)).toEqual(['/access']);
  });

  it('shows an employee and a shop account every page of the inventory and the shop, and no Access', () => {
    // Suppliers too: read only, they need it to order.
    expect(to(sidebarFor('inventory', TEAM).items)).toEqual([
      '/inventory',
      '/inventory/receive',
      '/inventory/count',
      '/inventory/counts',
      '/inventory/receipts',
      '/inventory/suppliers',
    ]);
    expect(to(sidebarFor('store', TEAM).items)).toEqual(['/store/menu', '/store', '/store/stats', '/store/recipes']);
    expect(sidebarFor('inventory', TEAM).common).toEqual([]);
  });

  it('leaves out a page whose permission the account lacks', () => {
    const noSales = TEAM.filter((p) => p !== 'store.sales.view' && p !== 'inventory.receive');
    expect(to(sidebarFor('store', noSales).items)).toEqual(['/store/menu', '/store/stats', '/store/recipes']);
    expect(to(sidebarFor('inventory', noSales).items)).not.toContain('/inventory/receive');
  });

  it('shows nothing to an account the server has said nothing of', () => {
    expect(sidebarFor('inventory', []).items).toEqual([]);
    expect(sidebarFor('store', undefined).items).toEqual([]);
  });

  it('has only the common links with no app', () => {
    expect(sidebarFor(null, PERMS)).toEqual({ items: [], common: COMMON_NAV });
  });
});

describe('SECTIONS', () => {
  it('knows every destination once, Access included', () => {
    expect(new Set(SECTIONS).size).toBe(SECTIONS.length);
    expect(SECTIONS).toContain('/access');
  });
});
