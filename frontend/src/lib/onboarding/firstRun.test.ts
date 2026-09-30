// The first-run answers, and the brief they have to come out as.
//
// The interesting assertions here are about what the composed brief does NOT
// say. A question the manager skipped must leave no sentence behind: a first
// run that quietly writes "at least two people" because nobody answered would
// be the exact failure this whole flow exists to remove — a number nobody
// decided, arriving as if somebody had.
//
// The second thing pinned is that the sentences stay sentences. They go into
// the box the manager edits and then through the ordinary intake, so a brief
// that reads like a form ("hours: 09:00-22:00") would be both worse to read and
// worse to parse.

import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/core';
import {
  closeAfterMidnight,
  composeFirstRunBrief,
  daySchedulesFromSpec,
  type DaySchedule,
} from './firstRun';
import { DEFAULT_SPEC } from '../schedule/spec';
import type { SchedulingSpec } from '../schedule/types';

/**
 * Weekday names as data, so the assertions do not move when a locale does.
 *
 * The app passes `weekdayName`, which asks the browser. What matters here is
 * that the composer only ever INTERPOLATES the name and never decides anything
 * by reading it.
 */
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const name = (weekday: number) => NAMES[weekday];

function days(
  hours: Partial<Record<number, Partial<DaySchedule>>> = {},
): DaySchedule[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openMin: 9 * 60,
    closeMin: 22 * 60,
    closed: false,
    ...hours[weekday],
  }));
}

describe('reading a spec back as seven days', () => {
  it('gives every day the standing hours when the brief stated only those', () => {
    const flat = daySchedulesFromSpec({ ...DEFAULT_SPEC, openMin: 600, closeMin: 1320 });
    expect(flat).toHaveLength(7);
    expect(flat.every((d) => d.openMin === 600 && d.closeMin === 1320)).toBe(true);
    expect(flat.some((d) => d.closed)).toBe(false);
  });

  it('flattens a per-weekday override onto the day it belongs to', () => {
    const spec: SchedulingSpec = {
      ...DEFAULT_SPEC,
      openMin: 9 * 60,
      closeMin: 22 * 60,
      dayHours: [{ weekday: 0, openMin: 10 * 60, closeMin: 14 * 60 }],
      closedWeekdays: [1],
    };
    const flat = daySchedulesFromSpec(spec);
    expect(flat[0]).toMatchObject({ openMin: 600, closeMin: 840, closed: false });
    expect(flat[1].closed).toBe(true);
    expect(flat[2]).toMatchObject({ openMin: 540, closeMin: 1320 });
  });
});

describe('the one question a night business gets', () => {
  it('is not asked when every day ends before midnight', () => {
    expect(closeAfterMidnight(days())).toBeNull();
  });

  it('quotes back the latest closing time, so a wrong reading is visible', () => {
    const late = days({ 5: { closeMin: 26 * 60 }, 6: { closeMin: 28 * 60 } });
    expect(closeAfterMidnight(late)).toBe(28 * 60);
  });

  it('ignores a day the business is shut, however late its hours look', () => {
    const shut = days({ 6: { closeMin: 28 * 60, closed: true } });
    expect(closeAfterMidnight(shut)).toBeNull();
  });
});

describe('composing the first brief', () => {
  it('writes nothing at all when every question was skipped', () => {
    expect(
      composeFirstRunBrief(
        { days: null, peakStaff: null, splitShift: null },
        name,
      ),
    ).toBe('');
  });

  it('never invents the staffing number nobody gave', () => {
    setLanguage('en');
    const brief = composeFirstRunBrief(
      { days: days(), peakStaff: null, splitShift: null },
      name,
    );
    expect(brief).not.toMatch(/people/);
    expect(brief).toMatch(/open every day/);
  });

  it('says "every day" rather than listing seven weekdays', () => {
    setLanguage('en');
    const brief = composeFirstRunBrief(
      { days: days(), peakStaff: null, splitShift: null },
      name,
    );
    expect(brief).toBe('We open every day from 9:00 AM to 10:00 PM.');
  });

  it('groups the days that share hours and names the ones that differ', () => {
    setLanguage('en');
    const brief = composeFirstRunBrief(
      {
        days: days({
          5: { closeMin: 28 * 60 },
          6: { closeMin: 28 * 60 },
          0: { closed: true },
        }),
        peakStaff: null,
        splitShift: null,
      },
      name,
    );
    expect(brief).toBe(
      [
        'We open Mon, Tue, Wed, Thu from 9:00 AM to 10:00 PM.',
        'We open Fri, Sat from 9:00 AM to 4:00 AM.',
        'We are closed on Sun.',
      ].join('\n'),
    );
  });

  it('writes a closing hour past midnight as the hour it is spoken as', () => {
    setLanguage('en');
    const brief = composeFirstRunBrief(
      { days: days({}).map((d) => ({ ...d, openMin: 18 * 60, closeMin: 28 * 60 })), peakStaff: null, splitShift: null },
      name,
    );
    // Written the way a manager says it — "six to four" — which is exactly the
    // shape the intake is told to expect for a business that works past
    // midnight. A "28:00" here would be refused by the schema.
    expect(brief).toBe('We open every day from 6:00 PM to 4:00 AM.');
  });

  it('turns a yes about split days into one person, not everybody', () => {
    setLanguage('en');
    const brief = composeFirstRunBrief(
      { days: null, peakStaff: null, splitShift: true },
      name,
    );
    expect(brief).toBe(
      'One person can work a split day: two separate shifts on the same day.',
    );
  });

  it('leaves a no about split days unsaid, because it is already the default', () => {
    const brief = composeFirstRunBrief(
      { days: null, peakStaff: 3, splitShift: false },
      name,
    );
    expect(brief.split('\n')).toHaveLength(1);
    expect(brief).not.toMatch(/split|partido/i);
  });

  it('writes the manager an answer in their own language', () => {
    setLanguage('es');
    const brief = composeFirstRunBrief(
      { days: days({ 0: { closed: true } }), peakStaff: 4, splitShift: true },
      name,
    );
    setLanguage('en');
    expect(brief).toBe(
      [
        'Abrimos Mon, Tue, Wed, Thu, Fri, Sat de 09:00 a 22:00.',
        'Cerramos Sun.',
        'Como mínimo tiene que haber 4 personas trabajando a la vez.',
        'Una persona puede hacer turno partido: dos turnos distintos el mismo día.',
      ].join('\n'),
    );
  });

  it('says a round-the-clock business is open 24 hours', () => {
    setLanguage('en');
    const brief = composeFirstRunBrief(
      {
        days: days().map((d) => ({ ...d, openMin: 0, closeMin: 24 * 60 })),
        peakStaff: 2,
        splitShift: null,
      },
      name,
    );
    expect(brief).toBe(
      [
        'We are open 24 hours, every day.',
        'At least 2 people have to be working at any one time.',
      ].join('\n'),
    );
  });
});
