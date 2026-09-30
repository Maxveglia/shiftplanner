// The sidebar of each app, and what each account sees of it. Pure, so which
// links an employee or a shop account gets is tested (nav.test.ts) rather than
// looked for on a screen; DashboardLayout only draws it.
//
// A link carries the permission its page needs (lib/access.ts). The router
// holds the same rule (App.tsx): a link that is not drawn leads to a page that
// is not there either, and one typed into the address bar is sent to the
// app's home.

import { allowed, type Perm } from './access';
import type { AppKey } from './apps';

export interface NavItem {
  to: string;
  /** Dictionary key, resolved at render: the sidebar has to move with the language. */
  labelKey: string;
  end?: boolean;
  /**
   * Where the link's own details live when they are not under it: the sales
   * list is at the shop's root, `/store`, which has to match only itself
   * (every other page of the shop hangs below it too), while a sale opens at
   * `/store/sales/:id`. On a page under this, `end` is lifted, and the link
   * is lit as a list is over one of its rows.
   */
  details?: string;
  /** What an account needs to be shown the link; none, everybody who has the app. */
  perm?: Perm;
}

// Three sections and a settings page: the product (Dashboard), the data it
// feeds on (Employees), the recurring action (Absences), and Settings last
// because it is visited once and then forgotten. Shift templates and labour
// rules moved into the Dashboard -- they are configuration the scheduler
// consumes, not destinations. The old Calendar page duplicated the Dashboard.
// The manager's alone: an employee's shifts are their own screen
// (EmployeeLayout), and a shop account has no shifts at all, so this sidebar
// is never drawn for either.
export const SHIFTS_NAV: NavItem[] = [
  { to: '/', labelKey: 'chrome.nav.dashboard', end: true },
  { to: '/employees', labelKey: 'chrome.nav.employees' },
  { to: '/absences', labelKey: 'chrome.nav.absences' },
  // What happened each day, written by the manager and shared with a list.
  { to: '/notes', labelKey: 'chrome.nav.dayNotes' },
  // Not configuration and not a destination people visit twice a day, but the
  // one place that answers "why is half this shift a darker blue?" -- which
  // stopped being a question about decoration when those hours started being
  // paid 25% more.
  { to: '/colours', labelKey: 'chrome.nav.colours' },
  { to: '/settings', labelKey: 'chrome.nav.settings' },
];

// The second app in the workspace. Same layout, same session, its own sidebar.
// The two things done to the stock first (receive a delivery, count), then
// the two histories they leave. Last, who the products are ordered from: set
// once, and read by the low-stock notice (components/inventory/OrderAlert.tsx).
// An employee and a shop account have every page, the suppliers read only.
export const INVENTORY_NAV: NavItem[] = [
  { to: '/inventory', labelKey: 'chrome.nav.stock', end: true, perm: 'inventory.view' },
  { to: '/inventory/receive', labelKey: 'chrome.nav.receive', perm: 'inventory.receive' },
  { to: '/inventory/count', labelKey: 'chrome.nav.newCount', perm: 'inventory.count' },
  { to: '/inventory/counts', labelKey: 'chrome.nav.counts', perm: 'inventory.view' },
  { to: '/inventory/receipts', labelKey: 'chrome.nav.receipts', perm: 'inventory.view' },
  { to: '/inventory/suppliers', labelKey: 'chrome.nav.suppliers', perm: 'inventory.view' },
];

// The third: what the business sells. The menu first -- what is sold, and
// where the shop opens (Max asked for it first, 27-sep-2026) -- then the
// sales, entered every day, and what they add up to. The menu lived in the
// inventory until the shop existed: it is what is sold, not what is kept.
// Last, the recipes: what each product takes from the inventory, set once
// and seen nowhere else (not in Sales, not in Menu).
export const STORE_NAV: NavItem[] = [
  { to: '/store/menu', labelKey: 'chrome.nav.menu', perm: 'menu.view' },
  { to: '/store', labelKey: 'chrome.nav.sales', end: true, details: '/store/sales', perm: 'store.sales.view' },
  { to: '/store/stats', labelKey: 'chrome.nav.stats', perm: 'store.stats' },
  { to: '/store/recipes', labelKey: 'chrome.nav.recipes', perm: 'store.recipes.view' },
];

export const NAV: Record<AppKey, NavItem[]> = {
  shifts: SHIFTS_NAV,
  inventory: INVENTORY_NAV,
  store: STORE_NAV,
};

// Below every app's own links, the pages of none (COMMON_PATHS, lib/apps.ts):
// who can sign in to the business, and as what. The manager's.
export const COMMON_NAV: NavItem[] = [{ to: '/access', labelKey: 'chrome.nav.access', perm: 'access.manage' }];

/**
 * Every destination in the sidebar, top to bottom, every app: the order a
 * page's entrance reads its direction from (lib/motion/chrome.ts). The list is
 * also what tells a detail (/inventory/receipts/:id) from a section.
 */
export const SECTIONS: string[] = [...SHIFTS_NAV, ...INVENTORY_NAV, ...STORE_NAV, ...COMMON_NAV].map(
  (item) => item.to,
);

/**
 * The sidebar an account is shown in `app`: the app's links it may open, then
 * the common ones it may. `app` is null only for a business with no app at
 * all, whose manager has typed a common page's address.
 */
export function sidebarFor(
  app: AppKey | null,
  permissions: readonly string[] | null | undefined,
): { items: NavItem[]; common: NavItem[] } {
  return {
    items: app ? allowed(NAV[app], permissions) : [],
    common: allowed(COMMON_NAV, permissions),
  };
}
