import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { WorkdayOut } from '../types';

/**
 * The browser's own zone by NAME -- "Europe/Madrid" -- or null if it will not say.
 *
 * WHAT IT IS FOR. Both endpoints here read a year of shifts and file them by
 * DAY: the day is what adds up into a week, a month and a stretch. A shift
 * that starts at 23:00 on a Saturday in Madrid is stored as 21:00 UTC on the
 * Saturday -- but at 23:00 in Phoenix it is 06:00 UTC on the SUNDAY, the next
 * week and sometimes the next month. Sending an instant says when the shift
 * happened; it does not say which day the manager counts it on.
 *
 * Send no zone and the server keeps the instant as it stands, which is to say
 * it cuts the days in UTC. That is the reading both of these endpoints gave
 * before, and it is the reason the zone now travels on EVERY call rather than
 * only on the one that first needed it: two screens reading the same rota with
 * two different days in mind disagree about a Saturday night, and no amount of
 * arithmetic downstream can reconcile them.
 *
 * `Intl` is everywhere this app runs, but the call is guarded anyway: neither
 * of these screens is worth a blank page, and without a name the server does
 * what it always did.
 */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The working year for a window.
 *
 * The window says what to REPORT; the server measures it against the whole
 * year, which is the only scale an annual average can be computed at. That is
 * also why this is a request rather than a calculation in the browser: the
 * calendar holds four weeks and the answer needs fifty-two.
 *
 * Takes `Date` and serialises here, like `useDraftSchedule` beside it: one
 * conversion per window, in the client that owns the request, so two callers
 * can never disagree about what "this week" means on the wire.
 *
 * AND IT SAYS WHERE IT IS ASKING FROM. The annual working year is cut into
 * weeks and months, so which day a shift belongs to decides which week it
 * lands in -- and this screen sits beside the "If you publish" column, which
 * cuts its days in the browser's zone. Two pages reading the same Saturday
 * night as two different Saturdays is not a rounding difference, it is two
 * answers, and a manager checking one against the other finds hours that
 * appear to have moved on their own. See `browserTimeZone`.
 */
export function useWorkday(from: Date, to: Date, enabled = true) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const tz = browserTimeZone();
  return useQuery({
    // The zone belongs in the key, not just in the request: see `queryKeys`.
    queryKey: queryKeys.workday(fromIso, toIso, tz),
    enabled,
    queryFn: async () => {
      const { data } = await api.get<WorkdayOut>('/workday', {
        params: { from: fromIso, to: toIso, ...(tz ? { tz } : {}) },
      });
      return data;
    },
  });
}

/** Where somebody stands over one stretch: worked, owed, and the gap. */
export interface Balance {
  worked: number;
  expected: number;
  deviation: number;
  /**
   * Hours on the rota for the WHOLE stretch, worked or still to come.
   *
   * Where this falls short of `total` is what the measured part of the stretch
   * still owes -- the question a manager asks in the middle of a month, and
   * the one a deviation figure cannot answer. The stretch beyond the measured
   * part is `pending`, and is a different kind of gap: not hours missing from
   * a rota, but rota nobody has written yet.
   */
  planned: number;
  /**
   * What the contract asks for over the MEASURED part of the stretch.
   *
   * The measured part runs from `start` to `horizon`: the stretch as far as
   * anybody has planned it. It is not the whole stretch, and the difference
   * matters -- a quarter looked at while only its first month is on the rota
   * used to be measured against three months of contract, so everybody read
   * as two months short of hours they had not been asked to work yet.
   *
   * What the contract asks for over the rest is `pending`, reported beside
   * this rather than folded into it, and `total + pending` is the whole
   * stretch's obligation.
   */
  total: number;
  /**
   * What the contract asks for in the part of the stretch NOBODY HAS PLANNED
   * yet -- zero once the stretch is planned end to end.
   *
   * Hours still to be handed out, not hours anybody is short of. A screen that
   * adds them to a deviation says somebody is failing at work that has not
   * been scheduled; a screen that drops them lets a manager publish a quarter
   * with two months empty and read "on track". So it travels separately and is
   * shown separately.
   */
  pending: number;
  /**
   * Exclusive end of the measured part, "YYYY-MM-DD", or null.
   *
   * Where `total` stops counting. Anything a client measures against `total`
   * -- a draft, most of all -- has to stop at the same day, or the numerator
   * and the denominator are talking about two different periods.
   */
  horizon: string | null;
  /**
   * PUBLISHED hours over the WHOLE stretch, `start` to its end -- past the
   * horizon too, where `planned` stops. The published half of the planner's
   * "X of Y hours", whose Y is `total + pending`: both cover the same days.
   * Optional so a server that predates it still reads (as `planned`).
   */
  planned_stretch?: number;
  /**
   * Published hours INSIDE the window being edited, when one was asked for.
   *
   * Zero unless `useBalances` was given a window. What it is for: publishing
   * REPLACES the rota on those dates rather than adding to it, so a projection
   * that lays the draft on top of `planned` has to take these out first or it
   * counts every shift that was already there twice. See
   * `lib/schedule/projectedBalance`.
   */
  published_in_window: number;
  /** False while the stretch is still running. */
  complete: boolean;
  /**
   * The day this stretch actually starts counting from (YYYY-MM-DD), or null.
   *
   * The latest of the stretch, the contract and the first rota this business
   * ever published -- so a screen can say "since 1 Sep" instead of implying a
   * January nobody worked in.
   */
  start: string | null;
}

export interface EmployeeBalances {
  employee_id: string;
  employee_name: string;
  contracted_weekly: number;
  month: Balance;
  quarter: Balance;
  year: Balance;
}

export interface BalancesOut {
  on: string;
  month_start: string;
  quarter_start: string;
  year_start: string;
  /**
   * The first day this business ever published a rota for, or null if it never
   * has. Nothing before it counts against anybody, which is why a screen
   * showing a year's balance has to be able to say where that year began.
   */
  cycle_start: string | null;
  employees: EmployeeBalances[];
}

/**
 * Each person's month, quarter and year, for the roster.
 *
 * One request for everybody rather than one per row: the server reads the
 * whole year once to answer it, and asking per employee would read the same
 * year again for each name on the list.
 *
 * WHAT THE WINDOW DOES. A draft never moves a balance -- these count published
 * hours and only published hours -- but passing the dates being edited changes
 * two things about the reading. Each stretch comes back with
 * `published_in_window`, the hours publishing would overwrite, which is the
 * one figure the browser cannot work out for itself and the one the projection
 * in `lib/schedule/projectedBalance` turns on. And the measured part of each
 * stretch (`total`, `horizon`, `pending`) is cut to the part that has been
 * planned, the window included -- so a quarter is judged on the month actually
 * on the table instead of on two months of contract nobody has scheduled yet.
 * Omit the window on screens that are not editing anything.
 */
/**
 * An instant written in the browser's own offset: "2026-10-01T00:00:00+02:00".
 *
 * NOT `toISOString()`, which writes UTC. The balances endpoint reads the DAY
 * of the window, and midnight on 1 October in Madrid is 22:00 on 30 September
 * in UTC -- so a manager in Spain planning October was shown September under
 * Month and July-September under Quarter. Nobody in a timezone west of
 * Greenwich could see it, because there midnight is still the same day in UTC.
 */
export function localIso(d: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

export function useBalances(
  enabled = true,
  window?: { from: Date; to: Date } | null,
) {
  // Local offset, not UTC: see `localIso`.
  const fromIso = window ? localIso(window.from) : null;
  const toIso = window ? localIso(window.to) : null;
  const tz = browserTimeZone();
  return useQuery({
    // The zone belongs in the key, not just in the request: see `queryKeys`.
    queryKey: queryKeys.balances(fromIso, toIso, tz),
    enabled,
    queryFn: async () => {
      const { data } = await api.get<BalancesOut>('/workday/balances', {
        params: {
          ...(fromIso && toIso ? { from: fromIso, to: toIso } : {}),
          ...(tz ? { tz } : {}),
        },
      });
      return data;
    },
  });
}
