import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes the first and the last word', () => {
    expect(initialsOf('Max Veglia')).toBe('MV');
    expect(initialsOf('María de los Ángeles Rodríguez')).toBe('MR');
  });

  it('keeps one letter for one word, and capitalises it', () => {
    expect(initialsOf('lucía')).toBe('L');
  });

  it('does not split an accented or astral letter', () => {
    expect(initialsOf('Ángela Íñiguez')).toBe('ÁÍ');
    expect(initialsOf('𝒜da Lovelace')).toBe('𝒜L');
  });

  it('ignores runs of spaces at either end and between words', () => {
    expect(initialsOf('   Pablo    Sánchez  ')).toBe('PS');
  });

  it('falls back to the email, then to nothing', () => {
    expect(initialsOf('', 'motion@example.com')).toBe('M');
    expect(initialsOf(null, null)).toBe('');
    expect(initialsOf(undefined)).toBe('');
  });
});
