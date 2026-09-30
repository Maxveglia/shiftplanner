// One draft on every browser: the two decisions the page makes, on their own.
//
// The load decision must tell news from an echo -- the rows that come back
// after our own save are not a reason to replace what the manager is typing
// over. The save decision must never PUT what the server already holds, and
// never PUT the published rota as if it were a draft.

import { describe, expect, it } from 'vitest';
import {
  NO_MARK,
  draftOf,
  resolveLoad,
  sameShifts,
  shouldSave,
  snapshotOf,
  windowKey,
} from './draftSync';
import type { Assignment } from './types';

function shift(over: Partial<Assignment> & { employeeId: string; date: string }): Assignment {
  return {
    id: Math.random().toString(36).slice(2),
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 't',
    templateName: 'Day',
    color: '#000',
    isNight: false,
    paidHours: 8,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
    ...over,
  };
}

const FRI = '2026-03-06';
const SAT = '2026-03-07';

const sarahFri = () => shift({ employeeId: 'sarah', date: FRI });
const luisSat = () => shift({ employeeId: 'luis', date: SAT });
const luisFriLate = () => shift({ employeeId: 'luis', date: FRI, startMin: 16 * 60, endMin: 22 * 60 });

describe('sameShifts — the same calendar whatever the ids', () => {
  it('ignores ids, order, and what the row was priced at', () => {
    const a = [sarahFri(), luisSat()];
    const b = [{ ...luisSat(), cost: 99, source: 'manual' as const }, sarahFri()];
    expect(sameShifts(a, b)).toBe(true);
  });

  it('is a multiset: a duplicated shift is a different calendar', () => {
    expect(sameShifts([sarahFri(), sarahFri()], [sarahFri()])).toBe(false);
  });

  it('sees a moved shift and a missing one', () => {
    expect(sameShifts([sarahFri()], [shift({ employeeId: 'sarah', date: SAT })])).toBe(false);
    expect(sameShifts([sarahFri(), luisSat()], [sarahFri()])).toBe(false);
    expect(sameShifts([], [])).toBe(true);
  });
});

describe('draftOf — a calendar equal to the published rota is no draft', () => {
  it('is empty when the screen shows exactly the rota', () => {
    const rota = snapshotOf([sarahFri(), luisSat()]);
    expect(draftOf([luisSat(), sarahFri()], rota)).toEqual([]);
  });

  it('is the screen once anything differs from the rota, or no rota was seen', () => {
    const screen = [sarahFri(), luisFriLate()];
    expect(draftOf(screen, snapshotOf([sarahFri()]))).toBe(screen);
    expect(draftOf(screen, null)).toBe(screen);
    expect(draftOf(null, null)).toBeNull();
  });
});

describe('resolveLoad — news or an echo', () => {
  it('adopts a draft the server has that this browser has never seen', () => {
    expect(resolveLoad([sarahFri()], null, NO_MARK)).toBe('adopt');
    expect(resolveLoad([sarahFri()], [luisSat()], NO_MARK)).toBe('adopt');
  });

  it('keeps the screen when the rows are what we last exchanged: local edits are newer', () => {
    const mark = { server: snapshotOf([sarahFri()]), rota: null };
    // The manager added Luis since the save; the refetch echoes the old draft.
    expect(resolveLoad([sarahFri()], [sarahFri(), luisSat()], mark)).toBe('keep');
    // And after "New calendar" the echo of the empty PUT is not a reason to act.
    expect(resolveLoad([], null, { server: [], rota: null })).toBe('keep');
  });

  it('keeps the screen when it already shows the rows, whatever the ids', () => {
    expect(resolveLoad([sarahFri(), luisSat()], [luisSat(), sarahFri()], NO_MARK)).toBe('keep');
  });

  it('clears when the server draft is gone and the screen still shows one', () => {
    const mark = { server: snapshotOf([sarahFri()]), rota: null };
    expect(resolveLoad([], [sarahFri()], mark)).toBe('clear');
  });

  it('keeps a calendar the server has never heard of: first contact is not a verdict', () => {
    // Drafted before drafts were kept on the server, or generated while the
    // first load was still out. Kept, and sent up by the save that follows.
    expect(resolveLoad([], [sarahFri()], NO_MARK)).toBe('keep');
    expect(shouldSave([sarahFri()], { server: [], rota: null }, false)).toBe(true);
  });

  it('does nothing with an empty server and an empty screen: the published seed decides', () => {
    expect(resolveLoad([], null, NO_MARK)).toBe('keep');
  });

  it('after a publish the server draft is empty and the screen shows the rota: nothing to clear', () => {
    const rota = snapshotOf([sarahFri(), luisSat()]);
    expect(resolveLoad([], [sarahFri(), luisSat()], { server: [], rota })).toBe('keep');
    // Even before this browser learned the server side of it.
    expect(resolveLoad([], [sarahFri(), luisSat()], { server: null, rota })).toBe('keep');
  });
});

describe('shouldSave — worth a PUT', () => {
  const known = { server: snapshotOf([sarahFri()]), rota: null };

  it('saves a change the server does not hold yet', () => {
    expect(shouldSave([sarahFri(), luisSat()], known, false)).toBe(true);
  });

  it('skips what the server already holds, whatever the ids', () => {
    expect(shouldSave([sarahFri()], known, false)).toBe(false);
  });

  it('waits for the load, and for a first load to have succeeded', () => {
    expect(shouldSave([sarahFri(), luisSat()], known, true)).toBe(false);
    expect(shouldSave([sarahFri(), luisSat()], NO_MARK, false)).toBe(false);
  });

  it('never saves from an empty screen: "New calendar" clears on its own', () => {
    expect(shouldSave(null, known, false)).toBe(false);
  });

  it('does not re-save the published rota as a draft after a publish', () => {
    const rota = snapshotOf([sarahFri(), luisSat()]);
    expect(shouldSave([sarahFri(), luisSat()], { server: [], rota }, false)).toBe(false);
  });

  it('undoing back to the rota clears the draft on the server', () => {
    const rota = snapshotOf([sarahFri(), luisSat()]);
    const mark = { server: snapshotOf([sarahFri(), luisSat(), luisFriLate()]), rota };
    expect(shouldSave([sarahFri(), luisSat()], mark, false)).toBe(true);
    expect(draftOf([sarahFri(), luisSat()], rota)).toEqual([]);
  });
});

describe('windowKey', () => {
  it('is the window and nothing else', () => {
    const from = new Date(2026, 2, 2);
    const to = new Date(2026, 2, 9);
    expect(windowKey(from, to)).toBe(windowKey(new Date(from), new Date(to)));
    expect(windowKey(from, to)).not.toBe(windowKey(from, new Date(2026, 2, 10)));
  });
});

describe('resolveLoad — after the review of the server draft', () => {
  it('a window just opened takes the server draft even when it is an echo', () => {
    // Paging W2 -> W1 -> W2: the cached rows equal the mark, and there is
    // nothing on screen. Nothing on screen means nothing to outrank them.
    const rows = [sarahFri()];
    expect(resolveLoad(rows, null, { server: snapshotOf(rows), rota: null })).toBe('adopt');
  });

  it('a window just opened with nothing on the server stays empty', () => {
    expect(resolveLoad([], null, { server: [], rota: null })).toBe('keep');
  });
});

describe('snapshotOf — paid hours are part of the draft', () => {
  it('the same slot with a different break is a different draft', () => {
    const a = [shift({ employeeId: 'sarah', date: FRI, paidHours: 7.5 })];
    const b = [shift({ employeeId: 'sarah', date: FRI, paidHours: 7 })];
    expect(sameShifts(a, b)).toBe(false);
    expect(shouldSave(b, { server: snapshotOf(a), rota: null }, false)).toBe(true);
  });
});
