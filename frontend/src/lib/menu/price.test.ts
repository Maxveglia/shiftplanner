import { describe, expect, it } from 'vitest';
import { parsePrice, priceForField } from './price';

describe('parsePrice', () => {
  it.each([
    ['12,50', 12.5],
    ['12.50', 12.5],
    ['12,5', 12.5],
    ['12', 12],
    ['12,', 12],
    [',5', 0.5],
    ['0', 0],
    [' 7,95 ', 7.95],
    ['12 €', 12],
    ['€12,50', 12.5],
    ['$3.20', 3.2],
    ['99999,99', 99999.99],
  ])('%j -> %j', (text, value) => {
    expect(parsePrice(text)).toBe(value);
  });

  it.each([
    [''],
    ['   '],
    [','],
    ['abc'],
    ['-3'],
    ['12,505'],
    // A thousands separator would be misread as decimals: refused, not guessed.
    ['1.250'],
    ['1.250,00'],
    ['12,50,1'],
    ['100000'],
    ['100000,00'],
    ['1e3'],
  ])('%j is not a price', (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});

describe('priceForField', () => {
  it('writes the price back with the language’s decimal mark, and parses to the same number', () => {
    expect(priceForField(12.5, ',')).toBe('12,50');
    expect(priceForField(12.5, '.')).toBe('12.50');
    expect(priceForField(12, ',')).toBe('12');
    expect(priceForField(null, ',')).toBe('');
    for (const value of [0, 0.5, 3.2, 12.05, 99999.99]) {
      expect(parsePrice(priceForField(value, ','))).toBe(value);
      expect(parsePrice(priceForField(value, '.'))).toBe(value);
    }
  });
});
