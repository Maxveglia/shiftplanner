import { describe, expect, it } from 'vitest';
import { monthsNamedIn } from './namedMonth';

// A year on screen, which is where this went wrong.
const YEAR = Array.from({ length: 12 }, (_, i) =>
  `2026-${String(i + 1).padStart(2, '0')}`,
);
const AUTUMN = ['2026-09', '2026-10', '2026-11'];

describe('monthsNamedIn', () => {
  it('reads the sentence that started this', () => {
    expect(monthsNamedIn('rehazme el calendario de octubre', YEAR)).toEqual(['2026-10']);
  });

  it('reads it in English too, whatever the interface is set to', () => {
    expect(monthsNamedIn('redo October for me', YEAR)).toEqual(['2026-10']);
  });

  it('survives the accents a manager may not type', () => {
    expect(monthsNamedIn('cambia los viernes de MARZO', YEAR)).toEqual(['2026-03']);
  });

  it('takes more than one month when more than one is named', () => {
    expect(monthsNamedIn('rehaz octubre y noviembre', AUTUMN)).toEqual([
      '2026-10',
      '2026-11',
    ]);
  });

  it('says nothing when no month is named', () => {
    // The case that must keep working exactly as it did: the manager's choice
    // in the bar decides, and nothing here overrides it.
    expect(monthsNamedIn('alterna los fines de semana', YEAR)).toEqual([]);
    expect(monthsNamedIn('dale más viernes a Ana', YEAR)).toEqual([]);
  });

  it('ignores a month the calendar does not cover', () => {
    expect(monthsNamedIn('rehaz enero', AUTUMN)).toEqual([]);
  });

  it('binds a year said next to the month', () => {
    const two = ['2026-10', '2027-10'];
    expect(monthsNamedIn('octubre de 2027', two)).toEqual(['2027-10']);
    expect(monthsNamedIn('October 2027', two)).toEqual(['2027-10']);
  });

  it('takes the first of that name when no year is said', () => {
    expect(monthsNamedIn('octubre', ['2026-10', '2027-10'])).toEqual(['2026-10']);
  });

  it('reads a month key typed back in', () => {
    expect(monthsNamedIn('rehaz 2026-11 entero', YEAR)).toEqual(['2026-11']);
  });

  it('does not find a month inside an ordinary word', () => {
    // "mayo" lives inside "mayoría"; "may" inside "maybe".
    expect(monthsNamedIn('la mayoría de los turnos', YEAR)).toEqual([]);
    expect(monthsNamedIn('maybe move the weekend', YEAR)).toEqual([]);
  });
});
