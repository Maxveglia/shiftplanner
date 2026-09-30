// Turning "Juanito está enfermo" into a row the business can pay from.
//
// The rule under test is the one that must never bend: WHEN IN DOUBT, NOTHING
// IS WRITTEN. Whether a week off is paid, whether it comes out of a holiday
// balance and whether the hours come back are facts about a contract and a
// country's law, and the sentence usually does not carry them. Every guess
// this module declines to make is a question the manager gets asked instead —
// and every guess it did make would be a payslip that is wrong for a month
// before anybody notices, because the calendar looks identical either way.

import { describe, expect, it } from 'vitest';
import {
  absenceBounds,
  consequenceOf,
  toAbsenceKind,
  typeForKind,
} from './absenceKind';
import { toAbsenceRequest } from './ops';
import { absenceType } from '../../test/factories';

const SEEDED = [
  absenceType({ id: 'vac', code: 'VAC', name: 'Vacation' }),
  absenceType({ id: 'sick', code: 'SICK', name: 'Sick', is_paid: true, consumes_balance: false }),
  absenceType({ id: 'pers', code: 'PERS', name: 'Personal', is_paid: false, consumes_balance: false }),
  absenceType({ id: 'unpaid', code: 'UNPAID', name: 'Unpaid', is_paid: false, consumes_balance: false }),
];

describe('reading the kind of leave', () => {
  it('takes the four it knows and calls everything else unknown', () => {
    expect(toAbsenceKind('sick')).toBe('sick');
    expect(toAbsenceKind('VACATION')).toBe('vacation');
    expect(toAbsenceKind(' unpaid ')).toBe('unpaid');
    for (const nonsense of ['maternity', '', null, undefined, 42, 'baja']) {
      expect(toAbsenceKind(nonsense)).toBe('unknown');
    }
  });

  it('resolves each kind against the org’s own types, by code', () => {
    expect(typeForKind('sick', SEEDED)?.id).toBe('sick');
    expect(typeForKind('vacation', SEEDED)?.id).toBe('vac');
    expect(typeForKind('personal', SEEDED)?.id).toBe('pers');
    expect(typeForKind('unpaid', SEEDED)?.id).toBe('unpaid');
  });

  it('matches on the code, not the name a manager may have rewritten', () => {
    const renamed = [absenceType({ id: 'x', code: 'SICK', name: 'Baja médica' })];
    expect(typeForKind('sick', renamed)?.id).toBe('x');
  });

  it('asks rather than guessing when the sentence said nothing', () => {
    expect(typeForKind('unknown', SEEDED)).toBeNull();
  });

  it('asks rather than filing an illness as a holiday', () => {
    // A business that deleted "Sick" is telling us the word means nothing
    // here. Picking the nearest survivor would be inventing an answer to the
    // one question this module exists to refuse to answer.
    const noSick = SEEDED.filter((t) => t.code !== 'SICK');
    expect(typeForKind('sick', noSick)).toBeNull();
  });

  it('falls back from unpaid leave to Personal, which is also unpaid', () => {
    const noUnpaid = SEEDED.filter((t) => t.code !== 'UNPAID');
    expect(typeForKind('unpaid', noUnpaid)?.id).toBe('pers');
  });

  it('reports the consequence off the row, not off the name', () => {
    // A business whose sick leave DOES come off the holiday balance has to see
    // that in the question. The label says "Sick" in both set-ups.
    const strict = absenceType({ code: 'SICK', is_paid: false, consumes_balance: true });
    expect(consequenceOf(strict)).toEqual({
      paid: false,
      consumesBalance: true,
      recoverable: false,
    });
  });
});

describe('the days an absence covers', () => {
  it('ends one second before midnight, not at it', () => {
    // `availability()` keeps an absence whose end is not before the day
    // starts. An end of "the 23rd at 00:00" still overlaps the 23rd, so a
    // week off would block eight days — and the eighth is a day the manager
    // never mentioned, on a calendar that looks perfectly reasonable.
    const [from, to] = absenceBounds('2026-10-15', '2026-10-22');
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(to).getDate()).toBe(22);
    expect(new Date(to).getHours()).toBe(23);
    expect(new Date(to).getMinutes()).toBe(59);
  });

  it('covers a single day from its first minute to its last', () => {
    const [from, to] = absenceBounds('2026-10-18', '2026-10-18');
    expect(new Date(from).getDate()).toBe(18);
    expect(new Date(to).getDate()).toBe(18);
    expect(new Date(to) > new Date(from)).toBe(true);
  });
});

describe('reading an absence out of the model’s operation', () => {
  it('reads a range', () => {
    expect(
      toAbsenceRequest({
        op: 'add_absence',
        employee: 'Juanito',
        date: '2026-10-15',
        date_to: '2026-10-22',
        absence_kind: 'sick',
      }),
    ).toEqual({
      employee: 'Juanito',
      from: '2026-10-15',
      to: '2026-10-22',
      kind: 'sick',
    });
  });

  it('reads a single day as a range of one', () => {
    expect(
      toAbsenceRequest({ op: 'add_absence', employee: 'Juanito', date: '2026-10-18' }),
    ).toEqual({
      employee: 'Juanito',
      from: '2026-10-18',
      to: '2026-10-18',
      kind: 'unknown',
    });
  });

  it('puts a backwards range the right way round', () => {
    const request = toAbsenceRequest({
      op: 'add_absence',
      employee: 'Juanito',
      date: '2026-10-22',
      date_to: '2026-10-15',
    });
    expect([request?.from, request?.to]).toEqual(['2026-10-15', '2026-10-22']);
  });

  it('refuses an operation missing who or when', () => {
    expect(toAbsenceRequest({ op: 'add_absence', date: '2026-10-18' })).toBeNull();
    expect(toAbsenceRequest({ op: 'add_absence', employee: 'Juanito' })).toBeNull();
    expect(
      toAbsenceRequest({ op: 'add_absence', employee: 'Juanito', date: 'next week' }),
    ).toBeNull();
  });

  it('ignores an operation that is not an absence at all', () => {
    expect(toAbsenceRequest({ op: 'day_off', employee: 'Juanito', date: '2026-10-18' }))
      .toBeNull();
  });

  it('is not clipped to the calendar on screen', () => {
    // A manager saying in September that Ana is away in December is telling us
    // a fact, not editing this draft. Dropping it for being off-horizon would
    // lose it with nothing on screen to show for it.
    const request = toAbsenceRequest({
      op: 'add_absence',
      employee: 'Ana',
      date: '2027-12-24',
      date_to: '2027-12-31',
      absence_kind: 'vacation',
    });
    expect(request?.from).toBe('2027-12-24');
  });
});
