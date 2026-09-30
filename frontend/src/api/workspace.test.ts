import { describe, expect, it } from 'vitest';
import { parseWorkspace } from './workspace';

describe('parseWorkspace', () => {
  it('keeps the apps the server lists, in the launcher’s order', () => {
    expect(parseWorkspace({ apps: ['inventory', 'shifts'], preparing: false })).toEqual({
      apps: ['shifts', 'inventory'],
      preparing: false,
    });
  });

  it('is no apps for a business that has none', () => {
    expect(parseWorkspace({ apps: [], preparing: true })).toEqual({ apps: [], preparing: true });
  });

  it('drops an app this client does not know, and anything else it was sent', () => {
    // The answer is meant to grow (each app's settings, next); what this
    // bundle does not know yet is not a reason to refuse the rest.
    expect(
      parseWorkspace({ apps: ['shifts', 'menu'], inventory: { units: ['kg'] } }),
    ).toEqual({ apps: ['shifts'], preparing: false });
  });

  it('says a workspace is being set up when the server says so', () => {
    // A new business: the template's shifts app, and the launcher saying the
    // rest is on its way.
    expect(parseWorkspace({ apps: ['shifts'], preparing: true })).toEqual({
      apps: ['shifts'],
      preparing: true,
    });
  });

  it('reads anything but a plain true as ready', () => {
    // A server a release behind sends no such thing: its launcher is the one
    // there always was.
    expect(parseWorkspace({ apps: ['shifts', 'inventory'] }).preparing).toBe(false);
    expect(parseWorkspace({ apps: ['shifts'], preparing: 'true' }).preparing).toBe(false);
    expect(parseWorkspace({ apps: ['shifts'], preparing: 1 }).preparing).toBe(false);
    expect(parseWorkspace({ apps: ['shifts'], preparing: null }).preparing).toBe(false);
  });

  it('keeps who is asking and what they may do, when the server says', () => {
    expect(
      parseWorkspace({
        apps: ['inventory', 'store'],
        preparing: false,
        role: 'store',
        permissions: ['store.charge', 'inventory.view', 'teleport'],
      }),
    ).toEqual({ apps: ['inventory', 'store'], preparing: false, role: 'store', permissions: ['inventory.view', 'store.charge'] });
  });

  it('leaves them out when the server does not say them, rather than saying "none"', () => {
    const workspace = parseWorkspace({ apps: ['shifts'], role: 'owner', permissions: 'all' });
    expect('role' in workspace).toBe(false);
    expect('permissions' in workspace).toBe(false);
    // An empty list is an answer: nothing.
    expect(parseWorkspace({ apps: ['shifts'], permissions: [] }).permissions).toEqual([]);
  });

  it('refuses a body with no list in it rather than reading it as no apps', () => {
    // "No apps" is the screen of a business that has nothing; a broken answer
    // must not show it to one that has everything.
    expect(() => parseWorkspace({})).toThrow();
    expect(() => parseWorkspace({ apps: 'shifts' })).toThrow();
    expect(() => parseWorkspace(null)).toThrow();
    expect(() => parseWorkspace('<html>')).toThrow();
  });
});
