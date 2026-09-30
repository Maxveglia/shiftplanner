import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  composeRosterAnswer,
  emptyEntry,
  entriesFor,
  namedEntries,
  parseHours,
  type RosterEntry,
} from './roster';

function entry(name: string, weeklyHours: RosterEntry['weeklyHours']): RosterEntry {
  return { ...emptyEntry(), name, weeklyHours };
}

describe('parseHours', () => {
  it('reads a number, a decimal comma included', () => {
    expect(parseHours('40')).toBe(40);
    expect(parseHours('37,5')).toBe(37.5);
    expect(parseHours(' 20 ')).toBe(20);
  });

  it('keeps "nobody said" apart from a figure', () => {
    // An empty box is not a contract for zero hours: the second is a rule the
    // calendar would then defend, and no manager typed it.
    expect(parseHours('')).toBeNull();
    expect(parseHours('0')).toBeNull();
    expect(parseHours('nope')).toBeNull();
    expect(parseHours('200')).toBeNull();
  });
});

describe('namedEntries', () => {
  it('drops the rows nobody filled in', () => {
    expect(namedEntries([entry('Ana', 40), entry('  ', null), emptyEntry()])).toHaveLength(1);
  });
});

describe('composeRosterAnswer', () => {
  it('says nothing when nobody was named', () => {
    expect(composeRosterAnswer([emptyEntry()])).toBe('');
  });

  it('names each person with their hours, in the manager language', () => {
    setLanguage('es');
    const said = composeRosterAnswer([entry('Ana', 40), entry('Luis', 20)]);
    expect(said).toContain('Ana 40 h');
    expect(said).toContain('Luis 20 h');
    expect(said).toContain('2');
  });

  it('says out loud that somebody has no fixed hours', () => {
    setLanguage('es');
    const said = composeRosterAnswer([entry('Marta', 'none')]);
    expect(said).toContain('Marta');
    expect(said.toLowerCase()).toContain('sin horas fijas');
  });

  it('never turns an untouched row into a claim about that person', () => {
    // A row nobody got to is not somebody without a contract. Saying the
    // second would put a fact in the brief that the manager never stated.
    setLanguage('es');
    const said = composeRosterAnswer([entry('Jon', null)]);
    expect(said).toContain('Jon');
    expect(said.toLowerCase()).not.toContain('sin horas fijas');
    expect(said.toLowerCase()).toContain('sin concretar');
  });

  it('speaks English to an English manager', () => {
    setLanguage('en');
    const said = composeRosterAnswer([entry('Ana', 40)]);
    expect(said).toContain('Ana 40 h');
    expect(said.toLowerCase()).toContain('contract');
    setLanguage('es');
  });

  it('writes half an hour the way the manager writes one', () => {
    // The sentence goes up as the manager's own message. An English manager
    // who picked a 37.5-hour contract used to read themselves saying "37,5",
    // because the decimal mark was a literal comma rather than part of the
    // language.
    setLanguage('en');
    expect(composeRosterAnswer([entry('Ana', 37.5)])).toContain('Ana 37.5 h');
    setLanguage('es');
    expect(composeRosterAnswer([entry('Ana', 37.5)])).toContain('Ana 37,5 h');
  });
});

describe('entriesFor', () => {
  it('opens with a row for each person the manager counted', () => {
    expect(entriesFor(6)).toHaveLength(6);
    expect(entriesFor(1)).toHaveLength(1);
  });

  it('never opens with nothing to type into', () => {
    // No headcount, or one nobody gave: a single empty row, not zero.
    expect(entriesFor(null)).toHaveLength(1);
    expect(entriesFor(0)).toHaveLength(1);
    expect(entriesFor(-3)).toHaveLength(1);
  });

  it('gives every row its own identity', () => {
    const ids = entriesFor(4).map((e) => e.id);
    expect(new Set(ids).size).toBe(4);
  });
});
