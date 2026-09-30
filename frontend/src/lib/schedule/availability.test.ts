// `availability` is the single source of truth for "can this person work this
// day". The generator calls it to DECIDE and the grid calls it to EXPLAIN, so a
// wrong answer here is both a wrong calendar and a wrong reason next to it.
//
// The assertions below are on `kind`, never on `reason`. `reason` is a sentence
// written for a human and it changes with the interface language; `kind` is the
// value the code is allowed to branch on. Testing the sentence would rebuild
// exactly the bug the two-field split was introduced to kill.

import { describe, expect, it } from 'vitest';
import { ONBOARDING_MAX_HOURS, availability, contractedMinHours } from './availability';
import { getLanguage, setLanguage, type Language } from '../i18n/core';
import { absence, absenceType, contract, employee } from '../../test/factories';

const DAY = '2026-03-10';
const VACATION = absenceType({ id: 'vac', name: 'Vacation' });
const TYPES = [VACATION];

describe('availability — employment status', () => {
  it('never schedules someone who has resigned', () => {
    const result = availability(
      employee({ employment_status: 'resigned' }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.kind).toBe('resigned');
  });

  it('reads a resignation as settled fact even with no contract on file', () => {
    // Order matters for the grid: a resigned person is administratively gone,
    // and saying "no contract" instead would put the manager on a hunt for a
    // contract that is missing for a perfectly good reason.
    const result = availability(
      employee({ employment_status: 'resigned', current_contract: null }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok === false && result.kind).toBe('resigned');
  });

  it('holds back anyone on leave for the whole of their leave', () => {
    const result = availability(
      employee({ employment_status: 'on_leave' }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok === false && result.kind).toBe('on_leave');
  });
});

describe('availability — dates that have not arrived yet', () => {
  it('does not schedule anyone before their first day', () => {
    const result = availability(
      employee({ hire_date: '2026-04-01' }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok === false && result.kind).toBe('not_started');
  });

  it('schedules someone on their first day, not the day after', () => {
    // The hire date is inclusive: a shop that hires for Monday means Monday.
    const result = availability(employee({ hire_date: DAY }), [], TYPES, DAY);
    expect(result.ok).toBe(true);
  });
});

describe('availability — the contract has to exist and cover the day', () => {
  it('refuses anyone with no contract at all', () => {
    // This is the refusal the roster bug ran into on every day of the month.
    const result = availability(
      employee({ current_contract: null }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok === false && result.kind).toBe('contract');
  });

  it('refuses a day before the contract starts', () => {
    const result = availability(
      employee({ current_contract: contract({ valid_from: '2026-04-01' }) }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok === false && result.kind).toBe('contract');
  });

  it('refuses a day after the contract ended', () => {
    const result = availability(
      employee({ current_contract: contract({ valid_to: '2026-02-28' }) }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok === false && result.kind).toBe('contract');
  });

  it('still works the last day of a contract that ends today', () => {
    const result = availability(
      employee({ current_contract: contract({ valid_to: DAY }) }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok).toBe(true);
  });
});

describe('availability — absences', () => {
  it('blocks the day outright once time off is approved', () => {
    const emp = employee();
    const result = availability(
      emp,
      [absence({ employee_id: emp.id, absence_type_id: VACATION.id })],
      TYPES,
      DAY,
    );
    expect(result.ok === false && result.kind).toBe('absence');
  });

  it('only warns about time off that nobody has answered yet', () => {
    // A pending request must not silently vanish from the manager's view, and
    // it must not silently take the person off the rota either: the generator
    // schedules around it when it can, and says so when it cannot.
    const emp = employee();
    const result = availability(
      emp,
      [absence({ employee_id: emp.id, absence_type_id: VACATION.id, status: 'requested' })],
      TYPES,
      DAY,
    );
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.pendingAbsence).toBe(true);
    expect(result.ok === true && result.note).not.toBeNull();
  });

  it('flags a pending request identically in every language', () => {
    // The generator used to detect these with `note.includes('requested')` —
    // reading a sentence written for a human. Translated into Spanish that test
    // stopped matching and the penalty vanished with no error: the same team,
    // the same week, a different calendar depending on the interface language.
    const emp = employee();
    const absences = [
      absence({ employee_id: emp.id, absence_type_id: VACATION.id, status: 'requested' }),
    ];
    const seen = new Map<Language, { pending: boolean; note: string | null }>();
    const before = getLanguage();
    try {
      for (const lang of ['en', 'es'] as Language[]) {
        setLanguage(lang);
        const r = availability(emp, absences, TYPES, DAY);
        seen.set(lang, {
          pending: r.ok === true && r.pendingAbsence,
          note: r.ok === true ? r.note : null,
        });
      }
    } finally {
      setLanguage(before);
    }

    expect(seen.get('en')?.pending).toBe(true);
    expect(seen.get('es')?.pending).toBe(true);
    // The human-facing sentence really does differ, which is what makes reading
    // it a trap and the flag the only safe thing to branch on.
    expect(seen.get('en')?.note).not.toBe(seen.get('es')?.note);
  });

  it('ignores a rejected or cancelled request entirely', () => {
    const emp = employee();
    const result = availability(
      emp,
      [
        absence({ employee_id: emp.id, absence_type_id: VACATION.id, status: 'rejected' }),
        absence({ employee_id: emp.id, absence_type_id: VACATION.id, status: 'cancelled' }),
      ],
      TYPES,
      DAY,
    );
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.pendingAbsence).toBe(false);
  });

  it('never applies one person’s holiday to another', () => {
    const emp = employee();
    const result = availability(
      emp,
      [absence({ employee_id: 'somebody-else', absence_type_id: VACATION.id })],
      TYPES,
      DAY,
    );
    expect(result.ok).toBe(true);
  });

  it('leaves a day untouched when the absence falls entirely outside it', () => {
    const emp = employee();
    const result = availability(
      emp,
      [
        absence({
          employee_id: emp.id,
          absence_type_id: VACATION.id,
          start_at: '2026-03-12T00:00:00',
          end_at: '2026-03-13T23:59:00',
        }),
      ],
      TYPES,
      DAY,
    );
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.pendingAbsence).toBe(false);
  });
});

describe('availability — the onboarding ramp-up', () => {
  it('caps a new starter’s day and keeps them off nights', () => {
    const result = availability(
      employee({ employment_status: 'onboarding' }),
      [],
      TYPES,
      DAY,
    );
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.maxHoursToday).toBe(ONBOARDING_MAX_HOURS);
    expect(result.ok === true && result.nightsAllowed).toBe(false);
    // The ramp-up is shown on the row, so the manager knows why the shifts
    // offered to this person are shorter than everyone else's.
    expect(result.ok === true && result.note).not.toBeNull();
  });

  it('puts no limits at all on a settled employee', () => {
    const result = availability(employee(), [], TYPES, DAY);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.maxHoursToday).toBeNull();
    expect(result.ok === true && result.nightsAllowed).toBe(true);
    expect(result.ok === true && result.note).toBeNull();
  });
});

describe('contractedMinHours', () => {
  it('treats a missing contract as promising nothing rather than as zero hours owed', () => {
    expect(contractedMinHours(employee({ current_contract: null }))).toBe(0);
  });

  it('reads the weekly floor the contract commits to', () => {
    expect(
      contractedMinHours(
        employee({ current_contract: contract({ min_hours_per_week: 20 }) }),
      ),
    ).toBe(20);
  });
});
