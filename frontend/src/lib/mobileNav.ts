// What the phone's bar says about the page you are on. Below `md` the sidebar
// steps aside for a bar across the top (components/layout/MobileNav.tsx), and
// the bar names the page: the sidebar's own link for it, by the rules the
// sidebar lights that link with. Pure, so which name a detail page gets (a
// sale, a count) is tested here rather than looked for on a screen.

import { sectionOf } from './motion/chrome';
import type { NavItem } from './nav';

/** `/a/b/` and `/a/b` are the same page, as they are to the router. */
function trimSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Whether `item` is lit on the page at `path`, as NavLink decides it in the
 * sidebar (DashboardLayout's SideLink): with `end`, only its own address; on
 * a page under its `details` the `end` is lifted; without it, its address
 * and anything below it. `/` with `end` is only the home page.
 */
export function isCurrentLink(item: NavItem, path: string): boolean {
  const p = trimSlash(path).toLowerCase();
  const to = trimSlash(item.to).toLowerCase();
  const onDetail = item.details !== undefined && sectionOf(p, [item.details.toLowerCase()]) !== null;
  const end = item.end === true && !onDetail;
  if (p === to) return true;
  if (end) return false;
  return to === '/' ? true : p.startsWith(`${to}/`);
}

/**
 * The link the page at `path` belongs to, among `links` (the sidebar's, the
 * common ones included): the longest that is lit, so a count's page belongs
 * to Counts and not to Stock. `null` for a page under none of them.
 */
export function currentLink(path: string, links: readonly NavItem[]): NavItem | null {
  let best: NavItem | null = null;
  for (const item of links) {
    if (!isCurrentLink(item, path)) continue;
    if (best === null || trimSlash(item.to).length > trimSlash(best.to).length) best = item;
  }
  return best;
}

/**
 * The dictionary key the bar is titled with: the page's link, or -- a page
 * the sidebar does not list -- the app's own name (`fallbackKey`).
 */
export function barTitleKey(path: string, links: readonly NavItem[], fallbackKey: string): string {
  return currentLink(path, links)?.labelKey ?? fallbackKey;
}
