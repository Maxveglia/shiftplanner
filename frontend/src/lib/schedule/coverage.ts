// How many PEOPLE are on shift at a given minute.
//
// One definition, in one file, because there were three and they were all
// wrong in the same way. `DayGrid` counted the bars it was about to draw,
// `validateSchedule` counted assignments, and the generator's own summary
// counted them again -- and all three counted SHIFTS.
//
// That is the same number as long as nobody has two shifts at once, which is
// exactly the case the product could not rule out: pressing an hour that a
// person already worked laid a second shift on top of the first, and from
// then on the coverage strip showed two people where there was one. A bar
// needing two on at nine in the evening read as covered with one person
// standing there.
//
// So the answer is a count of DISTINCT EMPLOYEES, and it lives here. A rule
// this product gets wrong in three places at once is a rule that needed a
// home, not three more careful copies.
//
// A legitimate split day -- two separate stretches, same person, same date --
// still counts one, because its stretches do not overlap: at any given minute
// only one of them is running.

import { coverageMinute, type OpenWindow } from './demand';

/** The least a caller has to carry for this to be answerable. */
export interface CoverageSpan {
  employeeId: string;
  /** Minutes from the track's midnight. May exceed 1440 for an overnight. */
  startMin: number;
  endMin: number;
}

/**
 * The people on shift at `minute`, counted once each.
 *
 * Half-open on purpose -- start inclusive, end exclusive -- so somebody whose
 * shift ends at 22:00 is not counted at 22:00. Two shifts that meet at an hour
 * hand over there; counting both would invent a person for that minute.
 */
export function peopleAt(spans: Iterable<CoverageSpan>, minute: number): number {
  const present = new Set<string>();
  for (const s of spans) {
    if (s.startMin <= minute && s.endMin > minute) present.add(s.employeeId);
  }
  return present.size;
}

/**
 * `peopleAt` for a whole hour of the day, which is how the grid asks.
 *
 * Pass the day's window: the hour it opens in is counted at the opening
 * minute, not before it (see `coverageMinute`).
 */
export function peopleAtHour(
  spans: Iterable<CoverageSpan>,
  hour: number,
  win?: OpenWindow,
): number {
  return peopleAt(spans, win ? coverageMinute(win, hour) : hour * 60);
}
