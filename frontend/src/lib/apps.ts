// The apps in the workspace, in one list everything that names them reads:
// the launcher a manager lands on after signing in (and opens from the logo in
// the sidebar), the logo itself, which shows the app you are in, and the
// router, which mounts only the apps a business has. Two copies would drift
// -- a third app added to one and not the other is an app some managers
// never find.

import type { Role } from '../types';
import { can, samePerms, type Perm } from './access';

export type AppKey = 'shifts' | 'inventory' | 'store';

export interface WorkspaceApp {
  key: AppKey;
  /** Where the app opens. */
  home: string;
  /**
   * The address every page of the app hangs below, when it is not `home`
   * itself: the shop opens at its menu, `/store/menu`, and its sales and
   * statistics are its pages too.
   */
  root?: string;
  /** Short name, as the sidebar's switcher says it. */
  labelKey: string;
  /**
   * What an account needs, besides the business having the app, to open it:
   * the permission its home asks for (lib/access.ts). None for the shifts app,
   * which every account that has it opens -- the manager on the dashboard, an
   * employee on their own shifts.
   */
  entry?: Perm;
}

export const APPS: WorkspaceApp[] = [
  {
    key: 'shifts',
    home: '/',
    labelKey: 'chrome.apps.shifts',
  },
  {
    key: 'inventory',
    home: '/inventory',
    labelKey: 'chrome.apps.inventory',
    entry: 'inventory.view',
  },
  // What the business sells: the menu, the sales, and what they add up to.
  // It opens at the menu, the first of its pages (Max, 27-sep-2026).
  {
    key: 'store',
    home: '/store/menu',
    root: '/store',
    labelKey: 'chrome.apps.store',
    entry: 'menu.view',
  },
];

/**
 * Each app's colours, wherever its icon is drawn -- the launcher's tile, the
 * sidebar's, the sign-in's, the employee's header: the icon's face from its
 * top-left corner to its bottom-right, and its accent as bare RGB channels
 * (read as `rgb(<accent> / alpha)` for glows). Menta is the brand's; the
 * inventory takes a warm amber so the two read as two apps at a glance.
 *
 * The shop takes violet, about as far round the wheel from each of them as
 * they are from each other. Not a rose or a red, which on this ground would
 * be read as the danger colour; not a blue, which beside menta a colour-blind
 * eye takes for the same teal. The colour is never the only thing that tells
 * them apart -- each app has its own mark and its name under it.
 */
export const APP_LOOK: Record<AppKey, { face: [string, string]; accent: string }> = {
  shifts: { face: ['#44d6b4', '#0a6654'], accent: '68 214 180' },
  inventory: { face: ['#fcc463', '#b4580d'], accent: '251 176 64' },
  store: { face: ['#b69cff', '#5534b8'], accent: '167 139 250' },
};

/** The platform operator's icon (the back office): slate, never an app's colour,
 *  so an operator's screen cannot be mistaken for a customer's. */
export const OPERATOR_FACE: [string, string] = ['#94a3b8', '#334155'];

export const LAUNCHER_PATH = '/apps';

// --- Which apps a business has --------------------------------------------
//
// Not every business has every app: each one is served from its own folder on
// the server (backend/app/clients/), and a business starts with the
// template's -- the shifts and inventory apps, and its workspace said to be
// still being set up -- until we build it its own. The server says which in `GET /workspace`
// and in the user it returns at sign-in; everything here reads that list
// through these few functions, so "which apps" has one answer on every
// screen.

/**
 * The apps a business has on, as this client knows them: in the order of
 * APPS (the launcher's), each once, and nothing it has never heard of -- a
 * server a release ahead may already name an app this bundle has no screens
 * for, and a tile that opens nothing is worse than no tile.
 */
export function activeApps(keys: readonly unknown[] | null | undefined): WorkspaceApp[] {
  if (!Array.isArray(keys)) return [];
  return APPS.filter((app) => keys.includes(app.key));
}

/** The keys of `activeApps`: the list as the rest of the client keeps it. */
export function knownAppKeys(keys: readonly unknown[] | null | undefined): AppKey[] {
  return activeApps(keys).map((app) => app.key);
}

export function hasApp(keys: readonly unknown[] | null | undefined, key: AppKey): boolean {
  return Array.isArray(keys) && keys.includes(key);
}

/**
 * Whether two lists name the same apps, read as `knownAppKeys` reads them.
 * A list that is missing is not the same as an empty one: a session saved
 * before the server sent the list has not been told "none", it has not been
 * told at all.
 */
export function sameApps(
  a: readonly unknown[] | null | undefined,
  b: readonly unknown[] | null | undefined,
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  const x = knownAppKeys(a);
  const y = knownAppKeys(b);
  return x.length === y.length && x.every((key, i) => key === y[i]);
}

/**
 * Whether the user kept in this browser already says what `GET /workspace`
 * says: the same apps, read as `sameApps` reads them, and the same word on
 * whether the workspace is still being set up. Only `true` is yes there: a
 * session saved before the server sent it has not been told, and for every
 * business that is ready -- nearly all of them -- that is the right answer
 * already, so it is not a difference worth a render.
 */
export function sameWorkspace(
  kept: { apps?: readonly unknown[] | null; preparing?: unknown; role?: unknown; permissions?: unknown },
  answer: { apps?: readonly unknown[] | null; preparing?: unknown; role?: unknown; permissions?: unknown },
): boolean {
  return (
    sameApps(kept.apps, answer.apps) &&
    (kept.preparing === true) === (answer.preparing === true) &&
    // The role and what it may do, only when the answer says them: a server
    // a release behind says neither, and that is no news.
    (answer.role === undefined || kept.role === answer.role) &&
    (answer.permissions === undefined || samePerms(kept.permissions, answer.permissions))
  );
}

/**
 * The apps an account can open: the business's, each one it may enter
 * (`entry`). The shifts app is the manager's and each employee's -- their own
 * shifts -- and nobody else's: a shop account is a tablet, not a person, and
 * has no shifts to see. The server leaves it out of that account's list, and
 * so does this, should a list say otherwise.
 */
export function appsFor(
  role: Role | string | null | undefined,
  keys: readonly unknown[] | null | undefined,
  permissions: readonly string[] | null | undefined,
): WorkspaceApp[] {
  return activeApps(keys).filter((app) =>
    app.key === 'shifts'
      ? role === 'manager' || role === 'employee'
      : role === 'manager' || app.entry === undefined || can(permissions, app.entry),
  );
}

/**
 * Where `/` leads a manager. With the shifts app it is its dashboard, as it
 * has always been (the shifts app's home IS `/`); without it, the first app
 * that is on; with none, the launcher -- which is where a business with
 * nothing to open is told its workspace is being set up.
 */
export function homeFor(keys: readonly unknown[] | null | undefined): string {
  return activeApps(keys)[0]?.home ?? LAUNCHER_PATH;
}

// That the next screen is being opened by the launcher's reveal, which ends on
// the layout's own ground: the layout fades up out of it. A note in memory and
// not in the router's state, because the layout had to wipe that state on
// arrival -- a second navigation, and a second render of the whole dashboard,
// at the moment it was mounting. Read while rendering and cleared once
// mounted (not cleared by the read: React may render twice before it
// mounts), so Back and a reload never see it.
let arriving = false;

export function markLauncherArrival(): void {
  arriving = true;
}

export function launcherArrivalPending(): boolean {
  return arriving;
}

export function clearLauncherArrival(): void {
  arriving = false;
}

/**
 * The app a page belongs to: the one whose root (its home, unless it says
 * otherwise) the path is, or hangs below. The shifts app's home is `/`, under
 * which everything hangs, so it is what a path is when it is under no other
 * app's.
 */
export function appFor(pathname: string): AppKey | null {
  if (isCommonPath(pathname)) return null;
  const app = APPS.find(({ home, root = home }) => {
    return root !== '/' && (pathname === root || pathname.startsWith(`${root}/`));
  });
  return app?.key ?? 'shifts';
}

/**
 * The pages that belong to no app, and are reached from the sidebar of every
 * one: who has access to the business (/access). They open inside whichever
 * app they were opened from, and the first-run questions -- the shifts
 * app's -- do not stand in front of them.
 */
export const COMMON_PATHS = ['/access'] as const;

export function isCommonPath(pathname: string): boolean {
  return COMMON_PATHS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * What a visit to the launcher carries in the router's state. Only a sign-in
 * is greeted: a manager who opens the launcher from the logo, halfway through
 * their day, has not just arrived. `from` is the page they opened it from.
 */
export interface LauncherVisit {
  signedIn?: boolean;
  from?: string;
}

export function launcherVisit(state: unknown): LauncherVisit {
  if (!state || typeof state !== 'object') return {};
  const { signedIn, from } = state as Record<string, unknown>;
  return {
    signedIn: signedIn === true,
    // A path in this app; `//host/...` would be another site.
    from: typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : undefined,
  };
}

/**
 * What the launcher puts above its tiles, which is what a manager reads first:
 *
 * - `empty`: no app to open. The workspace is being set up, and that is all
 *   the screen says -- whatever the profile says, as it cannot be anything
 *   else.
 * - `preparing`: the business's name alone, in the greeting's place, with
 *   the tiles of the apps it already has under it. Said on every visit, not
 *   only after a sign-in: it is how things stand, not a hello.
 * - `greeting`: a sign-in, greeted by name.
 * - `quiet`: opened from inside an app. Nothing to read; a heading only a
 *   screen reader hears, naming the tiles.
 */
export type LauncherHead = 'empty' | 'preparing' | 'greeting' | 'quiet';

export function launcherHead(
  appCount: number,
  preparing: boolean,
  signedIn: boolean | undefined,
): LauncherHead {
  if (appCount === 0) return 'empty';
  if (preparing) return 'preparing';
  return signedIn ? 'greeting' : 'quiet';
}

/**
 * Where choosing `app` on the launcher goes: back to the page the manager
 * opened the launcher from when that page is in `app` -- choosing the app you
 * are already in takes you back to the same screen, not to the app's first --
 * and to the app's home otherwise. The page, not what was typed on it: a form
 * left half filled comes back empty. `from` may carry a query, which says
 * nothing about the app.
 */
export function destinationFor(app: WorkspaceApp, from?: string): string {
  return from && appFor(from.split(/[?#]/)[0]) === app.key ? from : app.home;
}

/**
 * Where a fresh sign-in goes. A manager chooses an app first, always. So does
 * anybody else with more than one to choose between -- an employee has their
 * shifts and the business's inventory and shop; a shop account the same but
 * the shifts -- and with exactly one they are taken straight into it. With
 * none, the launcher, which says the workspace is being set up.
 *
 * `apps` is what the sign-in returned, and `permissions` too; a server a
 * release behind sends neither, and then an employee goes to their shifts, as
 * before there was anything else for them.
 */
export function landingAfterLogin(
  role: Role,
  apps?: readonly unknown[] | null,
  permissions?: readonly string[] | null,
): string {
  if (role === 'manager') return LAUNCHER_PATH;
  if (!Array.isArray(apps)) return role === 'employee' ? '/' : LAUNCHER_PATH;
  const mine = appsFor(role, apps, permissions);
  return mine.length === 1 ? mine[0].home : LAUNCHER_PATH;
}
