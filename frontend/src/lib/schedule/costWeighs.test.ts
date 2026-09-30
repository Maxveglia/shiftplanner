// "El coste pesa pero no manda": the base wage, in the default objective.
//
// premiums.test.ts pins the half of the owner's sentence that is about night
// and weekend premiums, which never enter the score at all. This file pins the
// other half, which is about the hourly rate itself, and which DOES enter the
// score -- it has to, or two people the manager cannot tell apart would be a
// coin toss when one of them is cheaper. What it may not do is outvote the
// manager: how many people an hour needs, who has already worked, what they
// asked for.
//
// So two people, identical in everything the manager said, one on 12 an hour
// and one on 20:
//
//   1. With nothing else between them, the cheaper one gets the hour. That is
//      the cost weighing.
//   2. Once the cheaper one has already worked markedly more -- two six-hour
//      days to none -- the default hands the hour to the other. That is the
//      cost not deciding. Before the wage was split (see `teamRate` in
//      ./generate) it still went to the cheaper one: the 8-euro gap was worth
//      8 points, twelve hours of `spreadHours` only 7.2.
//   3. A business that picked `cheapest` asked for the opposite, and gets it.
//
// Twelve hours is chosen to sit between the two weightings, not on either
// edge: the default lets the cheaper person be up to about nine hours ahead
// (0.7 x 8 = 5.6 points, at 0.6 an hour) and the old weighting thirteen.

import { describe, expect, it } from 'vitest';
import { contract, days, employee, spec } from '../../test/factories';
import { generateSchedule } from './generate';
import { DEFAULT_OBJECTIVE, OBJECTIVES } from './objective';
import { EMPTY_OVERLAY } from './overlay';
import type { Assignment, SchedulingObjective } from './types';

// Monday 2 March to Wednesday 4 March 2026: the first two days are already
// worked, the Wednesday is the question.
const WEEK = days('2026-03-02', 3);
const WEDNESDAY = '2026-03-04';

function person(id: string, rate: number) {
  return employee({
    id,
    full_name: id,
    current_contract: contract({ id: `contract-${id}`, employee_id: id, hourly_rate: rate }),
  });
}

/** A six-hour day the manager already placed, 09:00-15:00. */
function worked(id: string, employeeId: string, date: string): Assignment {
  return {
    id,
    employeeId,
    date,
    startMin: 9 * 60,
    endMin: 15 * 60,
    templateId: 'band-worked',
    templateName: 'Worked',
    color: '#2563EB',
    isNight: false,
    paidHours: 6,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'manual',
  };
}

/** Who works Wednesday, 09:00-15:00, one person on the floor. */
function wednesday(
  roster: ReturnType<typeof person>[],
  pinned: Assignment[],
  objective?: SchedulingObjective,
): string[] {
  const result = generateSchedule(
    roster,
    [],
    [],
    [],
    spec({ objective, openMin: 9 * 60, closeMin: 15 * 60, minStaff: 1 }),
    WEEK,
    { ...EMPTY_OVERLAY, pinned },
  );
  expect(result.gaps).toEqual([]);
  return result.assignments.filter((a) => a.date === WEDNESDAY).map((a) => a.employeeId);
}

const CHEAP = person('cheap', 12);
const DEAR = person('dear', 20);
/** Monday and Tuesday for the cheaper person, and all of both days' cover. */
const AHEAD = [worked('p1', 'cheap', '2026-03-02'), worked('p2', 'cheap', '2026-03-03')];
/** The same two days, but for the one who costs more. */
const DEAR_AHEAD = [worked('p1', 'dear', '2026-03-02'), worked('p2', 'dear', '2026-03-03')];

describe('the base wage weighs', () => {
  it('gives the hour to the cheaper of two people nothing else separates', () => {
    // Both have worked the same two days, so the only thing between them is
    // the rate. Either way round, so the answer is the price and not the order
    // the roster was written in.
    const bothWorked = [...AHEAD, ...DEAR_AHEAD].map((a, i) => ({ ...a, id: `b${i}` }));
    expect(wednesday([CHEAP, DEAR], bothWorked)).toEqual(['cheap']);
    expect(wednesday([DEAR, CHEAP], bothWorked)).toEqual(['cheap']);
  });
});

describe('but does not decide', () => {
  it('shares the hour out once the cheaper person is markedly ahead', () => {
    expect(wednesday([CHEAP, DEAR], AHEAD)).toEqual(['dear']);
  });

  it('where the wage used to decide it', () => {
    // The default before the split: both halves of the wage at 1, which adds
    // back up to each person's own bill. Kept as an assertion rather than a
    // comment so the day this stops being true, the header above stops being
    // true with it -- and because it is what proves the test above is about
    // the weight: on the same two worked days, nothing but the weight stops
    // the cheaper person working Wednesday.
    const before = { ...DEFAULT_OBJECTIVE, preferCheaperPeople: DEFAULT_OBJECTIVE.wageSensitivity };
    expect(wednesday([CHEAP, DEAR], AHEAD, before)).toEqual(['cheap']);
  });

  it('unless the business asked for the cheapest rota', () => {
    expect(wednesday([CHEAP, DEAR], AHEAD, OBJECTIVES.cheapest)).toEqual(['cheap']);
  });
});
