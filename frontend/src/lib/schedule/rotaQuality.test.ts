// The judge, judged.
//
// A bench is a thing other people will trust to tell them whether a change
// made the product worse. Every number it prints has to be one somebody can
// check by hand on a calendar small enough to hold in their head, or the first
// time it disagrees with a manager's own eyes the whole apparatus gets
// ignored -- which is worse than not having built it.
//
// So each case below is a rota of two or three shifts with a known answer,
// arranged so exactly one measurement has anything to say about it.

import { describe, expect, it } from 'vitest';
import { absence, absenceType, contract, days, employee, spec } from '../../test/factories';
import {
  compareRota,
  compareSuites,
  formatComparison,
  formatMetricsTable,
  measureRota,
  type RotaMetrics,
} from '../../test/rotaQuality';
import type { ScenarioInputs } from '../../test/objectiveScenarios';
import { EMPTY_OVERLAY } from './overlay';
import type { Assignment, SchedulingSpec } from './types';

const WEEK = days('2026-03-02', 7); // Monday to Sunday
const VACATION = absenceType({ id: 'atype-vac', name: 'Vacation', code: 'VAC' });

/** One person, with an explicit id so the shared factory counter cannot move it. */
function person(id: string, minHours = 0) {
  return employee({
    id,
    full_name: id,
    current_contract: contract({
      id: `contract-${id}`,
      employee_id: id,
      hourly_rate: 20,
      min_hours_per_week: minHours,
    }),
  });
}

/**
 * A shift, stated in whole hours.
 *
 * `templateId` is a `band-` id because that is what the generator emits for a
 * business with no templates of its own, and validate.ts accepts it. Anything
 * else would add an `unknown_template` to every case below and bury the one
 * violation each of them is actually about.
 */
function shift(
  id: string,
  employeeId: string,
  date: string,
  startHour: number,
  hours: number,
): Assignment {
  return {
    id,
    employeeId,
    date,
    startMin: startHour * 60,
    endMin: (startHour + hours) * 60,
    templateId: 'band-day',
    templateName: 'Day',
    color: '#2563EB',
    isNight: false,
    paidHours: hours,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
  };
}

function inputs(over: Partial<ScenarioInputs> = {}): ScenarioInputs {
  return {
    employees: [person('e1')],
    templates: [],
    absences: [],
    absenceTypes: [VACATION],
    spec: spec({ minStaff: 1, openMin: 9 * 60, closeMin: 17 * 60 }) as SchedulingSpec,
    days: WEEK,
    overlay: EMPTY_OVERLAY,
    ...over,
  };
}

describe('coverage', () => {
  it('an empty calendar is legal and covers nothing', () => {
    const m = measureRota('empty', [], inputs());
    // Legal is not the same as good, and this is the case that proves the
    // bench knows the difference: nobody is over-worked, no rule is broken,
    // and the shop is shut with the lights on for 56 person-hours.
    expect(m.hard).toBe(0);
    expect(m.requiredHours).toBe(56); // 8 open hours x 7 days x 1 person
    expect(m.uncoveredHours).toBe(56);
    expect(m.uncoveredPct).toBe(100);
  });

  it('counts the person-hours missing, not the hours with anyone missing', () => {
    // Two people wanted, one sent, for one hour of one day: that is one
    // uncovered person-hour and not one uncovered hour. Counting hours would
    // score a shop that is half-staffed all week the same as one that is
    // wholly unstaffed, which is the number a manager would notice is wrong.
    const m = measureRota(
      'half staffed',
      [shift('a1', 'e1', '2026-03-02', 9, 8)],
      inputs({ employees: [person('e1'), person('e2')], spec: spec({ minStaff: 2 }) }),
    );
    expect(m.requiredHours).toBe(112); // 8 hours x 7 days x 2 people
    expect(m.uncoveredHours).toBe(104);
  });
});

describe('legality', () => {
  it('counts a hard violation by kind, and does not repair it', () => {
    const m = measureRota(
      'double booked',
      [
        shift('a1', 'e1', '2026-03-02', 9, 4),
        shift('a2', 'e1', '2026-03-02', 11, 4),
      ],
      inputs(),
    );
    expect(m.hard).toBeGreaterThan(0);
    expect(m.hardByKind.overlap).toBe(1);
  });

  it('separates soft from hard', () => {
    // Nine to eighteen in a shop that shuts at five. Outside hours is the
    // manager's problem to explain, not a rota that may never be shown -- and
    // a bench that lumped the two together would fail a run for something the
    // manager may well have meant.
    const m = measureRota(
      'ran late',
      [shift('a1', 'e1', '2026-03-02', 9, 9)],
      inputs(),
    );
    expect(m.hard).toBe(0);
    expect(m.softByKind.outside_hours).toBe(1);
  });

  it('flags a shift given to somebody on approved leave', () => {
    const m = measureRota(
      'on holiday',
      [shift('a1', 'e1', '2026-03-04', 9, 8)],
      inputs({
        absences: [
          absence({
            id: 'abs-1',
            employee_id: 'e1',
            absence_type_id: 'atype-vac',
            start_at: '2026-03-04T00:00:00',
            end_at: '2026-03-04T23:59:00',
            status: 'approved',
          }),
        ],
      }),
    );
    expect(m.hardByKind.unavailable).toBe(1);
  });
});

describe('contracted hours', () => {
  it('counts the hours a whole week fell short by', () => {
    const m = measureRota(
      'short week',
      [shift('a1', 'e1', '2026-03-02', 9, 8)],
      inputs({ employees: [person('e1', 20)] }),
    );
    expect(m.shortfallHours).toBe(12);
    expect(m.peopleShort).toBe(1);
  });

  it('does not judge a week the period only half contains', () => {
    // Three days of a week is not evidence that anybody was short-changed.
    // Without this the bench would open every month that starts mid-week with
    // a shortfall nobody can act on -- the same rule weekHours.ts already
    // applies to the figure the manager reads on screen.
    const m = measureRota(
      'three days',
      [shift('a1', 'e1', '2026-03-02', 9, 8)],
      inputs({ employees: [person('e1', 20)], days: days('2026-03-02', 3) }),
    );
    expect(m.shortfallHours).toBe(0);
    expect(m.peopleShort).toBe(0);
  });

  it('says nothing about a contract that states no minimum', () => {
    const m = measureRota('no floor', [], inputs({ employees: [person('e1')] }));
    expect(m.shortfallHours).toBe(0);
  });
});

describe('pattern consistency', () => {
  it('is zero for somebody who always starts at the same time', () => {
    const m = measureRota(
      'same every day',
      [
        shift('a1', 'e1', '2026-03-02', 9, 4),
        shift('a2', 'e1', '2026-03-03', 9, 4),
        shift('a3', 'e1', '2026-03-04', 9, 4),
      ],
      inputs(),
    );
    expect(m.patternDriftMin).toBe(0);
    expect(m.peopleWithPattern).toBe(1);
  });

  it('measures how far the scattered days sit from the usual one', () => {
    // 08:00, 09:00, 14:00, 19:00. The usual start is 09:00, and the four
    // shifts sit 60, 0, 300 and 600 minutes from it: 240 on average. A rota
    // like this breaks no rule in validate.ts and is the exact complaint the
    // planner's prompt asks the model to avoid.
    const m = measureRota(
      'all over the clock',
      [
        shift('a1', 'e1', '2026-03-02', 8, 2),
        shift('a2', 'e1', '2026-03-03', 9, 2),
        shift('a3', 'e1', '2026-03-04', 14, 2),
        shift('a4', 'e1', '2026-03-05', 19, 2),
      ],
      inputs({ spec: spec({ openMin: 6 * 60, closeMin: 23 * 60 }) }),
    );
    expect(m.patternDriftMin).toBe(240);
    expect(m.worstPatternDriftMin).toBe(240);
  });

  it('treats 22:00 and 02:00 as four hours apart, not twenty', () => {
    // The whole reason the measurement goes round the clock instead of along a
    // number line. Two adjacent night shifts are the most CONSISTENT pattern a
    // night worker can have, and a straight subtraction would score them as
    // the most erratic rota in the building.
    const m = measureRota(
      'nights',
      [
        shift('a1', 'e1', '2026-03-02', 22, 2),
        shift('a2', 'e1', '2026-03-04', 2, 2),
      ],
      inputs({ spec: spec({ openMin: 0, closeMin: 24 * 60 }) }),
    );
    expect(m.patternDriftMin).toBe(120); // 0 and 240, averaged
  });

  it('ignores anybody with a single shift', () => {
    // One shift has no pattern to be inconsistent with. Scoring it as a
    // perfect 0 would let a configuration improve its drift by giving half the
    // team one day each, which is the opposite of what the number is for.
    const m = measureRota(
      'one each',
      [
        shift('a1', 'e1', '2026-03-01', 9, 4),
        shift('a2', 'e2', '2026-03-02', 15, 4),
      ],
      inputs({ employees: [person('e1'), person('e2')] }),
    );
    expect(m.peopleWithPattern).toBe(0);
    expect(m.patternDriftMin).toBe(0);
  });
});

describe('determinism', () => {
  it('measures the same calendar the same way twice', () => {
    const rota = [
      shift('a1', 'e2', '2026-03-02', 9, 4),
      shift('a2', 'e1', '2026-03-01', 13, 4),
      shift('a3', 'e2', '2026-03-03', 9, 4),
    ];
    const bundle = () => inputs({ employees: [person('e1'), person('e2')] });
    expect(measureRota('twice', rota, bundle())).toEqual(
      measureRota('twice', rota, bundle()),
    );
  });
});

// ---------------------------------------------------------------------------

function metrics(over: Partial<RotaMetrics> = {}): RotaMetrics {
  return {
    scenario: 's',
    hard: 0,
    hardByKind: {},
    soft: 0,
    softByKind: {},
    uncoveredHours: 0,
    requiredHours: 100,
    uncoveredPct: 0,
    shortfallHours: 0,
    peopleShort: 0,
    belowMinimum: 0,
    extraHours: 0,
    cost: 1000,
    paidHours: 100,
    overtimeHours: 0,
    patternDriftMin: 0,
    worstPatternDriftMin: 0,
    peopleWithPattern: 3,
    nightHoursByPerson: {},
    weekendHoursByPerson: {},
    nightSpread: 0,
    weekendSpread: 0,
    ...over,
  };
}

describe('A against B', () => {
  it('calls more uncovered hours a regression', () => {
    const cmp = compareRota(metrics(), metrics({ uncoveredHours: 4 }));
    expect(cmp.worse).toBe(true);
    expect(cmp.quality).toEqual([
      { axis: 'uncoveredHours', a: 0, b: 4, delta: 4 },
    ]);
  });

  it('calls scattered shifts a regression too', () => {
    // The axis nothing else in the repo watches. Without it a configuration
    // could shred every pattern on the rota and report a clean sheet.
    expect(compareRota(metrics(), metrics({ patternDriftMin: 30 })).worse).toBe(true);
  });

  it('does not fail a run for costing more', () => {
    // A cheaper way of GENERATING may well produce a dearer rota, and a bench
    // that refused it would be refusing a trade somebody made on purpose. The
    // bill is shown; it is not a veto.
    const cmp = compareRota(metrics(), metrics({ cost: 1400, overtimeHours: 6 }));
    expect(cmp.worse).toBe(false);
    expect(cmp.economics.map((d) => d.axis)).toEqual(['cost', 'overtimeHours']);
  });

  it('reports an improvement as an improvement', () => {
    const cmp = compareRota(metrics({ uncoveredHours: 8 }), metrics());
    expect(cmp.worse).toBe(false);
    expect(cmp.better).toBe(true);
  });

  it('calls an illegal rota illegal even when the old one was illegal too', () => {
    // "No worse than the last unshippable calendar" is not a result anybody
    // should be able to report green.
    const cmp = compareRota(
      metrics({ hard: 3, hardByKind: { rest: 3 } }),
      metrics({ hard: 3, hardByKind: { rest: 3 } }),
    );
    expect(cmp.worse).toBe(false);
    expect(cmp.illegal).toBe(true);
    // ...but it was not this change that broke it, and saying so is the only
    // way the word keeps its force for the run where B really did.
    expect(cmp.newlyIllegal).toBe(false);
  });

  it('separates what B broke from what it inherited', () => {
    const cmp = compareRota(metrics(), metrics({ hard: 1, hardByKind: { rest: 1 } }));
    expect(cmp.newlyIllegal).toBe(true);
    expect(cmp.worse).toBe(true);
  });

  it('matches scenarios by name and says which ones went missing', () => {
    const a = [metrics({ scenario: 'one' }), metrics({ scenario: 'two' })];
    const b = [metrics({ scenario: 'two' }), metrics({ scenario: 'three' })];
    const cmp = compareSuites(a, b);
    expect(cmp.missing).toEqual(['one']);
    expect(cmp.added).toEqual(['three']);
    expect(cmp.scenarios.map((s) => s.scenario)).toEqual(['two']);
  });

  it('is not worse than itself', () => {
    const run = [metrics({ scenario: 'one' }), metrics({ scenario: 'two', soft: 2 })];
    const cmp = compareSuites(run, run);
    expect(cmp.worse).toBe(false);
    expect(cmp.illegal).toBe(false);
  });
});

describe('the printed output', () => {
  it('puts every scenario on its own line and names the violations', () => {
    const table = formatMetricsTable(
      [metrics({ scenario: 'one', soft: 1, softByKind: { outside_hours: 1 } })],
      'baseline',
    );
    expect(table).toContain('baseline');
    expect(table).toContain('one');
    expect(table).toContain('outside_hours×1');
  });

  it('states a verdict in words, so a reader cannot mistake it', () => {
    const worse = formatComparison(
      compareSuites([metrics()], [metrics({ uncoveredHours: 2 })]),
      'default',
      'cheap',
    );
    expect(worse).toContain('VERDICT: cheap is worse than default');
    expect(formatComparison(compareSuites([metrics()], [metrics()]))).toContain(
      'VERDICT: B is no worse than A.',
    );
  });

  it('does not shout ILLEGAL about something B inherited', () => {
    const both = metrics({ hard: 7, hardByKind: { unknown_template: 7 } });
    const out = formatComparison(compareSuites([both], [both]), 'default', 'cheap');
    expect(out).toContain('VERDICT: cheap is no worse than default.');
    expect(out).toContain('illegal in both');
    expect(out).not.toContain('ILLEGAL, and default was not');
  });
});
