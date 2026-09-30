// The first five minutes of an account, turned back into a brief.
//
// A new organization used to be created, seeded, and left in front of an empty
// textarea having been asked nothing at all. This module is the other half of
// fixing that: the questions live in the panel, and what the manager answers
// comes back through HERE, as a brief written in their own language.
//
// WHY A BRIEF AND NOT A SPEC. The obvious shortcut is to write the answers
// straight into a `SchedulingSpec` — the shapes line up, and it would save a
// round trip. It is also the one thing this file must not do. Opening hours
// already have exactly one source of truth, the brief, and everything
// downstream (the rules panel, the learned hints, the refine loop, the gaps the
// profile reports) is built on the assumption that what a calendar enforces can
// be read back in the sentence that asked for it. A second writer would give
// the product two places that can disagree about when the shop opens and no
// rule for deciding which one is right.
//
// So the answers become words, the words go through the ordinary intake, and
// the manager can see and edit the sentence that produced their calendar. The
// two things that are NOT hours — which days carry the weekend, and when this
// business's day ends — go to their own columns on `business_profile`, because
// they are settings a human states rather than requirements a brief makes.
//
// Kept free of React on purpose: composing a brief from a set of answers is the
// part worth pinning in tests, and the test environment here has no DOM.

import { translate } from '../i18n/core';
import { hhmm } from '../schedule/spec';
import type { SchedulingSpec } from '../schedule/types';

/** Weekday indexes in the order a week is read, 0 = Sunday. */
export const WEEK_READING_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Where a night business's day ends, when the manager confirms it has one.
 *
 * Six in the morning, and it is a constant rather than a question because the
 * question it would replace has no good answer: nobody knows the minute their
 * Friday becomes Saturday, they know that four in the morning is still Friday
 * night. Six is late enough to hold every closing time a bar or a club states
 * and early enough that a bakery's opening shift never falls on the day before.
 *
 * Only ever written after a yes. A manager who says the four o'clock they meant
 * was the afternoon leaves the column NULL, which is how "never asked" stays
 * distinguishable from "confirmed midnight" — see `business_profile`.
 */
export const NIGHT_DAY_BOUNDARY_MIN = 6 * 60;

/** Minutes in a civil day. A close beyond this runs into the next one. */
const DAY_MIN = 24 * 60;

/** What one weekday's opening hours are, as the manager can correct them. */
export interface DaySchedule {
  /** 0 = Sunday. */
  weekday: number;
  /** Minutes from midnight. */
  openMin: number;
  /** Minutes from midnight; above 1440 when the day runs past midnight. */
  closeMin: number;
  closed: boolean;
}

/** Everything the first-run questions can end up holding. */
export interface FirstRunAnswers {
  /** Seven days, or null when the hours question was skipped. */
  days: DaySchedule[] | null;
  /** People needed at once at the busiest point of the day, or null. */
  peakStaff: number | null;
  /** Whether anyone may work two shifts in one day, or null when unanswered. */
  splitShift: boolean | null;
}

/**
 * Read a spec's opening hours back out as seven separate days.
 *
 * The spec says the same thing in two layers — standing hours plus per-weekday
 * overrides — because that is how a brief says it ("we open nine to ten, and
 * Sundays only until two"). A person correcting their hours wants neither
 * layer: they want the seven rows, so that fixing Sunday is fixing Sunday and
 * not editing an exception to a rule. Flattening here is what lets the panel
 * show a table a manager can read at a glance.
 */
export function daySchedulesFromSpec(spec: SchedulingSpec): DaySchedule[] {
  const closed = new Set(spec.closedWeekdays ?? []);
  const overrides = new Map(
    (spec.dayHours ?? []).map((d) => [d.weekday, d] as const),
  );
  return Array.from({ length: 7 }, (_, weekday) => {
    const override = overrides.get(weekday);
    return {
      weekday,
      openMin: override?.openMin ?? spec.openMin,
      closeMin: override?.closeMin ?? spec.closeMin,
      closed: closed.has(weekday),
    };
  });
}

/**
 * The latest closing time that lands after midnight, or null if none does.
 *
 * Drives the one confirmation question the hours step can ask. Returning the
 * TIME rather than a boolean is deliberate: the question has to quote the hour
 * back ("four in the morning, the next day?"), because a manager who meant four
 * in the afternoon has to be able to see the mistake in the question itself.
 */
export function closeAfterMidnight(days: DaySchedule[]): number | null {
  const late = days
    .filter((d) => !d.closed && d.closeMin > DAY_MIN)
    .map((d) => d.closeMin);
  return late.length > 0 ? Math.max(...late) : null;
}

/** Days sharing one set of hours, in the order a week is read. */
interface HoursGroup {
  weekdays: number[];
  openMin: number;
  closeMin: number;
}

function groupByHours(days: DaySchedule[]): HoursGroup[] {
  const groups: HoursGroup[] = [];
  for (const weekday of WEEK_READING_ORDER) {
    const day = days.find((d) => d.weekday === weekday);
    if (!day || day.closed) continue;
    const same = groups.find(
      (g) => g.openMin === day.openMin && g.closeMin === day.closeMin,
    );
    if (same) same.weekdays.push(weekday);
    else groups.push({ weekdays: [weekday], openMin: day.openMin, closeMin: day.closeMin });
  }
  return groups;
}

/**
 * The name of a weekday, in the manager's language.
 *
 * Injected rather than imported so this module stays testable without a locale:
 * the caller passes `weekdayName` from lib/schedule/spec in the app, and a
 * fixed table in a test. Nothing here decides anything by comparing the result
 * — it only ever interpolates it.
 */
export type WeekdayNamer = (weekday: number) => string;

/**
 * Turn the answers into the brief the manager would have typed.
 *
 * Every sentence is one dictionary key with placeholders, never a phrase built
 * from translated pieces: "closed on" and a day name are one clause in English
 * and a different one in Spanish, and gluing them produced sentences no manager
 * would write. The lists of weekday names inside a sentence ARE glued, with a
 * comma, which is punctuation rather than language — the same thing the busy-day
 * question has always done.
 *
 * An answer that was skipped writes no sentence at all. That is the whole
 * contract of the flow: skipping a question leaves the product exactly where it
 * was, with the gap it already knew how to report.
 */
export function composeFirstRunBrief(
  answers: FirstRunAnswers,
  weekdayName: WeekdayNamer,
): string {
  const lines: string[] = [];
  const days = answers.days;

  if (days) {
    const open = groupByHours(days);
    const closed = WEEK_READING_ORDER.filter(
      (wd) => days.find((d) => d.weekday === wd)?.closed,
    );

    for (const group of open) {
      const around = { from: hhmm(group.openMin), to: hhmm(group.closeMin) };
      // Branching on the numbers, never on the words: "every day" and "24
      // hours" are the same fact said shorter, and a seven-name list is a
      // sentence nobody would say out loud.
      const allWeek = group.weekdays.length === 7;
      const allDay = group.openMin === 0 && group.closeMin >= DAY_MIN;
      const names = group.weekdays.map(weekdayName).join(', ');
      if (allDay) {
        lines.push(
          allWeek
            ? translate('onboarding.brief.open24EveryDay')
            : translate('onboarding.brief.open24', { days: names }),
        );
      } else {
        lines.push(
          allWeek
            ? translate('onboarding.brief.hoursEveryDay', around)
            : translate('onboarding.brief.hours', { days: names, ...around }),
        );
      }
    }

    if (closed.length > 0) {
      lines.push(
        translate('onboarding.brief.closed', {
          days: closed.map(weekdayName).join(', '),
        }),
      );
    }
  }

  if (answers.peakStaff !== null) {
    lines.push(
      translate('onboarding.brief.minStaff', { count: answers.peakStaff }),
    );
  }

  // Only a yes writes a sentence. "Nobody works two shifts in a day" is already
  // what the spec says when nothing is stated (`splitShiftPeople` is 0), so
  // writing it out would add a line the intake has to understand in order to
  // change nothing — and a line it half-understands lands in `notes`, where it
  // shows up on screen as a requirement we could not apply.
  if (answers.splitShift === true) {
    lines.push(translate('onboarding.brief.split'));
  }

  return lines.join('\n');
}
