import { describe, expect, it } from 'vitest';
import { barcodeKey, cleanCode } from './barcodeKey';

// The SAME table as backend/tests (barcode_key): a scan is looked up on the
// phone by the key the server computed, so the two must agree on every row.
const CASES: [string, string | null][] = [
  [' 8410188012345\r\n', '08410188012345'],
  ['036000291452', '00036000291452'],
  ['0036000291452', '00036000291452'],
  ['96385074', '00000096385074'],
  ['12345', '12345'],
  ['ABC-123', 'ABC-123'],
  ['abc-123', 'abc-123'],
  ['  ', null],
  ['4 006381 333931', '04006381333931'],
];

describe('barcodeKey', () => {
  it.each(CASES)('%j -> %j', (code, key) => {
    expect(barcodeKey(code)).toBe(key);
  });

  it('makes a UPC-A, its EAN-13 and its GTIN-14 one code', () => {
    const keys = ['036000291452', '0036000291452', '00036000291452'].map(barcodeKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('strips a scanner tab and control characters anywhere', () => {
    expect(barcodeKey('\t8410188012345\u0000')).toBe('08410188012345');
    expect(barcodeKey('AB\u001dC')).toBe('ABC');
    expect(barcodeKey('﻿96385074')).toBe('00000096385074');
  });

  it('pads only ASCII digits of a GTIN length', () => {
    expect(barcodeKey('1234567890')).toBe('1234567890'); // 10 digits: somebody's own code
    expect(barcodeKey('123456789012345')).toBe('123456789012345'); // 15
    expect(barcodeKey('٣٣٣٣٣٣٣٣')).toBe('٣٣٣٣٣٣٣٣'); // not barcode digits
  });

  it('has no code in an empty or blank string', () => {
    expect(barcodeKey('')).toBeNull();
    expect(barcodeKey('\r\n\t')).toBeNull();
  });
});

describe('cleanCode', () => {
  it('keeps the spaces inside and drops the control characters', () => {
    expect(cleanCode(' 4 006381 333931\r\n')).toBe('4 006381 333931');
    expect(cleanCode('AB\u001dC')).toBe('ABC');
  });
});
