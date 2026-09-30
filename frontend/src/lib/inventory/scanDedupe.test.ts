import { describe, expect, it } from 'vitest';
import { SCAN_REPEAT_MS, createScanDedupe } from './scanDedupe';

describe('createScanDedupe', () => {
  it('counts a code the first time it is seen', () => {
    const d = createScanDedupe();
    expect(d.accept('8410188012344', 0)).toBe(true);
  });

  it('does not count it again while it stays in front of the camera', () => {
    // Seven reads a second for five seconds: one box.
    const d = createScanDedupe();
    let counted = 0;
    for (let t = 0; t <= 5000; t += 150) {
      if (d.accept('8410188012344', t)) counted += 1;
    }
    expect(counted).toBe(1);
  });

  it('measures the window from the LAST sighting, not the first', () => {
    const d = createScanDedupe();
    expect(d.accept('8410188012344', 0)).toBe(true);
    expect(d.accept('8410188012344', 1400)).toBe(false);
    // 2000 is past 1500 from the first read, but only 600 from the last one.
    expect(d.accept('8410188012344', 2000)).toBe(false);
  });

  it('counts it again once it has been gone for the whole window', () => {
    const d = createScanDedupe();
    expect(d.accept('8410188012344', 0)).toBe(true);
    expect(d.accept('8410188012344', SCAN_REPEAT_MS - 1)).toBe(false);
    expect(d.accept('8410188012344', 2 * SCAN_REPEAT_MS - 1)).toBe(true);
  });

  it('lets a different code through straight away', () => {
    const d = createScanDedupe();
    expect(d.accept('8410188012344', 0)).toBe(true);
    expect(d.accept('96385074', 10)).toBe(true);
  });

  it('counts each of two codes in the same frame once, however they alternate', () => {
    // A carton with an ITF-14 and an EAN both in view.
    const d = createScanDedupe();
    let a = 0;
    let b = 0;
    for (let t = 0; t < 3000; t += 150) {
      if (d.accept('18410188012341', t)) a += 1;
      if (d.accept('8410188012344', t + 5)) b += 1;
    }
    expect([a, b]).toEqual([1, 1]);
  });

  it('treats the same GTIN read as UPC-A or as EAN-13 as one box', () => {
    const d = createScanDedupe();
    expect(d.accept('036000291452', 0)).toBe(true);
    expect(d.accept('0036000291452', 150)).toBe(false);
  });

  it('ignores the whitespace a reader may leave around a code', () => {
    const d = createScanDedupe();
    expect(d.accept('8410188012344', 0)).toBe(true);
    expect(d.accept(' 8410188012344\r\n', 150)).toBe(false);
  });

  it('keeps alphanumeric codes case-sensitive, as the barcode key does', () => {
    const d = createScanDedupe();
    expect(d.accept('ABC-123', 0)).toBe(true);
    expect(d.accept('abc-123', 10)).toBe(true);
  });

  it('never counts an empty read', () => {
    const d = createScanDedupe();
    expect(d.accept('', 0)).toBe(false);
    expect(d.accept('  \r\n', 0)).toBe(false);
  });

  it('forgets everything on reset', () => {
    const d = createScanDedupe();
    expect(d.accept('8410188012344', 0)).toBe(true);
    d.reset();
    expect(d.accept('8410188012344', 100)).toBe(true);
  });

  it('takes its window as a parameter', () => {
    const d = createScanDedupe(500);
    expect(d.accept('X1', 0)).toBe(true);
    expect(d.accept('X1', 400)).toBe(false);
    expect(d.accept('X1', 900)).toBe(true);
  });
});
