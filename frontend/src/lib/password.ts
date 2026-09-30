/**
 * A password to hand over by word of mouth or on paper: readable (no 0/o,
 * 1/l/i), typable on a phone, and ten characters from 31 -- about 50 bits,
 * long enough not to be guessed over a shoulder. The manager passes it on
 * once (it is hashed the moment it is saved); whoever signs in may keep it.
 */
export const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function suggestPassword(random: (n: Uint32Array) => Uint32Array = (n) => crypto.getRandomValues(n)): string {
  const bytes = random(new Uint32Array(10));
  return Array.from(bytes, (n) => PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length]).join('');
}
