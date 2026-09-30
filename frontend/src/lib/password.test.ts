import { describe, expect, it } from 'vitest';
import { PASSWORD_ALPHABET, suggestPassword } from './password';

describe('suggestPassword', () => {
  it('is ten characters, none of them easy to misread', () => {
    const password = suggestPassword();
    expect(password).toHaveLength(10);
    for (const ch of password) expect(PASSWORD_ALPHABET).toContain(ch);
    for (const ch of '01ilo') expect(PASSWORD_ALPHABET).not.toContain(ch);
  });

  it('is long enough for the server (8 at least)', () => {
    expect(suggestPassword().length).toBeGreaterThanOrEqual(8);
  });

  it('reads each character from the random numbers it is given', () => {
    const fixed = (n: Uint32Array) => n.map((_, i) => i);
    expect(suggestPassword(fixed)).toBe(PASSWORD_ALPHABET.slice(0, 10));
  });
});
