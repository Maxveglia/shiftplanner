// What we send, and more importantly what we do not.
//
// The privacy tests here are the load-bearing ones. A pay rate, an absence
// reason or a NAME leaking into the prompt would not break anything visible:
// the calendar would come back fine, and nobody would find out until somebody
// asked what we send to the model about their staff. That is exactly how
// "Ana Garcia Perez" went out on every generation for months.

import { describe, expect, it } from 'vitest';
import { buildPlanContext } from './planContext';
import { scheduleFromProposal } from './fromProposal';
import {
  absence,
  absenceType,
  contract,
  days,
  employee,
  spec,
  template,
} from '../../test/factories';

const WEEK = days('2026-03-01', 7);
const MEDICAL = absenceType({ id: 'sick', name: 'Baja médica', is_health_data: true });

function build(over: Parameters<typeof buildPlanContext> | null = null) {
  void over;
  return buildPlanContext(
    [
      employee({
        id: 'emp-uuid-1',
        full_name: 'Ana',
        current_contract: contract({
          employee_id: 'emp-uuid-1',
          hourly_rate: 37.5,
          max_hours_per_week: 20,
        }),
      }),
    ],
    [template({ id: 'tpl1', name: 'Apertura' })],
    [
      absence({
        employee_id: 'emp-uuid-1',
        absence_type_id: 'sick',
        start_at: '2026-03-03T00:00:00',
        end_at: '2026-03-03T23:59:00',
      }),
    ],
    [MEDICAL],
    spec({ minStaff: 2, openMin: 9 * 60, closeMin: 21 * 60 }),
    WEEK,
    'ES',
  );
}

describe('what the model must not see', () => {
  it('never sends a pay rate', () => {
    const text = build();
    expect(text).not.toContain('37.5');
    expect(text.toLowerCase()).not.toContain('rate');
    expect(text.toLowerCase()).not.toContain('salary');
  });

  it('never sends the reason somebody is away', () => {
    const text = build();
    expect(text).toContain('2026-03-03'); // the DAY is needed
    expect(text).not.toContain('Baja médica'); // the REASON is not
    expect(text.toLowerCase()).not.toContain('sick');
  });
});

describe('no name of ours leaves the browser', () => {
  it('never writes a name into the team listing', () => {
    const text = buildPlanContext(
      [
        employee({ id: 'emp-uuid-1', full_name: 'Ana García Pérez' }),
        employee({ id: 'emp-uuid-2', full_name: 'Luis Moreno' }),
      ],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
    );
    expect(text).not.toContain('Ana');
    expect(text).not.toContain('García');
    expect(text).not.toContain('Luis');
    expect(text).not.toContain('Moreno');
    // And the person is still there, under the only handle the model answers
    // in. Dropping the name must not drop the row.
    expect(text).toContain('emp-uuid-1');
    expect(text).toContain('emp-uuid-2');
  });

  it('never writes one into the calendar it asks to be rebuilt', () => {
    const text = buildPlanContext(
      [employee({ id: 'emp-uuid-1', full_name: 'Ana García Pérez' })],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
      new Date('2026-03-01T12:00:00'),
      {
        current: [
          {
            id: 'a1',
            employeeId: 'emp-uuid-1',
            date: '2026-03-02',
            startMin: 9 * 60,
            endMin: 17 * 60,
            templateId: '',
            templateName: '',
            color: '#2563EB',
            isNight: false,
            paidHours: 8,
            overtimeHours: 0,
            extraHours: 0,
            cost: 0,
            source: 'ai' as const,
          },
        ],
        instruction: 'libra los viernes',
      },
    );
    expect(text).not.toContain('Ana');
    expect(text).toContain('2026-03-02 | emp-uuid-1 | 09:00-17:00');
  });

  it('gives the manager back a calendar that still knows who is who', () => {
    // The other half of the fix, and the one that decides whether it was worth
    // making: the model is told an id and answers with an id, so the roster
    // join the calendar has always done still resolves every shift to the
    // person whose name the manager expects to read.
    const roster = [
      employee({ id: 'emp-uuid-1', full_name: 'Ana García Pérez' }),
      employee({ id: 'emp-uuid-2', full_name: 'Luis Moreno' }),
    ];
    const sent = buildPlanContext(roster, [], [], [], spec(), WEEK, 'ES');
    expect(sent).not.toContain('Ana');

    const { result } = scheduleFromProposal(
      [
        { employeeId: 'emp-uuid-1', date: '2026-03-02', start: '09:00', end: '15:00' },
        { employeeId: 'emp-uuid-2', date: '2026-03-02', start: '15:00', end: '21:00' },
      ],
      roster,
      [],
      [],
      [],
      spec({ minStaff: 1, openMin: 9 * 60, closeMin: 21 * 60 }),
      WEEK,
    );
    const nameOf = new Map(roster.map((e) => [e.id, e.full_name]));
    const named = result.assignments.map((a) => nameOf.get(a.employeeId));
    expect(named.length).toBeGreaterThan(0);
    expect(named).not.toContain(undefined);
    expect(named).toContain('Ana García Pérez');
  });

  it('leaves the names the MANAGER typed to the server to mask', () => {
    // This file cannot do it: masking "Ana" out of somebody's own sentence
    // needs the roster's spellings and the alias table, and both live on the
    // server (backend/app/services/id_alias.py). What this file guarantees is
    // narrower and stronger -- it never ADDS a name of its own.
    const text = buildPlanContext(
      [employee({ id: 'emp-uuid-1', full_name: 'Ana García Pérez' })],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
      new Date('2026-03-01T12:00:00'),
      undefined,
      'Ana abre siempre.',
    );
    expect(text).toContain('"Ana abre siempre."');
  });
});

describe('what it must see', () => {
  it('names each person by the id it has to return', () => {
    // The model answers with employee_id. An id it was never shown is an id it
    // can only invent, and every invented one is a dropped shift.
    expect(build()).toContain('emp-uuid-1');
  });

  it('states contracted hours', () => {
    expect(build()).toContain('20');
  });

  it('states a contract with a minimum and no maximum as that number, not as a floor', () => {
    // "at least 20" read as an invitation: the model gave 20-hour part-timers
    // a full-timer's week. The contract said twenty; the table says twenty.
    const text = buildPlanContext(
      [
        employee({
          id: 'pt',
          full_name: 'Luis',
          current_contract: contract({
            employee_id: 'pt',
            min_hours_per_week: 20,
            max_hours_per_week: null,
          }),
        }),
        employee({
          id: 'floor',
          full_name: 'Eva',
          current_contract: contract({
            employee_id: 'floor',
            min_hours_per_week: 0,
            max_hours_per_week: 30,
          }),
        }),
      ],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
    );
    expect(text).toMatch(/pt \| \w+ \| 20 \|/);
    expect(text).not.toContain('at least 20');
    expect(text).toMatch(/floor \| \w+ \| up to 30 \|/);
  });

  it('lists the templates it may use', () => {
    const text = build();
    expect(text).toContain('tpl1');
    expect(text).toContain('Apertura');
  });

  it('states the rest rule and the split rule', () => {
    const text = build();
    expect(text).toContain('MINIMUM REST');
    expect(text).toContain('SPLIT SHIFTS: not allowed');
  });

  it('says how many people may split when splits are allowed', () => {
    const text = buildPlanContext(
      [employee({ id: 'e1' })],
      [],
      [],
      [],
      spec({ allowSplitShifts: true, splitShiftPeople: 2 }),
      WEEK,
      'ES',
    );
    expect(text).toContain('at most 2 people');
  });

  it('tells a model with no templates to pick its own times', () => {
    const text = buildPlanContext(
      [employee({ id: 'e1' })],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
    );
    expect(text).toContain('none defined');
  });
});

describe('a long absence does not crowd out the instructions', () => {
  it('summarises rather than listing forty dates', () => {
    const month = days('2026-03-01', 31);
    const text = buildPlanContext(
      [employee({ id: 'e1' })],
      [],
      [
        absence({
          employee_id: 'e1',
          absence_type_id: 'vac',
          start_at: '2026-03-01T00:00:00',
          end_at: '2026-03-31T23:59:00',
        }),
      ],
      [absenceType({ id: 'vac' })],
      spec(),
      month,
      'ES',
    );
    expect(text).toContain('31 days, from 2026-03-01 to 2026-03-31');
  });
});

describe('replanning around an adjustment', () => {
  const shift = {
    id: 'a1',
    employeeId: 'emp-uuid-1',
    date: '2026-03-02',
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 'tpl1',
    templateName: 'Apertura',
    color: '#2563EB',
    isNight: false,
    paidHours: 7.5,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai' as const,
  };

  function withRevision(current = [shift], instruction = 'Ana libra los viernes') {
    return buildPlanContext(
      [employee({ id: 'emp-uuid-1', full_name: 'Ana' })],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
      new Date('2026-03-01T12:00:00'),
      { current, instruction },
    );
  }

  it('shows the calendar as it stands', () => {
    const text = withRevision();
    expect(text).toContain('THE CALENDAR AS IT STANDS');
    expect(text).toContain('2026-03-02 | emp-uuid-1 | 09:00-17:00');
  });

  it("quotes the manager's own words", () => {
    expect(withRevision()).toContain('"Ana libra los viernes"');
  });

  it('allows moving other people but asks for no churn', () => {
    // Both halves matter. Told only to change what was asked, it cannot satisfy
    // a request that needs three moves; told nothing, it reshuffles a month the
    // manager had already read and accepted.
    const text = withRevision();
    expect(text).toContain('Change whatever you need');
    expect(text).toContain('should\nnot move');
  });

  it('says so plainly when there is nothing planned yet', () => {
    expect(withRevision([])).toContain('(empty)');
  });

  it('omits all of this on a first build', () => {
    expect(build()).not.toContain('THE CALENDAR AS IT STANDS');
  });
});

describe("the manager's own words", () => {
  const BRIEF = 'Somos una cafetería. Laura abre siempre y Ana nunca coincide con Luis.';

  function withWords(brief?: string, notes?: string[]) {
    return buildPlanContext(
      [employee({ id: 'emp-uuid-1', full_name: 'Ana' })],
      [],
      [],
      [],
      { ...spec(), notes },
      WEEK,
      'ES',
      new Date('2026-03-01T12:00:00'),
      undefined,
      brief,
    );
  }

  it('quotes the brief whole on a first build', () => {
    // The requirements above it are what a closed schema could hold. "Ana
    // never with Luis" has no field; the only place it survives is here.
    const text = withWords(BRIEF);
    expect(text).toContain("WHAT THE MANAGER ASKED FOR, IN THEIR OWN WORDS:");
    expect(text).toContain(`"${BRIEF}"`);
  });

  it('lists what the intake noted but could not turn into a rule', () => {
    const text = withWords(BRIEF, ['Ana nunca coincide con Luis']);
    expect(text).toContain('had no field in the requirements above');
    expect(text).toContain('  - Ana nunca coincide con Luis');
  });

  it('sends the words and leaves what to do with them to the system prompt', () => {
    // The instruction ("deliver every request in them, within the rules")
    // lives once, on the server, in `calendar_plan.SYSTEM_PROMPT`. Written
    // here as well it was two copies of the same sentence, free to drift.
    const text = withWords(BRIEF);
    expect(text).not.toContain('Deliver every request');
    expect(text).not.toContain('the words win');
  });

  it('still labels the notes when the brief itself is gone', () => {
    // A draft can outlive the brief that made it. "Of that, these points…"
    // with nothing above it to be "that" read as a bug.
    const text = withWords(undefined, ['Ana nunca coincide con Luis']);
    expect(text).not.toContain('Of that');
    expect(text).toContain('IT HAD NO FIELD IN THE REQUIREMENTS ABOVE');
    expect(text).toContain('  - Ana nunca coincide con Luis');
  });

  it('says nothing of the sort when there are no words', () => {
    expect(withWords(undefined, [])).not.toContain('NO FIELD');
    expect(withWords('   ')).not.toContain('IN THEIR OWN WORDS');
  });

  it('keeps the words before the adjustment, so the adjustment is read last', () => {
    const text = buildPlanContext(
      [employee({ id: 'emp-uuid-1', full_name: 'Ana' })],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
      new Date('2026-03-01T12:00:00'),
      { current: [], instruction: 'Ana libra los viernes' },
      BRIEF,
    );
    expect(text.indexOf('IN THEIR OWN WORDS')).toBeLessThan(
      text.indexOf('WHAT THE MANAGER JUST ASKED FOR'),
    );
  });
});

describe('what the last change cost, told to the planner', () => {
  const BRIEF = 'Somos una cafetería.';

  // The planner is asked to repair damage only when there is damage, and the
  // distinction this block defends is the one that decides whether the repair
  // helps or undoes the request: an instruction is a REQUIREMENT, damage is a
  // CONSEQUENCE. Folded together, "Juanito is off that week, 12 hours
  // uncovered" reads as an argument for putting Juanito back on the rota.
  const withDamage = (damage?: string[]) =>
    buildPlanContext(
      [employee({ id: 'emp-uuid-1', full_name: 'Ana' })],
      [],
      [],
      [],
      spec(),
      WEEK,
      'ES',
      new Date('2026-03-01T12:00:00'),
      { current: [], instruction: 'Juanito no puede del 15 al 22', damage },
      BRIEF,
    );

  it('keeps the request standing while the damage is repaired around it', () => {
    const text = withDamage([
      '',
      'WHAT THE LAST CHANGE COST, AND WHAT NEEDS REPAIRING:',
      '  12 person-hour(s) of cover were lost on 2026-03-03.',
    ]);

    expect(text).toContain('12 person-hour(s)');
    expect(text).toContain('That request STANDS');
    // The request is still there, and still first: the damage is read as a
    // consequence of something already decided.
    expect(text.indexOf('Juanito no puede del 15 al 22')).toBeLessThan(
      text.indexOf('WHAT THE LAST CHANGE COST'),
    );
  });

  it('makes the contract the target rather than the hole', () => {
    // A repair that covers the shop by overloading whoever is free is the
    // failure mode here, so what the contracted hours are FOR is said at the
    // point the repair is asked for.
    const text = withDamage(['', 'WHAT THE LAST CHANGE COST:', '  Ana lost 8 h.']);
    expect(text).toContain('contracted hours');
    expect(text).toContain('pushing somebody else below theirs');
  });

  it('says none of it when the change cost nothing', () => {
    expect(withDamage()).not.toContain('That request STANDS');
    expect(withDamage([])).not.toContain('WHAT THE LAST CHANGE COST');
  });
});
