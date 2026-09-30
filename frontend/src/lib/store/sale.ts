// A sale while it is being typed: what the form holds, how it adds up, and
// what it sends.
//
// Every field is kept AS TYPED ("12,50", "2", "") and read here, so a price
// half-written is never rewritten under the manager's thumb, and one rule
// decides what the running total counts and what the save refuses.
//
// Money is added in whole cents. 3 × 0,10 € in floats is 0,30000000000000004,
// and a till that shows that has lost the manager's trust in every other
// figure on the screen.

import type { StoreSale, StoreSaleInput } from '../../api/store';
import type { MenuDish } from '../menu/types';
import { priceForField } from '../menu/price';
import { isSaleDay } from './period';

/** The server's bounds: numeric(10,2) and numeric(12,3), each below a million. */
export const MAX_UNIT_PRICE = 1_000_000;
export const MAX_QUANTITY = 1_000_000;
export const MAX_LINES = 200;
export const MAX_NAME = 200;
export const MAX_NOTE = 2000;

export interface SaleLineDraft {
  /** The row's own id, for React and for focusing it; never sent. */
  key: string;
  /** The dish it came from, or null for a free line. */
  dishId: string | null;
  name: string;
  price: string;
  quantity: string;
}

export interface SaleDraft {
  /** YYYY-MM-DD. */
  soldOn: string;
  note: string;
  lines: SaleLineDraft[];
  /**
   * The id the server knows this sale by (a UUID), made when the form is and
   * kept -- in the stored draft too -- until the sale is saved. A second tap,
   * or a retry after an answer lost on the way back, sends the same one and
   * gets the sale already saved instead of a second one.
   */
  clientRef: string;
}

export function emptySale(soldOn: string, clientRef: string): SaleDraft {
  return { soldOn, note: '', lines: [], clientRef };
}

/**
 * A price as typed: "12,50", "12.50", "12", "12 €". The comma is how a price
 * is written in Spain, the point how a phone's number pad often types it. At
 * most two decimals and no thousands separator: "1.250" is refused rather
 * than read as one euro twenty-five, which is what it would silently become.
 * Zero is a price (an invitation); blank is not.
 */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/\s+/g, '').replace(/^[€$]|[€$]$/g, '');
  const match = /^(\d*)(?:[.,](\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, whole, cents = ''] = match;
  if (whole === '' && cents === '') return null;
  const value = Number(`${whole || '0'}.${cents || '0'}`);
  return Number.isFinite(value) && value < MAX_UNIT_PRICE ? value : null;
}

/** A quantity as typed: above 0, below a million, at most three decimals (1,5 kg). */
export function parseSaleQuantity(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned) && !/^\.\d{1,3}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 && value < MAX_QUANTITY ? value : null;
}

/**
 * What a line comes to, in cents: the price in cents times the quantity in
 * thousandths, rounded to the cent once, at the end.
 */
export function lineCents(unitPrice: number, quantity: number): number {
  const priceCents = Math.round(unitPrice * 100);
  const thousandths = Math.round(quantity * 1000);
  return Math.round((priceCents * thousandths) / 1000);
}

export interface LineCheck {
  price: number | null;
  quantity: number | null;
  /** Null until both the price and the quantity read. */
  cents: number | null;
  nameOk: boolean;
}

export function checkLine(line: SaleLineDraft): LineCheck {
  const price = parseMoney(line.price);
  const quantity = parseSaleQuantity(line.quantity);
  const name = line.name.trim();
  return {
    price,
    quantity,
    cents: price !== null && quantity !== null ? lineCents(price, quantity) : null,
    nameOk: name.length > 0 && name.length <= MAX_NAME,
  };
}

/** The running total: every line that reads, in cents. */
export function totalCents(lines: readonly SaleLineDraft[]): number {
  return lines.reduce((sum, line) => sum + (checkLine(line).cents ?? 0), 0);
}

/** Whether there is anything in the form worth keeping. */
export function hasContent(draft: SaleDraft): boolean {
  return draft.lines.length > 0 || draft.note.trim() !== '';
}

/**
 * A dish of the menu into the sale. A dish already there, at the price the
 * menu gives it, gets one more instead of a second line -- three taps on
 * "Caña" is three cañas, as on any till. A line whose price was changed by
 * hand is left alone: it is a different sale of the dish (the happy-hour
 * one), and folding into it would charge the new one at that price.
 */
export function addDish(
  lines: readonly SaleLineDraft[],
  dish: Pick<MenuDish, 'id' | 'name' | 'price'>,
  newKey: () => string,
  decimalMark: ',' | '.',
): { lines: SaleLineDraft[]; key: string } {
  const same = lines.find(
    (l) =>
      l.dishId === dish.id &&
      parseMoney(l.price) === (dish.price ?? null) &&
      parseSaleQuantity(l.quantity) !== null,
  );
  if (same) {
    const more = Math.round((parseSaleQuantity(same.quantity)! + 1) * 1000) / 1000;
    const quantity = decimalMark === ',' ? String(more).replace('.', ',') : String(more);
    return {
      lines: lines.map((l) => (l.key === same.key ? { ...l, quantity } : l)),
      key: same.key,
    };
  }
  const key = newKey();
  return {
    lines: [
      ...lines,
      { key, dishId: dish.id, name: dish.name, price: priceForField(dish.price, decimalMark), quantity: '1' },
    ],
    key,
  };
}

/** A line typed from nothing: "Caja del día", 850 €. */
export function addFreeLine(lines: readonly SaleLineDraft[], newKey: () => string): { lines: SaleLineDraft[]; key: string } {
  const key = newKey();
  return { lines: [...lines, { key, dishId: null, name: '', price: '', quantity: '1' }], key };
}

export type SaleProblem = 'no_lines' | 'too_many_lines' | 'bad_lines' | 'bad_date' | 'note_too_long';

/**
 * The sale as the server takes it, or what stops it. Checked here with the
 * server's own limits, so a refusal is said beside the field and not after a
 * round trip; the server checks again all the same.
 */
export function toPayload(
  draft: SaleDraft,
  today: Date = new Date(),
): { ok: true; payload: StoreSaleInput } | { ok: false; problem: SaleProblem } {
  if (!isSaleDay(draft.soldOn, today)) return { ok: false, problem: 'bad_date' };
  if (draft.lines.length === 0) return { ok: false, problem: 'no_lines' };
  if (draft.lines.length > MAX_LINES) return { ok: false, problem: 'too_many_lines' };
  if (draft.note.trim().length > MAX_NOTE) return { ok: false, problem: 'note_too_long' };
  const lines: StoreSaleInput['lines'] = [];
  for (const line of draft.lines) {
    const check = checkLine(line);
    if (!check.nameOk || check.price === null || check.quantity === null) return { ok: false, problem: 'bad_lines' };
    lines.push({ dish_id: line.dishId, name: line.name.trim(), unit_price: check.price, quantity: check.quantity });
  }
  return {
    ok: true,
    payload: { sold_on: draft.soldOn, note: draft.note.trim() || null, client_ref: draft.clientRef, lines },
  };
}

/**
 * The payload with every line whose dish has left the menu turned into a free
 * line: same name, same price, no dish. The sale happened; the dish being
 * taken off the menu since (another tab, another manager) is no reason to
 * refuse it, and the server would (menu_dish_not_found). `known` is the menu
 * as last fetched, or null when there is none to go by -- then nothing is
 * touched and the server decides.
 */
export function detachMissingDishes(payload: StoreSaleInput, known: ReadonlySet<string> | null): StoreSaleInput {
  if (!known) return payload;
  return {
    ...payload,
    lines: payload.lines.map((l) => (l.dish_id && !known.has(l.dish_id) ? { ...l, dish_id: null } : l)),
  };
}

/** Text as the server keeps it: NULs dropped, the ends trimmed, blank as nothing. */
function asKept(text: string | null | undefined): string {
  return (text ?? '').replace(/\0/g, '').trim();
}

/**
 * Whether the sale the server kept is the sale that was sent: one that
 * stands (not voided), of the same day, the same way of paying (none for a
 * sale typed by hand), and the same contents (sameContents).
 *
 * The server answers a ref it has already saved with the sale it saved, not
 * with the one in the request (api/store.ts). A save whose answer was lost on
 * the way back, a line added, Save again: the answer is the sale without that
 * line, and taking it for this one would close the form and throw the line
 * away with the draft. And a sale voided since (another tab) is not this one
 * saved: it counts for nothing, and saying "saved" or "charged" over it would
 * leave the sale unrecorded.
 */
export function keptAsSent(sent: StoreSaleInput, kept: StoreSale): boolean {
  if (kept.voided_at) return false;
  if (sent.sold_on !== kept.sold_on) return false;
  // Cash on the first try, its answer lost, card on the second: the server
  // kept a cash sale, and the till must not say it charged a card.
  if ((sent.payment_method ?? null) !== kept.payment_method) return false;
  return sameContents(sent, kept);
}

/**
 * The same note and the same lines in the same order -- name, price to the
 * cent, quantity to the thousandth, each as the server writes it. Not the
 * dish: a line whose dish left the menu is sent as a free one
 * (detachMissingDishes), and a dish deleted since leaves its line without
 * one; neither makes it another sale.
 *
 * Nor the name of a till's line of a dish: the server writes it as the menu
 * names the dish when it is charged, not as sent, for whoever is held to the
 * till (backend routers/store.py). A dish renamed while the bill was open is
 * still that line of this bill.
 */
export function sameContents(sent: StoreSaleInput, kept: StoreSale): boolean {
  if (asKept(sent.note) !== asKept(kept.note)) return false;
  if (sent.lines.length !== kept.lines.length) return false;
  return sent.lines.every((line, i) => {
    const other = kept.lines[i];
    const sameDish = kept.source === 'till' && line.dish_id != null && line.dish_id === other.dish_id;
    return (
      (sameDish || asKept(line.name) === asKept(other.name)) &&
      Math.round(line.unit_price * 100) === Math.round(other.unit_price * 100) &&
      Math.round(line.quantity * 1000) === Math.round(other.quantity * 1000)
    );
  });
}
