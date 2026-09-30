import { describe, expect, it } from 'vitest';
import { barTitleKey, currentLink, isCurrentLink } from './mobileNav';
import { COMMON_NAV, INVENTORY_NAV, SHIFTS_NAV, STORE_NAV, type NavItem } from './nav';

const inventory = [...INVENTORY_NAV, ...COMMON_NAV];
const store = [...STORE_NAV, ...COMMON_NAV];
const shifts = [...SHIFTS_NAV, ...COMMON_NAV];

describe('isCurrentLink', () => {
  const home: NavItem = { to: '/', labelKey: 'h', end: true };
  const stock: NavItem = { to: '/inventory', labelKey: 's', end: true };
  const counts: NavItem = { to: '/inventory/counts', labelKey: 'c' };
  const sales: NavItem = { to: '/store', labelKey: 'v', end: true, details: '/store/sales' };

  it('with `end`, only its own address', () => {
    expect(isCurrentLink(stock, '/inventory')).toBe(true);
    expect(isCurrentLink(stock, '/inventory/')).toBe(true);
    expect(isCurrentLink(stock, '/inventory/count')).toBe(false);
    expect(isCurrentLink(home, '/')).toBe(true);
    expect(isCurrentLink(home, '/employees')).toBe(false);
  });

  it('without `end`, its address and what hangs below it, not a longer name', () => {
    expect(isCurrentLink(counts, '/inventory/counts')).toBe(true);
    expect(isCurrentLink(counts, '/inventory/counts/abc')).toBe(true);
    expect(isCurrentLink(counts, '/inventory/countsx')).toBe(false);
    expect(isCurrentLink(counts, '/inventory')).toBe(false);
  });

  it('lifts `end` on a page under its details, as the sidebar does', () => {
    expect(isCurrentLink(sales, '/store')).toBe(true);
    expect(isCurrentLink(sales, '/store/sales/123')).toBe(true);
    expect(isCurrentLink(sales, '/store/stats')).toBe(false);
    expect(isCurrentLink(sales, '/store/menu')).toBe(false);
  });

  it('ignores case, as the router does', () => {
    expect(isCurrentLink(counts, '/Inventory/Counts')).toBe(true);
  });
});

describe('currentLink', () => {
  it('names each page of the inventory by its own link', () => {
    expect(currentLink('/inventory', inventory)?.to).toBe('/inventory');
    expect(currentLink('/inventory/count', inventory)?.to).toBe('/inventory/count');
    expect(currentLink('/inventory/counts', inventory)?.to).toBe('/inventory/counts');
    expect(currentLink('/inventory/counts/42', inventory)?.to).toBe('/inventory/counts');
    expect(currentLink('/inventory/receipts/9', inventory)?.to).toBe('/inventory/receipts');
    expect(currentLink('/inventory/suppliers', inventory)?.to).toBe('/inventory/suppliers');
  });

  it('puts a sale under Sales and the other shop pages under their own', () => {
    expect(currentLink('/store', store)?.labelKey).toBe('chrome.nav.sales');
    expect(currentLink('/store/sales/abc', store)?.labelKey).toBe('chrome.nav.sales');
    expect(currentLink('/store/stats', store)?.labelKey).toBe('chrome.nav.stats');
    expect(currentLink('/store/menu', store)?.labelKey).toBe('chrome.nav.menu');
    expect(currentLink('/store/recipes', store)?.labelKey).toBe('chrome.nav.recipes');
  });

  it('finds the common pages from any app', () => {
    for (const links of [inventory, store, shifts]) {
      expect(currentLink('/access', links)?.labelKey).toBe('chrome.nav.access');
    }
  });

  it('keeps the dashboard to its own address and a person under Employees', () => {
    expect(currentLink('/', shifts)?.labelKey).toBe('chrome.nav.dashboard');
    expect(currentLink('/employees/7', shifts)?.labelKey).toBe('chrome.nav.employees');
  });

  it('is null for a page no link lists, or a link the account is not shown', () => {
    expect(currentLink('/welcome', shifts)).toBeNull();
    expect(currentLink('/store/unknown', store)).toBeNull();
    // An employee without Access among its links: the page is nobody's.
    expect(currentLink('/access', INVENTORY_NAV)).toBeNull();
    expect(currentLink('/inventory', [])).toBeNull();
  });
});

describe('barTitleKey', () => {
  it("is the link's label, or the app's name for a page no link lists", () => {
    expect(barTitleKey('/inventory/count', inventory, 'chrome.apps.inventory')).toBe('chrome.nav.newCount');
    expect(barTitleKey('/store/sales/1', store, 'chrome.apps.store')).toBe('chrome.nav.sales');
    expect(barTitleKey('/welcome', shifts, 'chrome.apps.shifts')).toBe('chrome.apps.shifts');
  });
});
