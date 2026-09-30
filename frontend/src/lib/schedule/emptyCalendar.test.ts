// An empty calendar is sometimes the right answer, and saying so badly is its
// own bug. A team hired on 3 September, looked at through August, produces a
// correct empty calendar — and the first version of this told the manager
// "there was nobody available, fix this and generate again". There was nothing
// to fix, and nothing above to fix it on.

import { describe, expect, it } from 'vitest';
import { explainEmptyCalendar } from './emptyCalendar';
import { generateSchedule, monthDays, weekDays } from './generate';
import type { ScheduleResult } from './types';
import { absence, absenceType, contract, days, employee, spec, template } from '../../test/factories';

const HIRE = '2026-09-03';

/** The roster as the brief creates it: hired today, contract from today. */
const TEAM = ['Hugo', 'Adri', 'Aldridge', 'Ethan', 'Uri'].map((full_name) =>
  employee({
    full_name,
    hire_date: HIRE,
    current_contract: contract({ valid_from: HIRE }),
  }),
);

const SHOP = spec({
  openMin: 9 * 60,
  closeMin: 22 * 60,
  minStaff: 2,
  closedWeekdays: [0],
});

const TEMPLATES = [template({ start_time: '09:00', end_time: '17:00' })];

function build(period: ReturnType<typeof monthDays>): ScheduleResult {
  return generateSchedule(TEAM, TEMPLATES, [], [], SHOP, period);
}

function explain(period: ReturnType<typeof monthDays>, roster = TEAM) {
  return explainEmptyCalendar(build(period), SHOP, period, roster, [], []);
}

describe('a period before the team starts is not a fault', () => {
  const AUGUST = monthDays(new Date(2026, 7, 1));

  it('says the team starts later instead of demanding a fix', () => {
    const r = explain(AUGUST);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('notStarted');
    expect(r!.people).toHaveLength(5);
  });

  it('names everyone, so the manager can see the date they start', () => {
    const r = explain(AUGUST)!;
    expect(r.people.map((p) => p.name)).toEqual([
      'Hugo', 'Adri', 'Aldridge', 'Ethan', 'Uri',
    ]);
    expect(r.people.every((p) => p.reason.length > 0)).toBe(true);
  });

  it('applies to a week before the start date too', () => {
    const r = explain(weekDays(new Date(2026, 7, 26)));
    expect(r!.kind).toBe('notStarted');
  });
});

describe('it stays quiet when the calendar is not empty', () => {
  it('says nothing for the month the team actually works', () => {
    // September DOES contain shifts, from the 3rd onward. The first day of the
    // month is still "not started" — asking only that day is what produced the
    // false alarm.
    const september = monthDays(new Date(2026, 8, 1));
    expect(build(september).assignments.length).toBeGreaterThan(0);
    expect(explain(september)).toBeNull();
  });

  it('says nothing for the week that straddles the start date', () => {
    const straddle = weekDays(new Date(2026, 8, 3));
    expect(build(straddle).assignments.length).toBeGreaterThan(0);
    expect(explain(straddle)).toBeNull();
  });
});

describe('a real obstacle still reads as one', () => {
  it('reports a blocked roster when nobody has a contract', () => {
    const noContract = TEAM.map((e) =>
      employee({ ...e, hire_date: '2020-01-01', current_contract: null }),
    );
    const september = monthDays(new Date(2026, 8, 1));
    const result = generateSchedule(noContract, TEMPLATES, [], [], SHOP, september);
    const r = explainEmptyCalendar(result, SHOP, september, noContract, [], []);

    expect(r).not.toBeNull();
    expect(r!.kind).toBe('blocked');
  });

  it('reports a blocked roster when everyone resigned', () => {
    const gone = TEAM.map((e) =>
      employee({ ...e, hire_date: '2020-01-01', employment_status: 'resigned' }),
    );
    const september = monthDays(new Date(2026, 8, 1));
    const result = generateSchedule(gone, TEMPLATES, [], [], SHOP, september);
    expect(explainEmptyCalendar(result, SHOP, september, gone, [], [])!.kind).toBe(
      'blocked',
    );
  });

  it('does not blame a roster where one person could have worked', () => {
    // One person is fine; the calendar being empty is not about who is
    // available, so naming the others would send the manager after the wrong
    // thing entirely.
    const mixed = [
      employee({ full_name: 'Ana', hire_date: '2020-01-01' }),
      ...TEAM,
    ];
    const august = monthDays(new Date(2026, 7, 1));
    // Force an empty result while Ana is perfectly available.
    const empty: ScheduleResult = {
      assignments: [], gaps: [], totalCost: 0, totalHours: 0,
      overtimeHours: 0, hoursByEmployee: {}, belowMinimum: [],
    };
    expect(explainEmptyCalendar(empty, SHOP, august, mixed, [], [])).toBeNull();
  });
});

describe('it stays quiet when it has nothing to say', () => {
  it('says nothing before anything has been generated', () => {
    expect(explainEmptyCalendar(null, SHOP, days('2026-08-03', 7), TEAM, [], [])).toBeNull();
  });

  it('says nothing when the roster is empty', () => {
    const empty: ScheduleResult = {
      assignments: [], gaps: [], totalCost: 0, totalHours: 0,
      overtimeHours: 0, hoursByEmployee: {}, belowMinimum: [],
    };
    expect(explainEmptyCalendar(empty, SHOP, days('2026-08-03', 7), [], [], [])).toBeNull();
  });

  it('says nothing when every day of the period is closed', () => {
    const closed = spec({ ...SHOP, closedWeekdays: [0, 1, 2, 3, 4, 5, 6] });
    const week = days('2026-08-03', 7);
    const empty: ScheduleResult = {
      assignments: [], gaps: [], totalCost: 0, totalHours: 0,
      overtimeHours: 0, hoursByEmployee: {}, belowMinimum: [],
    };
    expect(explainEmptyCalendar(empty, closed, week, TEAM, [], [])).toBeNull();
  });

  it('treats an approved absence as a real obstacle, not a start date', () => {
    const type = absenceType();
    const off = TEAM.map((e) => employee({ ...e, hire_date: '2020-01-01' }));
    const week = days('2026-09-07', 7);
    const outs = off.map((e) =>
      absence({
        employee_id: e.id,
        absence_type_id: type.id,
        status: 'approved',
        start_at: '2026-09-06T00:00:00Z',
        end_at: '2026-09-14T00:00:00Z',
      }),
    );
    const empty: ScheduleResult = {
      assignments: [], gaps: [], totalCost: 0, totalHours: 0,
      overtimeHours: 0, hoursByEmployee: {}, belowMinimum: [],
    };
    const r = explainEmptyCalendar(empty, SHOP, week, off, outs, [type]);
    expect(r!.kind).toBe('blocked');
  });
});
