// The columns a day gets drawn across.
//
// Two things are pinned here: every day is drawn across its OPENING hours and
// no others -- a bar through the night, a shop inside the day -- and no shift
// is ever hidden by that, because a shift outside the hours widens its own day. The grid itself
// has no test -- the environment is `node`, with no DOM -- which is precisely
// why the geometry lives in a plain function that does.

import { describe, expect, it } from 'vitest';
import { dayTrack, segmentsForDay } from './dayTrack';
import { windowFor } from '../../lib/schedule/demand';
import { day as oneDay, spec } from '../../test/factories';
import type { Assignment } from '../../lib/schedule/types';

const MONDAY = oneDay('2026-03-02');
const FRIDAY = oneDay('2026-03-06');
const SATURDAY = oneDay('2026-03-07');

/** A bar: opens at nine in the morning, closes at four the next one. */
const BAR = spec({ openMin: 9 * 60, closeMin: 28 * 60 });
/** An ordinary shop, nine to ten, entirely inside one calendar day. */
const SHOP = spec({ openMin: 9 * 60, closeMin: 22 * 60 });

function shift(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    employeeId: 'e1',
    date: MONDAY.date,
    startMin: 20 * 60,
    endMin: 26 * 60,
    templateId: 'tpl',
    templateName: 'Night',
    color: '#000',
    isNight: true,
    paidHours: 6,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
    ...over,
  };
}

describe('a day is drawn across its opening hours, not the whole clock', () => {
  it('gives a shop open 9:00-22:00 exactly those thirteen columns', () => {
    // It used to get all 24, eleven of them shut. "No me sirve de nada un
    // calendario diario tan grande si la mitad es cuando el negocio está
    // cerrado."
    const track = dayTrack(SHOP, MONDAY);

    expect(track.hours).toEqual(Array.from({ length: 13 }, (_, i) => 9 + i));
    expect(track.startMin).toBe(9 * 60);
    expect(track.endMin).toBe(22 * 60);
    expect(track.crossesMidnight).toBe(false);
    expect(track.midnightIndex).toBeNull();
  });

  it('gives the bar from the screenshot 17:00-03:00 and nothing else', () => {
    const bar = spec({
      openMin: 17 * 60,
      closeMin: 27 * 60,
      dayHours: [0, 6].map((weekday) => ({ weekday, openMin: 17 * 60, closeMin: 28 * 60 })),
    });
    const tuesday = oneDay('2026-10-20');

    expect(dayTrack(bar, tuesday).hours).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
    // Saturday stays open an hour later, and gets that hour.
    expect(dayTrack(bar, oneDay('2026-10-24')).hours.slice(-1)).toEqual([27]);
  });

  it('leaves out hours inside the window that need nobody', () => {
    // The account whose Tuesday started at three in the morning: a window
    // wider than the bar, with the early hours staffed at zero.
    const wide = spec({
      openMin: 3 * 60,
      closeMin: 28 * 60,
      minStaff: 2,
      coverage: [
        { staff: 0, startMin: 3 * 60, endMin: 17 * 60, weekdays: [], dates: [], exact: true },
      ],
    });
    const track = dayTrack(wide, oneDay('2026-10-20'));
    expect(track.hours[0]).toBe(17);
    expect(track.hours.slice(-1)).toEqual([27]);
  });

  it('follows the day\'s own shifts when the spec needs nobody at all', () => {
    // Max's October, adopted from the server: no requirement anywhere and a
    // window of 03:00-04:00 built from the whole month's shifts.
    const seeded = spec({ openMin: 3 * 60, closeMin: 28 * 60, minStaff: 0 });
    const tuesday = oneDay('2026-10-20');
    const shifts = [
      shift({ date: tuesday.date, startMin: 17 * 60, endMin: 25 * 60 }),
      shift({ id: 'a2', date: tuesday.date, startMin: 21 * 60, endMin: 27 * 60 }),
    ];
    expect(dayTrack(seeded, tuesday, shifts).hours).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  });

  it('keeps the whole window when nobody is needed anywhere in it', () => {
    const unstaffed = spec({ openMin: 9 * 60, closeMin: 22 * 60, minStaff: 0 });
    expect(dayTrack(unstaffed, MONDAY).hours).toHaveLength(13);
  });

  it('widens to a shift placed before opening, instead of hiding it', () => {
    const early = shift({ startMin: 7 * 60, endMin: 12 * 60 });
    const track = dayTrack(SHOP, MONDAY, [early]);

    expect(track.hours[0]).toBe(7);
    expect(track.endMin).toBe(22 * 60);
    const segs = segmentsForDay([early], MONDAY.date, null, track);
    expect(segs[0].continuesFromPrev).toBe(false);
  });

  it('ignores the shifts of other days when choosing its own columns', () => {
    const otherDay = shift({ date: '2026-03-03', startMin: 5 * 60, endMin: 9 * 60 });
    expect(dayTrack(SHOP, MONDAY, [otherDay]).hours[0]).toBe(9);
  });

  it('draws a shift that runs past midnight whole, under the day it started', () => {
    // It used to be cut in two, the second half on Tuesday's row from 0:00.
    const a = shift({ startMin: 22 * 60, endMin: 26 * 60 });
    const monday = dayTrack(SHOP, MONDAY, [a]);

    expect(monday.endMin).toBe(26 * 60);
    expect(monday.crossesMidnight).toBe(true);
    const segs = segmentsForDay([a], MONDAY.date, null, monday);
    expect(segs).toHaveLength(1);
    expect(segs[0].endMin).toBe(26 * 60);
    expect(segs[0].continuesToNext).toBe(false);

    const tuesday = segmentsForDay(
      [a],
      '2026-03-03',
      { date: MONDAY.date, track: monday },
      dayTrack(SHOP, oneDay('2026-03-03'), [a]),
    );
    expect(tuesday).toEqual([]);
  });
});

describe('a business that works through midnight', () => {
  it('gets columns for the hours it is open, past 23', () => {
    const track = dayTrack(BAR, MONDAY);

    expect(track.hours[0]).toBe(9);
    expect(track.hours[track.hours.length - 1]).toBe(27);
    expect(track.crossesMidnight).toBe(true);
    // The strip and the shading both ask the window; every column it draws has
    // to be inside it, or the grid contradicts itself again.
    const win = windowFor(BAR, MONDAY);
    for (const h of track.hours) {
      expect(h * 60).toBeGreaterThanOrEqual(win.openMin);
      expect(h * 60).toBeLessThan(win.closeMin);
    }
  });

  it('marks where midnight falls, so the ruler can say so', () => {
    const track = dayTrack(BAR, MONDAY);

    expect(track.midnightIndex).not.toBeNull();
    expect(track.hours[track.midnightIndex!]).toBe(24);
  });

  it('draws the night shift whole, on the day it is worked', () => {
    const a = shift({ startMin: 20 * 60, endMin: 26 * 60 });
    const track = dayTrack(BAR, MONDAY);

    const segs = segmentsForDay([a], MONDAY.date, null, track);
    expect(segs).toHaveLength(1);
    expect(segs[0].startMin).toBe(20 * 60);
    expect(segs[0].endMin).toBe(26 * 60);
    expect(segs[0].continuesFromPrev).toBe(false);
    expect(segs[0].continuesToNext).toBe(false);
  });

  it('leaves last night out of tonight, instead of drawing it twice', () => {
    const a = shift({ date: MONDAY.date, startMin: 20 * 60, endMin: 26 * 60 });
    const track = dayTrack(BAR, oneDay('2026-03-03'));

    expect(
      segmentsForDay(
        [a],
        '2026-03-03',
        { date: MONDAY.date, track: dayTrack(BAR, MONDAY) },
        track,
      ),
    ).toEqual([]);
  });

  it('follows the per-weekday hours, not the standing ones', () => {
    const fridayLate = spec({
      openMin: 9 * 60,
      closeMin: 22 * 60,
      dayHours: [{ weekday: 5, openMin: 18 * 60, closeMin: 4 * 60 }],
    });

    expect(dayTrack(fridayLate, FRIDAY).hours[0]).toBe(18);
    expect(dayTrack(fridayLate, FRIDAY).hours.slice(-1)).toEqual([27]);
    // Monday keeps the standing hours, nine to ten.
    expect(dayTrack(fridayLate, MONDAY).hours).toHaveLength(13);
  });

  it('squares off a bar that runs past the edge of what is drawn', () => {
    const a = shift({ startMin: 8 * 60, endMin: 30 * 60 });
    const track = dayTrack(BAR, MONDAY);

    const segs = segmentsForDay([a], MONDAY.date, null, track);
    expect(segs[0].startMin).toBe(track.startMin);
    expect(segs[0].endMin).toBe(track.endMin);
    expect(segs[0].continuesFromPrev).toBe(true);
    expect(segs[0].continuesToNext).toBe(true);
  });
});

describe('a late night followed by an ordinary day', () => {
  // The shape that drew a Friday night twice: Friday closes at four, Saturday
  // keeps the standing hours and therefore a civil-day track that starts at
  // column 0 -- so it used to re-draw the small hours Friday had already drawn
  // whole, as a second bar under a day nobody worked them on.
  const FRIDAY_LATE = spec({
    openMin: 9 * 60,
    closeMin: 22 * 60,
    dayHours: [{ weekday: 5, openMin: 18 * 60, closeMin: 4 * 60 }],
  });
  const NIGHT = shift({ date: FRIDAY.date, startMin: 22 * 60, endMin: 28 * 60 });

  it('draws the night once, whole, under the Friday it started on', () => {
    const segs = segmentsForDay([NIGHT], FRIDAY.date, null, dayTrack(FRIDAY_LATE, FRIDAY));

    expect(segs).toHaveLength(1);
    expect(segs[0].startMin).toBe(22 * 60);
    expect(segs[0].endMin).toBe(28 * 60);
    expect(segs[0].continuesToNext).toBe(false);
  });

  it('does not draw it again on Saturday', () => {
    const segs = segmentsForDay(
      [NIGHT],
      SATURDAY.date,
      { date: FRIDAY.date, track: dayTrack(FRIDAY_LATE, FRIDAY) },
      dayTrack(FRIDAY_LATE, SATURDAY),
    );

    expect(segs).toEqual([]);
  });

  it('draws a hand-placed shift past closing whole on its own night', () => {
    // Friday closes at two; a shift pinned by hand runs to four. Friday's own
    // columns now reach four, so the shift is drawn once, whole, where it was
    // worked -- and Saturday has nothing left over to draw.
    const closesAtTwo = spec({
      openMin: 9 * 60,
      closeMin: 22 * 60,
      dayHours: [{ weekday: 5, openMin: 18 * 60, closeMin: 2 * 60 }],
    });
    const friday = dayTrack(closesAtTwo, FRIDAY, [NIGHT]);
    expect(friday.endMin).toBe(28 * 60);
    expect(segmentsForDay([NIGHT], FRIDAY.date, null, friday)[0].endMin).toBe(28 * 60);

    const segs = segmentsForDay(
      [NIGHT],
      SATURDAY.date,
      { date: FRIDAY.date, track: friday },
      dayTrack(closesAtTwo, SATURDAY, [NIGHT]),
    );
    expect(segs).toEqual([]);
  });

});
