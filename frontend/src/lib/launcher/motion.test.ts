import { describe, expect, it } from 'vitest';
import {
  coverRadius,
  firstName,
  greetingWords,
  isPlainClick,
  namedLine,
  nextTile,
  tiltFor,
} from './motion';
import {
  APPS,
  appFor,
  clearLauncherArrival,
  destinationFor,
  landingAfterLogin,
  LAUNCHER_PATH,
  launcherArrivalPending,
  launcherHead,
  launcherVisit,
  markLauncherArrival,
} from '../apps';

describe('tiltFor', () => {
  it('leaves a tile flat with the pointer at its centre', () => {
    expect(tiltFor(150, 100, 300, 200, 10)).toEqual({ rx: 0, ry: 0 });
  });

  it('sinks the side under the pointer', () => {
    // Right edge: turns about the vertical axis, right side away.
    expect(tiltFor(300, 100, 300, 200, 10)).toEqual({ rx: 0, ry: 10 });
    // Top edge: tips about the horizontal axis, top away.
    expect(tiltFor(150, 0, 300, 200, 10)).toEqual({ rx: 10, ry: 0 });
    // Bottom-left corner: both at once.
    expect(tiltFor(0, 200, 300, 200, 10)).toEqual({ rx: -10, ry: -10 });
  });

  it('never leans past the maximum, however far outside the pointer is', () => {
    expect(tiltFor(900, -500, 300, 200, 8)).toEqual({ rx: 8, ry: 8 });
  });

  it('stays flat for a tile with no size yet', () => {
    expect(tiltFor(10, 10, 0, 0, 10)).toEqual({ rx: 0, ry: 0 });
  });
});

describe('coverRadius', () => {
  it('reaches the farthest corner from the centre of the screen', () => {
    expect(coverRadius(640, 400, 1280, 800)).toBe(Math.ceil(Math.hypot(640, 400)));
  });

  it('reaches the opposite corner from a point near one side', () => {
    // A tile on the left of a phone: the far corner is bottom-right.
    expect(coverRadius(100, 500, 375, 667)).toBe(Math.ceil(Math.hypot(275, 500)));
  });
});

describe('nextTile', () => {
  it('moves along with either pair of arrows, wrapping round', () => {
    expect(nextTile(0, 'ArrowRight', 2)).toBe(1);
    expect(nextTile(1, 'ArrowRight', 2)).toBe(0);
    expect(nextTile(0, 'ArrowDown', 2)).toBe(1);
    expect(nextTile(0, 'ArrowLeft', 2)).toBe(1);
    expect(nextTile(1, 'ArrowUp', 2)).toBe(0);
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextTile(1, 'Home', 3)).toBe(0);
    expect(nextTile(0, 'End', 3)).toBe(2);
  });

  it('ignores every other key, and an empty row', () => {
    expect(nextTile(0, 'Enter', 2)).toBeNull();
    expect(nextTile(0, 'Tab', 2)).toBeNull();
    expect(nextTile(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('isPlainClick', () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it('is a primary click with no modifier', () => {
    expect(isPlainClick(plain)).toBe(true);
  });

  it('leaves new tabs and windows to the browser', () => {
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
  });
});

describe('firstName', () => {
  it('greets by the first word of the full name', () => {
    expect(firstName('Max Veglia')).toBe('Max');
    expect(firstName('  Ana   María López ')).toBe('Ana');
  });

  it('gives nothing when there is no name', () => {
    expect(firstName('')).toBe('');
    expect(firstName('   ')).toBe('');
    expect(firstName(null)).toBe('');
    expect(firstName(undefined)).toBe('');
  });
});

describe('namedLine', () => {
  it('fills the name in and says where it sits, in letters', () => {
    expect(namedLine('Hola, {name}', 'Max')).toEqual({
      text: 'Hola, Max',
      highlight: { at: 6, length: 3 },
    });
    expect(namedLine('{name} se está preparando', 'Casa Demo')).toEqual({
      text: 'Casa Demo se está preparando',
      highlight: { at: 0, length: 9 },
    });
  });

  it('counts letters, not UTF-16 units', () => {
    // The emoji is two units and one letter; so is the name's.
    expect(namedLine('🍗 {name}', 'Pollos 🐔').highlight).toEqual({ at: 2, length: 8 });
  });

  it('finds the name by the template, not by searching the line', () => {
    // "se" is in the rest of the line too; the name is the first one.
    expect(namedLine('{name} se está preparando', 'se').highlight).toEqual({ at: 0, length: 2 });
  });

  it('takes the name as written, dollar signs and all', () => {
    expect(namedLine('{name} is being set up', 'A$&B').text).toBe('A$&B is being set up');
  });

  it('leaves a line with no place for a name as it is', () => {
    expect(namedLine('Hola', 'Max')).toEqual({ text: 'Hola' });
  });
});

describe('greetingWords', () => {
  const text = (w: ReturnType<typeof greetingWords>) =>
    w.map((x) => x.letters.map((l) => l.ch).join(''));

  it('splits into words, each letter keeping its place in the line', () => {
    const words = greetingWords('Hola, Max');
    expect(text(words)).toEqual(['Hola,', 'Max']);
    // "Max" starts at 6 in "Hola, Max": the name's colour is found by that.
    expect(words[1].letters.map((l) => l.i)).toEqual([6, 7, 8]);
  });

  it('keeps one word whole, however long', () => {
    expect(text(greetingWords('Hi, Bartholomew'))).toEqual(['Hi,', 'Bartholomew']);
  });

  it('collapses runs of spaces and ignores the ends', () => {
    expect(text(greetingWords('  Hola,   Ana  '))).toEqual(['Hola,', 'Ana']);
    expect(greetingWords('')).toEqual([]);
  });
});

describe('the apps and the way in', () => {
  it('sends a manager to the launcher and an employee to their one screen', () => {
    expect(landingAfterLogin('manager')).toBe(LAUNCHER_PATH);
    expect(landingAfterLogin('employee')).toBe('/');
  });

  it('knows which app a path belongs to', () => {
    expect(appFor('/')).toBe('shifts');
    expect(appFor('/employees/3')).toBe('shifts');
    expect(appFor('/inventory')).toBe('inventory');
    expect(appFor('/inventory/counts/7')).toBe('inventory');
    expect(appFor('/store')).toBe('store');
    expect(appFor('/store/sales/9')).toBe('store');
    expect(appFor('/store/menu')).toBe('store');
    // A prefix is not a section.
    expect(appFor('/inventoryx')).toBe('shifts');
    expect(appFor('/storefront')).toBe('shifts');
  });

  it('opens every app on a screen that belongs to it', () => {
    for (const app of APPS) expect(appFor(app.home)).toBe(app.key);
  });

  it('greets a sign-in and nothing else', () => {
    expect(launcherVisit({ signedIn: true }).signedIn).toBe(true);
    // From the logo, typed into the address bar, or an entry already wiped.
    expect(launcherVisit({ from: '/employees' }).signedIn).toBe(false);
    expect(launcherVisit(null).signedIn).toBeFalsy();
    expect(launcherVisit({ signedIn: 'yes' }).signedIn).toBe(false);
  });

  it('keeps where the launcher was opened from, if it is a page of this site', () => {
    expect(launcherVisit({ from: '/absences?month=2026-10' }).from).toBe('/absences?month=2026-10');
    expect(launcherVisit({ from: 'https://example.com/' }).from).toBeUndefined();
    expect(launcherVisit({ from: '//example.com/' }).from).toBeUndefined();
    expect(launcherVisit({ from: 42 }).from).toBeUndefined();
  });
});

describe('launcherHead', () => {
  it("is the launcher there always was for a business that is ready -- Max's", () => {
    expect(launcherHead(2, false, true)).toBe('greeting');
    expect(launcherHead(2, false, false)).toBe('quiet');
    expect(launcherHead(2, false, undefined)).toBe('quiet');
  });

  it('says a workspace is being set up above its tiles, in place of the greeting', () => {
    // Said on every visit: after a sign-in and from the logo alike.
    expect(launcherHead(1, true, true)).toBe('preparing');
    expect(launcherHead(1, true, false)).toBe('preparing');
  });

  it('says only that when there is nothing to open, whatever the profile says', () => {
    expect(launcherHead(0, false, true)).toBe('empty');
    expect(launcherHead(0, false, false)).toBe('empty');
    expect(launcherHead(0, true, true)).toBe('empty');
  });
});

describe('the arrival from the launcher', () => {
  it('is there for every render until the layout has mounted, then gone', () => {
    expect(launcherArrivalPending()).toBe(false);
    markLauncherArrival();
    // React may render the layout twice before it mounts (StrictMode): both
    // renders have to see it.
    expect(launcherArrivalPending()).toBe(true);
    expect(launcherArrivalPending()).toBe(true);
    clearLauncherArrival();
    // Back, a reload, or the next time the layout mounts for any other reason.
    expect(launcherArrivalPending()).toBe(false);
  });
});

describe('destinationFor', () => {
  const shifts = APPS.find((a) => a.key === 'shifts')!;
  const inventory = APPS.find((a) => a.key === 'inventory')!;
  const store = APPS.find((a) => a.key === 'store')!;

  it('goes back to the page the launcher was opened from, in the same app', () => {
    expect(destinationFor(shifts, '/employees')).toBe('/employees');
    expect(destinationFor(inventory, '/inventory/counts/7')).toBe('/inventory/counts/7');
    expect(destinationFor(store, '/store/sales/9')).toBe('/store/sales/9');
  });

  it('keeps the query, which does not change the app', () => {
    expect(destinationFor(inventory, '/inventory?q=cola')).toBe('/inventory?q=cola');
    expect(destinationFor(shifts, '/?day=2026-10-03')).toBe('/?day=2026-10-03');
  });

  it("opens another app at its home, not at this one's page", () => {
    expect(destinationFor(inventory, '/employees')).toBe('/inventory');
    expect(destinationFor(shifts, '/inventory/count')).toBe('/');
    expect(destinationFor(store, '/inventory')).toBe('/store/menu');
    expect(destinationFor(inventory, '/store/stats')).toBe('/inventory');
  });

  it('opens at home after a sign-in, which came from no page', () => {
    expect(destinationFor(shifts)).toBe('/');
    expect(destinationFor(inventory)).toBe('/inventory');
    expect(destinationFor(store)).toBe('/store/menu');
  });
});
