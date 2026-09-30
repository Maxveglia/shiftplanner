// Which hours of a shift earn a premium, answered in one place.
//
// Two parts of the product need this and must never disagree about it: the
// payroll table, which pays the premiums, and the generator, which books what
// a shift costs and shares the unsocial hours out. They used to hold a copy
// each -- payroll with its own 22:00-06:00 walk, the generator with
// `nightHoursIn` over the spec's window -- and a rota whose booked cost and
// whose payroll are two different numbers is a rota the manager cannot trust
// either half of.
//
// So both read these hours from here, and the two readings are the SAME ones
// payroll always made:
//
//   night    the minutes inside the night window, scaled by the paid ratio of
//            the shift. An unpaid half hour shrinks the paid time, and a
//            premium window that ignored it would pay a premium on a break.
//   weekend  every paid hour of a shift that STARTS on a weekend day. Friday
//            18:00-04:00 earns no weekend premium for its Saturday hours --
//            the convention the hours and the week key already use, and
//            spelled out on `computePayroll` as a decision of its own.
//
// "Unsocial" below is the two added together: the hours of a shift nobody
// would pick if the choice were theirs. It is what the generator spreads
// across the team, and it is a question about PEOPLE rather than money -- a
// night is as late for somebody paid no premium as for somebody paid 25%.

import { DEFAULT_WEEKEND_DAYS, isWeekendDay } from './demand';
import { DEFAULT_NIGHT_WINDOW, nightHoursIn, type NightWindow } from './night';
import type { PayPolicy } from './payroll';

/** The part of a shift these questions read. `Assignment` has all of it. */
export interface PremiumShift {
  startMin: number;
  endMin: number;
  paidHours: number;
}

export interface PremiumHours {
  /** Paid hours inside the night window. */
  night: number;
  /** Paid hours on a weekend day, by the day the shift starts. */
  weekend: number;
}

/**
 * The premium hours of one shift.
 *
 * `weekday` is the day the shift starts, 0 = Sunday; undefined when the
 * caller cannot place the shift on a day, which earns no weekend premium --
 * the same answer payroll gave a shift whose date was outside its days.
 *
 * `window` defaults to 22:00-06:00, which is what payroll hardcoded before it
 * was given a window to read. Left off, every figure is the one it always was.
 */
export function premiumHours(
  shift: PremiumShift,
  weekday: number | undefined,
  window: NightWindow | null | undefined = DEFAULT_NIGHT_WINDOW,
  weekendDays: number[] | undefined = DEFAULT_WEEKEND_DAYS,
): PremiumHours {
  const span = shift.endMin - shift.startMin;
  const paidRatio = span > 0 ? (shift.paidHours * 60) / span : 0;
  const night =
    nightHoursIn(shift.startMin, shift.endMin, window ?? DEFAULT_NIGHT_WINDOW) *
    paidRatio;
  const weekend =
    weekday != null && isWeekendDay(weekday, weekendDays) ? shift.paidHours : 0;
  return { night, weekend };
}

/** Night plus weekend: the hours the generator shares out. */
export function unsocialHours(h: PremiumHours): number {
  return h.night + h.weekend;
}

/**
 * What those hours add to the shift's pay, for somebody on `rate` an hour
 * under `policy` (already the person's own -- see `effectivePolicy`).
 *
 * Written as payroll writes it, rate times percentage first and hours second,
 * so the two differ by nothing more than where the sum is taken.
 */
export function premiumPay(
  h: PremiumHours,
  rate: number,
  policy: PayPolicy,
): number {
  const nightRate = rate * (policy.nightDifferentialPct / 100);
  const weekendRate = rate * (policy.weekendPremiumPct / 100);
  return h.night * nightRate + h.weekend * weekendRate;
}

/** Weekday of a YYYY-MM-DD key, 0 = Sunday, read in local time like the days. */
export function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
