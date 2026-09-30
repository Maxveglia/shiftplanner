// The hours one day is actually DRAWN across, and which pieces of which shifts
// belong inside them.
//
// The grid used to be 24 fixed columns, 0..23, on the assumption that a working
// day and a calendar day are the same thing. For a bar open from nine in the
// morning until four the next one they are not. The spec already says so
// (`closeMin = 1680`), the generator already staffs it, and `needAt` is already
// asked about hour 25 -- only the grid had no column to put any of it in. Worse,
// the coverage strip tested `hour * 60 >= openMin` on hours it had already drawn
// as belonging to nobody, so it painted two in the morning CLOSED, need 0, in
// the very columns where it was drawing the night shift's bars. The picture
// contradicted itself.
//
// So the track comes from the day's own window: EXACTLY its opening hours,
// 17..27 for a bar open 17:00-03:00, 9..22 for a shop open 9:00-22:00.
//
// A window that ended by midnight used to keep the whole civil day, 0..23, so
// a nine-to-ten shop drew its shut hours too -- on the argument that they are
// where a manager drags in an early shift the brief never mentioned. The
// manager of a bar that opens at five in the afternoon asked for the opposite:
// "no me sirve de nada un calendario diario tan grande si la mitad es cuando el
// negocio está cerrado". Half the width was hours nobody works, and every bar
// was half as wide as it could be.
//
// The one thing a trimmed track must never do is hide a shift. So the track
// also reaches as far as any shift STARTING on that day: one placed before
// opening, or running past closing, widens its own day just enough to be
// seen whole. Past 23 the column is still numbered from the working day's
// midnight, because 25 is the number `needAt` and the generator's own audit
// speak. Only the label wraps to the wall clock a person reads.
//
// Kept out of DayGrid.tsx and free of React so it can be tested: the test
// environment is `node`, with no DOM (see vitest.config.ts), and "which columns
// does this day have" is exactly the part worth pinning.

import { DAY_MIN, isClosedOn, needAt, windowFor } from '../../lib/schedule/demand';
import type { Assignment, DayRef, SchedulingSpec } from '../../lib/schedule/types';

export interface DayTrack {
  /** First minute drawn, from midnight of the day the row belongs to. */
  startMin: number;
  /** Last minute drawn, exclusive. Past 1440 when the day runs into the next. */
  endMin: number;
  /**
   * The column hours, numbered from midnight of the day the row belongs to --
   * so a bar's last column is 27, not 3. These are the numbers `needAt` takes.
   */
  hours: number[];
  /** Index of the first column past midnight, or null when the day ends first. */
  midnightIndex: number | null;
  /** Does this day's window run into the next calendar day? */
  crossesMidnight: boolean;
}

/**
 * The columns this day gets: its opening hours, widened to any shift that
 * starts on it and falls outside them.
 *
 * `shifts` is every assignment on screen; only the ones filed under this day
 * are read. Omitted, the track is the opening hours alone.
 */
export function dayTrack(
  spec: SchedulingSpec,
  day: DayRef,
  shifts: readonly Assignment[] = [],
): DayTrack {
  // `windowFor`, never `spec.openMin` directly: the per-weekday override is the
  // whole reason "on Fridays we stay open until four" can be said at all, and
  // the strip below already honoured it while the row shading did not.
  const win = windowFor(spec, day);

  // Hour-aligned on both ends, so a bar and its column can never be half a cell
  // apart: an 09:30 opening still starts the track at 9, and the half hour
  // before it simply reads as shut, like any other closed hour.
  let startHour = Math.floor(win.openMin / 60);
  let endHour = Math.ceil(win.closeMin / 60);
  // A window too broken to draw (nothing between its ends) falls back to the
  // civil day rather than to zero columns: an empty grid explains nothing.
  if (!(endHour > startHour)) {
    startHour = 0;
    endHour = 24;
  } else if (!isClosedOn(spec, day)) {
    // And inside the window, only the hours somebody is NEEDED. A window can
    // be wider than the day it staffs -- one account's Tuesday was drawn from
    // three in the morning, fourteen empty columns before a bar that opens at
    // five, while the same screen called the day fully covered. Whatever put
    // those hours in the window, a column nobody is needed in and nobody works
    // in is the column the manager asked not to be shown. A window that needs
    // nobody anywhere (no floor, no rule) keeps its own hours rather than none.
    let first: number | null = null;
    let last: number | null = null;
    for (let h = startHour; h < endHour; h += 1) {
      if (needAt(spec, day, h) > 0) {
        first ??= h;
        last = h;
      }
    }
    if (first != null && last != null) {
      startHour = first;
      endHour = last + 1;
    } else {
      // Nobody is needed at any hour of the window: the spec states no
      // requirement, which is what a calendar adopted from the server's rows
      // carries (see `specFromShifts`). Its window says nothing about when the
      // business opens, so the day's own shifts are the best guide there is.
      const own = shifts.filter((a) => a.date === day.date && a.endMin > a.startMin);
      if (own.length > 0) {
        startHour = Math.max(0, Math.min(...own.map((a) => Math.floor(a.startMin / 60))));
        endHour = Math.max(...own.map((a) => Math.ceil(a.endMin / 60)));
      }
    }
  }
  for (const a of shifts) {
    if (a.date !== day.date || a.endMin <= a.startMin) continue;
    startHour = Math.min(startHour, Math.max(0, Math.floor(a.startMin / 60)));
    endHour = Math.max(endHour, Math.ceil(a.endMin / 60));
  }
  const crossesMidnight = endHour > 24;

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const midnight = hours.indexOf(24);
  return {
    startMin: startHour * 60,
    endMin: endHour * 60,
    hours,
    midnightIndex: midnight >= 0 ? midnight : null,
    crossesMidnight,
  };
}

export interface DaySegment {
  key: string;
  assignment: Assignment;
  /** Both in the track's own minutes, so they may go past 1440. */
  startMin: number;
  endMin: number;
  /** The bar is cut at the left edge of the track -- draw it square, not round. */
  continuesFromPrev: boolean;
  /** The bar is cut at the right edge of the track. */
  continuesToNext: boolean;
}

/** The day before this one, and how far its own track already drew. */
export interface PrevDay {
  date: string;
  track: DayTrack;
}

/**
 * The parts of `assignments` that belong on this day's track.
 *
 * ONE SHIFT IS DRAWN ONCE, UNDER THE DAY IT STARTS ON. With 24 fixed columns a
 * 22:00-02:00 shift had to be cut in half: the second piece had nowhere to go
 * but the next row, starting from its column 0. Now a day that runs past
 * midnight has its own columns out to hour 27, so the shift fits whole, under
 * the night it is worked -- one bar, one tooltip, one span of hours.
 *
 * WHERE THE SPILL GOES IS THE PREVIOUS DAY'S QUESTION, NOT THIS ONE'S. Asking
 * only whether TODAY crosses midnight drew a Friday night twice for any
 * business whose Friday closes at four and whose Saturday keeps ordinary
 * hours: Friday drew 22:00-04:00 whole, and Saturday -- a civil-day track,
 * which starts at column 0 -- drew the small hours all over again as a second
 * bar under a day nobody worked them on. So the spill is measured from where
 * yesterday's track ENDED. Everything up to that is already on screen; only
 * what runs past it is still homeless, and it lands here at the hour it really
 * happened.
 *
 * A spill can still find no room -- yesterday stopped at midnight, today opens
 * at nine -- and then it is not drawn at all. That is the honest outcome:
 * there is no column for two in the morning on a day the business is shut, and
 * inventing one would move the shift to a date it was not worked on.
 */
export function segmentsForDay(
  assignments: Assignment[],
  date: string,
  prev: PrevDay | null,
  track: DayTrack,
): DaySegment[] {
  const out: DaySegment[] = [];
  for (const a of assignments) {
    if (a.date === date) {
      const startMin = Math.max(a.startMin, track.startMin);
      const endMin = Math.min(a.endMin, track.endMin);
      if (endMin <= startMin) continue;
      out.push({
        key: `${a.id}-a`,
        assignment: a,
        startMin,
        endMin,
        continuesFromPrev: a.startMin < track.startMin,
        continuesToNext: a.endMin > track.endMin,
      });
      continue;
    }
    if (!prev || a.date !== prev.date) continue;
    // Yesterday drew as far as its own track reached. Only the remainder is
    // still looking for a row, and it keeps its real hours: a shift that ran to
    // four in the morning starts here where yesterday stopped, not at zero.
    const spillFrom = prev.track.endMin;
    if (a.endMin <= spillFrom) continue;
    const startMin = Math.max(spillFrom - DAY_MIN, track.startMin);
    const endMin = Math.min(a.endMin - DAY_MIN, track.endMin);
    if (endMin <= startMin) continue;
    out.push({
      key: `${a.id}-b`,
      assignment: a,
      startMin,
      endMin,
      continuesFromPrev: true,
      continuesToNext: a.endMin - DAY_MIN > track.endMin,
    });
  }
  return out;
}
