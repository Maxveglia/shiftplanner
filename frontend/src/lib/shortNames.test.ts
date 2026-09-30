import { describe, expect, it } from 'vitest';
import { shortNames } from './shortNames';

describe('shortNames', () => {
  it('keeps the shortest form when nobody collides', () => {
    expect(shortNames(['Ana García López', 'adam', 'max'])).toEqual(['Ana G.', 'adam', 'max']);
  });

  it('tells the three new hires apart', () => {
    // From a screenshot: three rows of "Nueva i." in the planner's column.
    expect(
      shortNames(['Nueva incorporación 1', 'Nueva incorporación 2', 'Nueva incorporación 3']),
    ).toEqual(['Nueva i. 1', 'Nueva i. 2', 'Nueva i. 3']);
  });

  it('grows only the names that collide', () => {
    expect(shortNames(['Ana García López', 'Ana García Pérez', 'Luis Mora'])).toEqual([
      'Ana G. L.',
      'Ana G. P.',
      'Luis M.',
    ]);
  });

  it('falls back to the full name when the initials still collide', () => {
    expect(shortNames(['Ana García Lara', 'Ana García López'])).toEqual([
      'Ana García Lara',
      'Ana García López',
    ]);
  });

  it('leaves two identical names identical rather than inventing a difference', () => {
    expect(shortNames(['max', 'max'])).toEqual(['max', 'max']);
    expect(shortNames(['Ana Ruiz', 'Ana Ruiz'])).toEqual(['Ana Ruiz', 'Ana Ruiz']);
  });

  it('sees a collision the way a reader does: accents and capitals', () => {
    // The same "José" typed precomposed and decomposed, and a lower-case
    // name beside a capitalised one: two strings, one name on screen.
    // Both are two words, so once "José G." collides the only longer form
    // left is the full name.
    const nfc = 'Jos\u00e9 Garc\u00eda';
    const nfd = 'Jose\u0301 G\u00f3mez';
    expect(shortNames([nfc, nfd])).toEqual([nfc, nfd]);
    expect(shortNames(['ana Gil', 'Ana García'])).toEqual(['ana Gil', 'Ana García']);
  });

  it('copes with stray spaces and an empty list', () => {
    expect(shortNames(['  Ana   Ruiz '])).toEqual(['Ana R.']);
    expect(shortNames([])).toEqual([]);
  });
});
