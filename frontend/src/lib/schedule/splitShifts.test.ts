// Permission is not a request.
//
// "Puede haber gente que haga turnos partidos, que vengan por la mañana cuatro
// horas y luego se vengan de nuevo en la tarde otras cuatro." That permits a
// split. It does not ask for a rota where all five people work two halves
// every day — which is what an unlimited boolean produced.
//
// The rule these tests defend: how many people work a split is what the
// manager said, one when they permitted it without saying, and nobody when
// they never raised it. And a split is a last resort — it loses to giving
// somebody else their first shift, so the allowance is spent on the awkward
// hours it was granted for rather than on ordinary ones.

import { describe, expect, it } from 'vitest';
import { generateSchedule } from './generate';
import { EMPTY_OVERLAY } from './overlay';
import { contract, days, employee, spec, template } from '../../test/factories';
import type { Assignment } from './types';

const TEAM = ['Hugo', 'Adri', 'Aldridge', 'Ethan', 'Uri'].map((full_name) =>
  employee({ full_name }),
);

/** A long day the team cannot cover without either splits or gaps. */
const SHOP = (over = {}) =>
  spec({
    openMin: 9 * 60,
    closeMin: 22 * 60,
    minStaff: 2,
    closedWeekdays: [0],
    shiftLengthHours: 4,
    ...over,
  });

const TEMPLATES = [template({ start_time: '09:00', end_time: '17:00' })];
const WEEK = days('2026-09-07', 7);

/** People working two or more separate shifts on `date`. */
function splitPeople(assignments: Assignment[], date: string): number {
  const byPerson = new Map<string, number>();
  for (const a of assignments) {
    if (a.date !== date) continue;
    byPerson.set(a.employeeId, (byPerson.get(a.employeeId) ?? 0) + 1);
  }
  return [...byPerson.values()].filter((n) => n >= 2).length;
}

function openDates() {
  return WEEK.filter((d) => d.weekday !== 0).map((d) => d.date);
}

function build(over = {}) {
  return generateSchedule(TEAM, TEMPLATES, [], [], SHOP(over), WEEK);
}

describe('how many people work a split is the manager’s number', () => {
  it('nobody, when the brief never raised the subject', () => {
    const r = build({ splitShiftPeople: 0 });
    for (const date of openDates()) {
      expect(splitPeople(r.assignments, date)).toBe(0);
    }
  });

  it('exactly one, when the brief permitted splits without saying how many', () => {
    // The rule the product owner asked for in as many words: a permission with
    // no number means one person, not everyone.
    const r = build({ splitShiftPeople: 1 });
    for (const date of openDates()) {
      expect(splitPeople(r.assignments, date)).toBeLessThanOrEqual(1);
    }
  });

  it('the number the manager gave, when they gave one', () => {
    const r = build({ splitShiftPeople: 3 });
    for (const date of openDates()) {
      expect(splitPeople(r.assignments, date)).toBeLessThanOrEqual(3);
    }
  });

  it('reads the old boolean as one person, not as everybody', () => {
    // A draft saved before the count existed must not suddenly mean unlimited.
    const r = generateSchedule(
      TEAM, TEMPLATES, [], [],
      spec({ ...SHOP(), allowSplitShifts: true, splitShiftPeople: undefined }),
      WEEK,
    );
    for (const date of openDates()) {
      expect(splitPeople(r.assignments, date)).toBeLessThanOrEqual(1);
    }
  });
});

describe('a split is two halves, never three', () => {
  it('never gives one person a third shift in a day', () => {
    const r = build({ splitShiftPeople: 5 });
    for (const date of openDates()) {
      const byPerson = new Map<string, number>();
      for (const a of r.assignments) {
        if (a.date !== date) continue;
        byPerson.set(a.employeeId, (byPerson.get(a.employeeId) ?? 0) + 1);
      }
      for (const n of byPerson.values()) expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('leaves a real gap between the two halves', () => {
    const r = build({ splitShiftPeople: 2 });
    for (const date of openDates()) {
      const byPerson = new Map<string, Assignment[]>();
      for (const a of r.assignments) {
        if (a.date !== date) continue;
        byPerson.set(a.employeeId, [...(byPerson.get(a.employeeId) ?? []), a]);
      }
      for (const shifts of byPerson.values()) {
        if (shifts.length < 2) continue;
        const [first, second] = [...shifts].sort((a, b) => a.startMin - b.startMin);
        // Going home has to be worth the trip.
        expect(second.startMin - first.endMin).toBeGreaterThanOrEqual(60);
      }
    }
  });
});

describe('a split is a last resort, not a first choice', () => {
  it('gives a free person their first shift before splitting anyone', () => {
    // Five people, plenty of allowance, and a day that four of them can cover.
    // The scheduler must reach for the fifth person before asking anyone to
    // come back in the afternoon.
    const easy = spec({
      openMin: 9 * 60,
      closeMin: 17 * 60,
      minStaff: 2,
      closedWeekdays: [0],
      splitShiftPeople: 5,
    });
    const r = generateSchedule(TEAM, TEMPLATES, [], [], easy, WEEK);
    for (const date of openDates()) {
      expect(splitPeople(r.assignments, date)).toBe(0);
    }
  });

  it('still splits when it is the only way to cover the hours', () => {
    // Two people, a thirteen-hour day, four-hour shifts: somebody has to come
    // back or the shop stands empty. This is the valley the allowance exists
    // for, and the penalty must not turn a preference into a refusal.
    const pair = TEAM.slice(0, 2);
    const r = generateSchedule(pair, TEMPLATES, [], [], SHOP({ minStaff: 1, splitShiftPeople: 2 }), WEEK);
    const splits = openDates().reduce(
      (n, date) => n + splitPeople(r.assignments, date),
      0,
    );
    expect(splits).toBeGreaterThan(0);
  });
});

describe('the allowance buys coverage, not churn', () => {
  it('covers more hours with the allowance than without it', () => {
    const without = build({ splitShiftPeople: 0 });
    const with1 = build({ splitShiftPeople: 1 });
    expect(with1.gaps.length).toBeLessThanOrEqual(without.gaps.length);
  });
});

describe('no wage can buy a split ahead of somebody’s first shift', () => {
  // The first version of "last resort" was a flat penalty on the score. It did
  // not hold: the dominant term is `cost / resolved`, which scales with the
  // hourly rate, so on a mixed-wage roster the penalty was swallowed whole —
  // three cheap people worked split days while three expensive ones got no
  // shifts at all. A uniformly-paid roster cannot catch that, which is exactly
  // why the tests above did not.
  const cheap = [1, 2, 3, 4, 5].map((i) =>
    employee({
      full_name: `cheap${i}`,
      current_contract: contract({ hourly_rate: 10 }),
    }),
  );
  const dear = [6, 7, 8].map((i) =>
    employee({
      full_name: `dear${i}`,
      current_contract: contract({ hourly_rate: 90 }),
    }),
  );
  const MIXED = [...cheap, ...dear];

  it('gives the expensive people their first shift before splitting a cheap one', () => {
    const r = generateSchedule(
      MIXED, TEMPLATES, [], [], SHOP({ splitShiftPeople: 5 }), WEEK,
    );
    for (const date of openDates()) {
      const worked = new Set(
        r.assignments.filter((a) => a.date === date).map((a) => a.employeeId),
      );
      // Nobody idles while somebody else works two halves.
      if (splitPeople(r.assignments, date) > 0) {
        expect(worked.size).toBe(MIXED.length);
      }
    }
  });

  it('leaves nobody idle on a day the roster can cover with single shifts', () => {
    const r = generateSchedule(
      MIXED, TEMPLATES, [], [], SHOP({ splitShiftPeople: 5 }), WEEK,
    );
    for (const date of openDates()) {
      expect(splitPeople(r.assignments, date)).toBe(0);
    }
  });
});

describe('a shift pinned on a later day does not block the days before it', () => {
  it('still schedules the week before a pinned shift', () => {
    // The rest anchor used to be one running maximum over every pinned shift,
    // so a pin on Friday made Monday's rest check read a negative gap and
    // refused that person all week. Pinning one half of a split day is exactly
    // the gesture this feature invites, so the reach of that bug grew with it.
    const pinned = {
      id: 'pin-1',
      employeeId: TEAM[0].id,
      date: WEEK[4].date,
      startMin: 9 * 60,
      endMin: 13 * 60,
      templateId: 't1',
      templateName: 'Morning',
      color: '#3B82F6',
      isNight: false,
      paidHours: 4,
      overtimeHours: 0,
      extraHours: 0,
      cost: 60,
      source: 'manual' as const,
    };
    const r = generateSchedule(
      TEAM, TEMPLATES, [], [], SHOP({ splitShiftPeople: 1 }), WEEK,
      { ...EMPTY_OVERLAY, pinned: [pinned] },
    );
    const earlier = WEEK.slice(1, 4).map((d) => d.date);
    const worked = earlier.filter((date) =>
      r.assignments.some((a) => a.date === date && a.employeeId === TEAM[0].id),
    );
    expect(worked.length).toBeGreaterThan(0);
  });
});
