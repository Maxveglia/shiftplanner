import { describe, expect, it } from 'vitest';
import {
  arrivalWindow,
  canTakeFocus,
  inTabOrder,
  lastShown,
  nextPresence,
  rippleFrame,
  rowDelays,
  wrapFocus,
  tabFromBetween,
} from './componentsMotion';

describe('nextPresence', () => {
  it('opens at once, from any phase', () => {
    expect(nextPresence('closed', true, 180)).toBe('open');
    expect(nextPresence('closing', true, 180)).toBe('open');
    expect(nextPresence('open', true, 180)).toBe('open');
  });

  it('closes through an exit when there is one to play', () => {
    expect(nextPresence('open', false, 180)).toBe('closing');
  });

  it('closes at once when there is no exit (reduced motion)', () => {
    expect(nextPresence('open', false, 0)).toBe('closed');
  });

  it('leaves a closing or closed dialog where it is while open stays false', () => {
    expect(nextPresence('closing', false, 180)).toBe('closing');
    expect(nextPresence('closed', false, 180)).toBe('closed');
  });
});

describe('rippleFrame', () => {
  it('gives an ordinary button everything the ripple needs', () => {
    expect(rippleFrame('')).toBe('relative overflow-hidden isolate');
    expect(rippleFrame('w-full mt-3')).toBe('relative overflow-hidden isolate');
  });

  it('does not pull a positioned button back into flow', () => {
    expect(rippleFrame('absolute right-2 top-2')).toBe('overflow-hidden isolate');
    expect(rippleFrame('fixed bottom-4')).toBe('overflow-hidden isolate');
    expect(rippleFrame('sticky top-0')).toBe('overflow-hidden isolate');
  });

  it('reads whole classes, not pieces of them', () => {
    // `md:absolute` applies only from md up, where it outranks `relative`.
    expect(rippleFrame('md:absolute')).toBe('relative overflow-hidden isolate');
    expect(rippleFrame('absolute-ish')).toBe('relative overflow-hidden isolate');
  });

  it('leaves a static button without a ripple', () => {
    expect(rippleFrame('static')).toBeNull();
  });
});

describe('wrapFocus', () => {
  it('goes round from the last to the first, and back', () => {
    expect(wrapFocus(2, 3, false)).toBe(0);
    expect(wrapFocus(0, 3, true)).toBe(2);
  });

  it('lets the browser step normally in between', () => {
    expect(wrapFocus(0, 3, false)).toBeNull();
    expect(wrapFocus(1, 3, true)).toBeNull();
  });

  it('enters at the right end when focus is on the dialog itself', () => {
    expect(wrapFocus(-1, 3, false)).toBe(0);
    expect(wrapFocus(-1, 3, true)).toBe(2);
  });

  it('keeps focus on the dialog when nothing inside can hold it', () => {
    expect(wrapFocus(-1, 0, false)).toBe(-1);
    expect(wrapFocus(-1, 0, true)).toBe(-1);
  });
});

describe('rowDelays', () => {
  it('queues visible rows one step apart', () => {
    expect(rowDelays([40, 40, 40], 30)).toEqual([0, 30, 60]);
  });

  it('lets a row with no height ride with the row above it', () => {
    // Person, closed drawer, person, closed drawer: the Employees page.
    expect(rowDelays([48, 0, 48, 1, 48, 0], 30)).toEqual([0, 0, 30, 30, 60, 60]);
  });

  it('stops growing at the cap, so a long roster does not queue', () => {
    const delays = rowDelays(Array(40).fill(40), 30, 8);
    expect(delays[8]).toBe(240);
    expect(delays[39]).toBe(240);
  });

  it('is empty for an empty table', () => {
    expect(rowDelays([])).toEqual([]);
  });
});

describe('arrivalWindow', () => {
  it('is the longest wait plus one entrance', () => {
    expect(arrivalWindow([0, 30, 60], 400)).toBe(460);
  });

  it('is one entrance for no rows', () => {
    expect(arrivalWindow([], 400)).toBe(400);
  });
});

describe('lastShown', () => {
  it('follows the value while there is one', () => {
    expect(lastShown('a', 'b')).toBe('b');
    expect(lastShown(null, 'b')).toBe('b');
  });

  it('keeps the last one once the value is let go of', () => {
    expect(lastShown('a', null)).toBe('a');
  });

  it('is nothing before anything was shown', () => {
    expect(lastShown(null, null)).toBeNull();
  });
});

describe('canTakeFocus', () => {
  const button = { connected: true, disabled: false, tabIndex: 0, rendered: true, inert: false };

  it('takes an ordinary button or link on the page', () => {
    expect(canTakeFocus(button)).toBe(true);
  });

  it('refuses one that is gone', () => {
    expect(canTakeFocus({ ...button, connected: false })).toBe(false);
  });

  it('refuses one still on the page that focus() would ignore', () => {
    expect(canTakeFocus({ ...button, disabled: true })).toBe(false);
    expect(canTakeFocus({ ...button, rendered: false })).toBe(false); // a hidden tab panel
    expect(canTakeFocus({ ...button, inert: true })).toBe(false); // a dialog leaving
  });

  it('takes back a panel that was given focus by script', () => {
    // The dialog or the assistant under a second dialog: tabIndex -1.
    expect(canTakeFocus({ ...button, tabIndex: -1 })).toBe(true);
  });
});

describe('inTabOrder', () => {
  const button = { connected: true, disabled: false, tabIndex: 0, rendered: true, inert: false };

  it('is what Tab reaches: focusable and in the tab order', () => {
    expect(inTabOrder(button)).toBe(true);
    expect(inTabOrder({ ...button, tabIndex: -1 })).toBe(false);
    expect(inTabOrder({ ...button, disabled: true })).toBe(false);
  });
});

describe('tabFromBetween', () => {
  // Five stops; the focus sits on a scrolling list between stops 1 and 2.
  it('carries on to the next stop, or the one before', () => {
    expect(tabFromBetween(2, 5, false)).toBe(2);
    expect(tabFromBetween(2, 5, true)).toBe(1);
  });

  it('wraps round when nothing follows, or nothing precedes', () => {
    expect(tabFromBetween(-1, 5, false)).toBe(0);
    expect(tabFromBetween(-1, 5, true)).toBe(4);
    expect(tabFromBetween(0, 5, true)).toBe(4);
    expect(tabFromBetween(0, 5, false)).toBe(0);
  });

  it('has nowhere to go without stops', () => {
    expect(tabFromBetween(0, 0, false)).toBe(-1);
  });
});
