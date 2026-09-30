// Reading a stretch of days out of a sentence, offline.
//
// This is the fallback parser — what the adjustment bar falls back to with no
// key and no network. It matters more than its usage suggests, because the
// failure it replaces is silent: "Juanito cannot work from the 15th to the
// 22nd" used to become a day off on the 15th, and a manager reading "Juanito
// is off on the 15th" has no way to tell that the other seven days were never
// heard.
//
// The rule it must not break is the opposite one: "de 9 a 5" is a working day.
// A parser that read every "de X a Y" as dates would clear four weeks because
// somebody described an afternoon, so the article is required and a loose
// phrasing falls through to the single-date reading Claude handles properly.

import { describe, expect, it } from 'vitest';
import { parseRefinement } from './refine';
import { days, employee } from '../../test/factories';

const MARCH = days('2026-03-01', 31);
const ROSTER = [
  employee({ id: 'e1', full_name: 'Juanito Pérez' }),
  employee({ id: 'e2', full_name: 'Sarah Chen' }),
];

describe('parseRefinement — a stretch of days', () => {
  it('reads "del 15 al 22" as one day_off over the whole week', () => {
    expect(parseRefinement('Juanito libre del 15 al 22', ROSTER, MARCH)).toEqual([
      {
        op: 'day_off',
        employee: 'Juanito Pérez',
        date: '2026-03-15',
        dateTo: '2026-03-22',
      },
    ]);
  });

  it('reads the English and the long Spanish forms the same way', () => {
    const expected = [
      {
        op: 'day_off',
        employee: 'Juanito Pérez',
        date: '2026-03-15',
        dateTo: '2026-03-22',
      },
    ];
    for (const sentence of [
      'Juanito is off from the 15th to the 22nd',
      'Juanito no trabaja desde el 15 hasta el 22',
      'Juanito libre entre el 15 y el 22',
    ]) {
      expect(parseRefinement(sentence, ROSTER, MARCH)).toEqual(expected);
    }
  });

  it('crosses a month boundary forwards, never backwards', () => {
    // "del 28 al 3" is the end of one month and the start of the next. Read as
    // "the 28th to the 3rd" literally, it is a range that matches nothing.
    const horizon = days('2026-03-20', 21); // 20 March - 9 April
    expect(parseRefinement('Juanito libre del 28 al 3', ROSTER, horizon)).toEqual([
      {
        op: 'day_off',
        employee: 'Juanito Pérez',
        date: '2026-03-28',
        dateTo: '2026-04-03',
      },
    ]);
  });

  it('does not read a pair of hours as a pair of dates', () => {
    // The whole reason the article is required. "Quita a Sarah de 9 a 5" is
    // about an afternoon; reading it as the 9th to the 5th would clear three
    // weeks because somebody described a shift.
    //
    // Naming no day at all is the RIGHT answer here and was the answer before
    // this parser learned about ranges: with no date and no weekday there is
    // nothing to remove, and the sentence goes to Claude. What must never
    // happen is the other thing — a range appearing out of two hours.
    for (const sentence of [
      'quita a Sarah de 9 a 5',
      'Sarah libre de 9 a 5',
      'pon a Sarah de 9 a 5 el 18',
    ]) {
      for (const op of parseRefinement(sentence, ROSTER, MARCH)) {
        expect((op as { dateTo?: string }).dateTo).toBeUndefined();
      }
    }
  });

  it('still reads a single day when no range is given', () => {
    expect(parseRefinement('Juanito libre el 18', ROSTER, MARCH)).toEqual([
      { op: 'day_off', employee: 'Juanito Pérez', date: '2026-03-18' },
    ]);
  });

  it('applies the range to a removal as well as to a day off', () => {
    expect(
      parseRefinement('quita a Juanito del 15 al 22', ROSTER, MARCH),
    ).toEqual([
      {
        op: 'remove_shifts',
        employee: 'Juanito Pérez',
        date: '2026-03-15',
        dateTo: '2026-03-22',
      },
    ]);
  });
});
