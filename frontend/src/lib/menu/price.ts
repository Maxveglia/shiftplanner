// A dish's price as the manager types it.

/** The server's ceiling: numeric(8,2), and a price has to be below 100 000. */
export const PRICE_CEILING = 100_000;

/**
 * "12,50", "12.50", "12,5", "12" or "12 €" as a number -- the comma is how a
 * price is written in Spain, the point how a phone's number pad often types
 * it. Null for anything else, blank included (the caller tells a blank field,
 * which is "no price", from a wrong one).
 *
 * At most two decimals, and no thousands separator: "1.250" is refused
 * rather than read as one euro twenty-five, which is what it would otherwise
 * silently become. A menu price with four figures is typed "1250".
 */
export function parsePrice(text: string): number | null {
  const cleaned = text
    .replace(/\s+/g, '')
    .replace(/^[€$]|[€$]$/g, '');
  const match = /^(\d*)(?:[.,](\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, whole, cents = ''] = match;
  // "," or "." alone, or nothing at all, is not a price.
  if (whole === '' && cents === '') return null;
  const value = Number(`${whole || '0'}.${cents || '0'}`);
  if (!Number.isFinite(value) || value >= PRICE_CEILING) return null;
  return value;
}

/**
 * A price as the edit field shows it back: "12,50" for 12.5 in Spanish, "12"
 * for 12, with the language's decimal mark and without a currency, so that
 * saving it again unchanged parses to the same number.
 */
export function priceForField(value: number | null, decimalMark: ',' | '.'): string {
  if (value === null) return '';
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return decimalMark === ',' ? text.replace('.', ',') : text;
}
