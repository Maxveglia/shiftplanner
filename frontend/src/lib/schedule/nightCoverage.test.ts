// The busiest stretch of a bar is the one that runs past midnight, and every
// layer between the brief and the calendar used to lose it in a different way.
//
// These are regression tests for two of those layers. The third -- the intake
// erasing a coverage window whose close lands before its open, turning "three
// people from 23:00" into three people at breakfast -- lives in the backend
// suite, because that conversion happens before any of this code runs.
//
// What ties them together: none of the failures raised anything. The rule was
// dropped and the gap that would have reported it was measured against the
// same broken reading, so the calendar came out wrong and confident.

import { describe, expect, it } from 'vitest';
import { generateSchedule, summarize } from './generate';
import { needAt } from './demand';
import { absenceType, contract, days, employee, spec } from '../../test/factories';
import type { EmployeeOut } from '../../types';

const WEEK = days('2026-03-01', 7); // Sunday 1 to Saturday 7 March 2026
const VACATION = absenceType({ id: 'atype-vac' });

function team(n: number): EmployeeOut[] {
  return Array.from({ length: n }, (_, i) =>
    employee({
      id: `e${i + 1}`,
      full_name: `Person ${i + 1}`,
      current_contract: contract({ id: `c-e${i + 1}`, employee_id: `e${i + 1}` }),
    }),
  );
}

/** Nine in the morning until four the next -- the hours a real bar gave us. */
const BAR = spec({
  minStaff: 1,
  openMin: 9 * 60,
  closeMin: 28 * 60,
  weekendDays: [5, 6],
  dayBoundaryMin: 6 * 60,
});

describe('a coverage window that runs past midnight', () => {
  // The intake now rolls these over, so `endMin` arrives beyond 1440. This is
  // the shape the generator actually receives.
  const ROLLED = spec({
    ...BAR,
    coverage: [
      {
        weekdays: [],
        dates: [],
        startMin: 23 * 60,
        endMin: 28 * 60, // 04:00 the next day
        staff: 3,
        exact: false,
      },
    ],
  });

  it('asks for the extra people in the small hours, not during the day', () => {
    const day = WEEK[1];
    expect(needAt(ROLLED, day, 14)).toBe(1); // an ordinary afternoon
    expect(needAt(ROLLED, day, 23)).toBe(3); // the window opens
    expect(needAt(ROLLED, day, 25)).toBe(3); // 01:00, still inside it
    expect(needAt(ROLLED, day, 27)).toBe(3); // 03:00, the last hour
  });

  // A spec can also reach the generator unrolled: the local parser writes one,
  // a refine op writes one, and a draft persisted before the rollover existed
  // still deserializes into one. Unrolled, `startMin > endMin` matched no
  // minute of any day, so the rule was neither applied nor reported missing.
  it('is honoured even when it arrives written the way it is spoken', () => {
    const spoken = spec({
      ...BAR,
      coverage: [
        {
          weekdays: [],
          dates: [],
          startMin: 23 * 60,
          endMin: 4 * 60, // close before open, exactly as a person says it
          staff: 3,
          exact: false,
        },
      ],
    });
    const day = WEEK[1];
    expect(needAt(spoken, day, 14)).toBe(1);
    expect(needAt(spoken, day, 23)).toBe(3);
    expect(needAt(spoken, day, 25)).toBe(3);
  });

  it('puts people on shift after midnight to meet it', () => {
    const result = generateSchedule(team(6), [], [], [VACATION], ROLLED, WEEK);
    const smallHours = result.assignments.filter((a) => a.endMin > 24 * 60);
    expect(smallHours.length).toBeGreaterThan(0);
  });
});

describe('recounting a calendar that runs past midnight', () => {
  // Every manual edit and every refinement recomputes through `summarize`.
  // It used to model the small hours as belonging to the NEXT day while the
  // generator filed them under the day the shift starts, so the two disagreed
  // about the same assignments -- and only the disagreement was shown.
  it('agrees with the generator about who is on shift', () => {
    const staff = team(6);
    const built = generateSchedule(staff, [], [], [VACATION], BAR, WEEK);
    const recounted = summarize(built.assignments, staff, [], [VACATION], BAR, WEEK);

    expect(recounted.gaps).toEqual(built.gaps);
    expect(recounted.totalHours).toBeCloseTo(built.totalHours, 5);
  });

  it('does not invent a hole where somebody is standing', () => {
    const staff = team(6);
    const built = generateSchedule(staff, [], [], [VACATION], BAR, WEEK);
    const recounted = summarize(built.assignments, staff, [], [VACATION], BAR, WEEK);

    // The hours after midnight are the ones that came back empty before.
    const smallHourGaps = recounted.gaps.filter((g) => g.hour >= 24);
    const covered = built.assignments.some((a) => a.endMin > 25 * 60);
    expect(covered).toBe(true);
    expect(smallHourGaps.filter((g) => g.have === 0)).toEqual([]);
  });
});
