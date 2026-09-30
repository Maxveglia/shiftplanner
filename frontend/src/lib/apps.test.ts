// Which apps a business has, read the one way every screen reads it. The
// launcher's own arithmetic, and `appFor`/`destinationFor`, are tested beside
// it in lib/launcher/motion.test.ts.

import { describe, expect, it } from 'vitest';
import {
  activeApps,
  appFor,
  APPS,
  appsFor,
  destinationFor,
  hasApp,
  homeFor,
  isCommonPath,
  knownAppKeys,
  LAUNCHER_PATH,
  landingAfterLogin,
  sameApps,
  sameWorkspace,
} from './apps';
import { PERMS, type Perm } from './access';

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
const ALL = ['shifts', 'inventory', 'store'];

describe('activeApps', () => {
  it("is every app for a business that has them all -- Casa Demo's, today", () => {
    expect(activeApps(['shifts', 'inventory', 'store'])).toEqual(APPS);
  });

  it("is the shifts app and the inventory for Max's, and the template's", () => {
    // Neither has the shop: the menu went with it, out of the inventory.
    expect(knownAppKeys(['shifts', 'inventory'])).toEqual(['shifts', 'inventory']);
  });

  it("keeps the launcher's order whatever order the server lists them in", () => {
    expect(knownAppKeys(['inventory', 'shifts'])).toEqual(['shifts', 'inventory']);
    expect(knownAppKeys(['store', 'inventory', 'shifts'])).toEqual(['shifts', 'inventory', 'store']);
  });

  it('names each app once', () => {
    expect(knownAppKeys(['inventory', 'inventory'])).toEqual(['inventory']);
  });

  it('passes over an app this client has never heard of', () => {
    // A server a release ahead: a tile that opens nothing is worse than none.
    expect(knownAppKeys(['menu', 'inventory', 42, null])).toEqual(['inventory']);
  });

  it('is nothing for a business with none, and for no list at all', () => {
    expect(activeApps([])).toEqual([]);
    expect(activeApps(undefined)).toEqual([]);
    expect(activeApps(null)).toEqual([]);
  });
});

describe('hasApp', () => {
  it('answers for one app', () => {
    expect(hasApp(['shifts', 'inventory'], 'shifts')).toBe(true);
    expect(hasApp(['inventory'], 'shifts')).toBe(false);
    expect(hasApp([], 'inventory')).toBe(false);
  });

  it('says no while nobody has said', () => {
    expect(hasApp(undefined, 'shifts')).toBe(false);
  });
});

describe('homeFor', () => {
  it("is the shifts app's dashboard whenever the business has it, as it always was", () => {
    expect(homeFor(['shifts', 'inventory'])).toBe('/');
    expect(homeFor(['shifts'])).toBe('/');
    expect(homeFor(['inventory', 'shifts'])).toBe('/');
  });

  it('is the first app there is without it', () => {
    expect(homeFor(['inventory'])).toBe('/inventory');
    expect(homeFor(['store', 'inventory'])).toBe('/inventory');
    expect(homeFor(['store'])).toBe('/store/menu');
  });

  it('is the launcher, which says so, for a business with nothing yet', () => {
    expect(homeFor([])).toBe(LAUNCHER_PATH);
    expect(homeFor(['menu'])).toBe(LAUNCHER_PATH);
  });

  it('opens every app on its own home', () => {
    for (const app of APPS) expect(homeFor([app.key])).toBe(app.home);
  });
});

describe('sameApps', () => {
  it('reads both lists the way the client keeps them', () => {
    expect(sameApps(['shifts', 'inventory'], ['inventory', 'shifts'])).toBe(true);
    expect(sameApps(['shifts', 'menu'], ['shifts'])).toBe(true);
    expect(sameApps(['shifts'], ['shifts', 'inventory'])).toBe(false);
    expect(sameApps([], [])).toBe(true);
  });

  it('does not take a missing list for an empty one', () => {
    // A session saved before the server sent the list has not been told
    // "none": the answer has to be written onto it.
    expect(sameApps(undefined, [])).toBe(false);
    expect(sameApps([], undefined)).toBe(false);
    expect(sameApps(undefined, undefined)).toBe(true);
  });
});

describe('sameWorkspace', () => {
  const both = ['shifts', 'inventory'];

  it("reads a session saved before the server said a word on it as ready -- Max's", () => {
    // The answer on every page load for a business that is ready: nothing to
    // write, and nothing for the open page to render again.
    expect(sameWorkspace({ apps: both }, { apps: both, preparing: false })).toBe(true);
  });

  it('is a difference when the workspace starts or stops being set up', () => {
    expect(sameWorkspace({ apps: ['shifts'] }, { apps: ['shifts'], preparing: true })).toBe(false);
    expect(
      sameWorkspace({ apps: ['shifts'], preparing: true }, { apps: ['shifts'], preparing: false }),
    ).toBe(false);
    expect(
      sameWorkspace({ apps: ['shifts'], preparing: true }, { apps: ['shifts'], preparing: true }),
    ).toBe(true);
  });

  it('is a difference when the apps are, as sameApps reads them', () => {
    expect(sameWorkspace({ apps: [] }, { apps: ['shifts'], preparing: true })).toBe(false);
    expect(sameWorkspace({}, { apps: [], preparing: false })).toBe(false);
    expect(sameWorkspace({ apps: ['inventory', 'shifts'] }, { apps: both, preparing: false })).toBe(
      true,
    );
  });
});

describe('sameWorkspace, with who is asking', () => {
  it('is a difference when the answer says other permissions or another role', () => {
    const kept = { apps: ['shifts'], preparing: false, role: 'employee', permissions: ['inventory.view'] };
    expect(sameWorkspace(kept, { ...kept, permissions: ['inventory.view', 'store.charge'] })).toBe(false);
    expect(sameWorkspace(kept, { ...kept, role: 'store' })).toBe(false);
    expect(sameWorkspace(kept, { ...kept })).toBe(true);
  });

  it('is no news when the answer does not say them -- a server a release behind', () => {
    expect(sameWorkspace({ apps: ['shifts'], permissions: ['inventory.view'] }, { apps: ['shifts'] })).toBe(true);
  });

  it('is news the first time they are said to a session saved without them', () => {
    expect(sameWorkspace({ apps: ['shifts'] }, { apps: ['shifts'], permissions: [] })).toBe(false);
  });
});

describe('appsFor', () => {
  const keys = (apps: { key: string }[]) => apps.map((a) => a.key);

  it("is every app the business has for the manager, as it always was", () => {
    expect(keys(appsFor('manager', ALL, PERMS))).toEqual(ALL);
    // Even saved before the server said what a manager may do.
    expect(keys(appsFor('manager', ALL, []))).toEqual(ALL);
  });

  it("is an employee's shifts and the business's inventory and shop", () => {
    expect(keys(appsFor('employee', ALL, TEAM))).toEqual(ALL);
    expect(keys(appsFor('employee', ['shifts', 'inventory'], TEAM))).toEqual(['shifts', 'inventory']);
  });

  it('is never the shifts app for a shop account, whatever a list says', () => {
    expect(keys(appsFor('store', ALL, TEAM))).toEqual(['inventory', 'store']);
    expect(keys(appsFor('store', ['shifts'], TEAM))).toEqual([]);
  });

  it('leaves out an app the account may not enter', () => {
    // Saved before the server said: nothing but an employee's own shifts.
    expect(keys(appsFor('employee', ALL, undefined))).toEqual(['shifts']);
    expect(keys(appsFor('employee', ALL, ['menu.view']))).toEqual(['shifts', 'store']);
    expect(keys(appsFor('store', ALL, []))).toEqual([]);
  });

  it('is nothing for a role it does not know', () => {
    expect(keys(appsFor('owner', ALL, []))).toEqual([]);
  });
});

describe('landingAfterLogin', () => {
  it('sends a manager to the launcher, always', () => {
    expect(landingAfterLogin('manager', ALL, PERMS)).toBe(LAUNCHER_PATH);
    expect(landingAfterLogin('manager', ['inventory'], PERMS)).toBe(LAUNCHER_PATH);
    expect(landingAfterLogin('manager', [], PERMS)).toBe(LAUNCHER_PATH);
  });

  it('sends an employee with more than one app to the launcher', () => {
    expect(landingAfterLogin('employee', ALL, TEAM)).toBe(LAUNCHER_PATH);
    expect(landingAfterLogin('employee', ['shifts', 'store'], TEAM)).toBe(LAUNCHER_PATH);
  });

  it('sends an employee with one app straight into it', () => {
    expect(landingAfterLogin('employee', ['shifts'], TEAM)).toBe('/');
    expect(landingAfterLogin('employee', ['inventory'], TEAM)).toBe('/inventory');
  });

  it('sends a shop account into its one app, or to the launcher with two', () => {
    expect(landingAfterLogin('store', ['shifts', 'store'], TEAM)).toBe('/store/menu');
    expect(landingAfterLogin('store', ['shifts', 'inventory'], TEAM)).toBe('/inventory');
    expect(landingAfterLogin('store', ALL, TEAM)).toBe(LAUNCHER_PATH);
  });

  it('sends anybody with nothing to open to the launcher, which says so', () => {
    expect(landingAfterLogin('store', ['shifts'], TEAM)).toBe(LAUNCHER_PATH);
    expect(landingAfterLogin('employee', [], TEAM)).toBe(LAUNCHER_PATH);
  });

  it('sends an employee to their shifts when the server sends no list, as before', () => {
    expect(landingAfterLogin('employee')).toBe('/');
    expect(landingAfterLogin('store')).toBe(LAUNCHER_PATH);
  });
});

describe('the pages of no app', () => {
  it('belong to no app: Access', () => {
    expect(isCommonPath('/access')).toBe(true);
    expect(appFor('/access')).toBeNull();
    // A prefix is not the page.
    expect(isCommonPath('/accessories')).toBe(false);
    expect(appFor('/accessories')).toBe('shifts');
  });

  it('open every app at its home from the launcher, not back on Access', () => {
    for (const app of APPS) expect(destinationFor(app, '/access')).toBe(app.home);
  });
});
