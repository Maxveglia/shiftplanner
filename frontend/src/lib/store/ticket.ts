// The bill at the till: what is being rung up on the Menu screen before it is
// charged. A tap on a dish is one more of it; the bill adds up, and "Charge"
// records it as a sale of the day (source 'till'), paid in cash or by card.
//
// Only dishes of the menu, at the menu's price, in whole units: the till rings
// up what it shows, and a tap is one. A free line, a price changed by hand or
// half a kilo is "New sale" on the Sales screen, not this.
//
// Money is kept in whole cents, as in sale.ts and for the same reason: a till
// that shows 0,30000000000000004 € has lost the manager's trust in every other
// figure on the screen.
//
// Nothing here is a document for the customer (decided with Max, 27-sep-2026):
// the bill is the manager's screen, the sale is recorded, and that is all --
// no ticket, no printing, no "pre-bill". A charged sale is never deleted or
// edited, only voided with its trace (api/store.ts).
//
// Free of React and of the DOM, so it can be tested: the sums, the steps, the
// change, what is sent.

import type { PaymentMethod, StoreSale, StoreSaleInput } from '../../api/store';
import type { MenuDish } from '../menu/types';
import { MAX_LINES, parseMoney, sameContents } from './sale';

/** How many of one dish a line holds at most: a till's tap is one, and nobody taps a thousand. */
export const MAX_TICKET_QUANTITY = 999;

export interface TicketLine {
  /** The dish it came from: the till rings up only what the menu shows. */
  dishId: string;
  /** As the menu named it when it was added: the sale keeps what was charged. */
  name: string;
  /** The unit price in cents, as the menu priced it when it was added. */
  priceCents: number;
  /** Whole units, 1 to MAX_TICKET_QUANTITY. */
  quantity: number;
}

export interface Ticket {
  lines: TicketLine[];
  /**
   * The id the server knows this charge by (a UUID), made with the bill and
   * kept -- in the stored draft too -- until it is charged. A double tap, or a
   * retry after an answer lost on the way back, sends the same one and gets
   * the sale already recorded instead of a second one.
   */
  clientRef: string;
  /**
   * What the card reader approved for this bill while its sale is not yet
   * recorded: a retry of the same bill (the answer lost, a network down) must
   * not take the card a second time. Kept in the stored draft with the rest.
   */
  cardApproval?: CardApproval;
}

/** The card reader approved `amountCents` for the bill charged under `clientRef`. */
export interface CardApproval {
  clientRef: string;
  amountCents: number;
}

export function emptyTicket(clientRef: string): Ticket {
  return { lines: [], clientRef };
}

/** A line's identity: the same dish at another price (the menu changed mid-bill) is another line. */
export function lineKey(line: Pick<TicketLine, 'dishId' | 'priceCents'>): string {
  return `${line.dishId}@${line.priceCents}`;
}

export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

// --- What can be rung up ----------------------------------------------------------

/** Why a dish cannot go on the bill. */
export type AddBlock = 'sold_out' | 'no_price';

/**
 * Why a dish cannot be added, or null when it can. Sold out comes first: it
 * is what the tile says on it, and a dish with no price that is also sold out
 * is, above all, not there to sell.
 */
export function whyNotAddable(dish: Pick<MenuDish, 'available' | 'price'>): AddBlock | null {
  if (!dish.available) return 'sold_out';
  if (dish.price === null || !Number.isFinite(dish.price) || dish.price < 0) return 'no_price';
  return null;
}

export type AddResult =
  | { ok: true; ticket: Ticket; line: TicketLine }
  | { ok: false; reason: AddBlock | 'full' };

/**
 * One more of a dish: onto its line when there is one at this price, or a new
 * line at the end. Refused for a dish that cannot be sold (whyNotAddable),
 * and when the bill is full -- the server's 200 lines, or a line at its most.
 */
export function addToTicket(ticket: Ticket, dish: Pick<MenuDish, 'id' | 'name' | 'price' | 'available'>): AddResult {
  const block = whyNotAddable(dish);
  if (block) return { ok: false, reason: block };
  const priceCents = toCents(dish.price!);
  const key = lineKey({ dishId: dish.id, priceCents });
  const at = ticket.lines.findIndex((l) => lineKey(l) === key);
  if (at >= 0) {
    const current = ticket.lines[at];
    if (current.quantity >= MAX_TICKET_QUANTITY) return { ok: false, reason: 'full' };
    const line = { ...current, quantity: current.quantity + 1 };
    return { ok: true, ticket: { ...ticket, lines: ticket.lines.map((l, i) => (i === at ? line : l)) }, line };
  }
  if (ticket.lines.length >= MAX_LINES) return { ok: false, reason: 'full' };
  const line: TicketLine = { dishId: dish.id, name: dish.name, priceCents, quantity: 1 };
  return { ok: true, ticket: { ...ticket, lines: [...ticket.lines, line] }, line };
}

/**
 * One more or one less on a line, between 1 and the most a line holds: below
 * one is not "none" -- taking a line off is its own button, never a thumb
 * pressing − once too often. The same ticket back when nothing changes.
 */
export function stepLine(ticket: Ticket, key: string, delta: 1 | -1): Ticket {
  let changed = false;
  const lines = ticket.lines.map((l) => {
    if (lineKey(l) !== key) return l;
    const quantity = Math.min(MAX_TICKET_QUANTITY, Math.max(1, l.quantity + delta));
    if (quantity === l.quantity) return l;
    changed = true;
    return { ...l, quantity };
  });
  return changed ? { ...ticket, lines } : ticket;
}

export function removeLine(ticket: Ticket, key: string): Ticket {
  const lines = ticket.lines.filter((l) => lineKey(l) !== key);
  return lines.length === ticket.lines.length ? ticket : { ...ticket, lines };
}

// --- What it comes to ---------------------------------------------------------------

export function lineTotalCents(line: Pick<TicketLine, 'priceCents' | 'quantity'>): number {
  return line.priceCents * line.quantity;
}

export function ticketTotalCents(ticket: Ticket): number {
  return ticket.lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
}

/** How many things are on the bill: 2 Crispy and a water are 3. */
export function ticketCount(ticket: Ticket): number {
  return ticket.lines.reduce((n, l) => n + l.quantity, 0);
}

/** How many of a dish are on the bill, whatever their price: the ×n on its tile. */
export function countOf(ticket: Ticket, dishId: string): number {
  return ticket.lines.reduce((n, l) => (l.dishId === dishId ? n + l.quantity : n), 0);
}

// --- Cash ---------------------------------------------------------------------------

export interface CashCheck {
  /** What was handed over, in cents; null when nothing (or nothing readable) was typed. */
  tenderedCents: number | null;
  /** What goes back, in cents, once what was handed over covers the total. */
  changeCents: number | null;
  /** What is still missing, in cents, when it does not. */
  shortCents: number | null;
  /** Something was typed and it is not an amount. */
  invalid: boolean;
}

/**
 * What was handed over, as typed ("50", "20,50", "20.50 €"), against the
 * total. Optional: left empty it says nothing, and the charge goes ahead --
 * the exact money, or a manager who counts in their head.
 */
export function cashChange(totalCents: number, tenderedText: string): CashCheck {
  if (tenderedText.trim() === '') return { tenderedCents: null, changeCents: null, shortCents: null, invalid: false };
  const tendered = parseMoney(tenderedText);
  if (tendered === null) return { tenderedCents: null, changeCents: null, shortCents: null, invalid: true };
  const tenderedCents = toCents(tendered);
  return tenderedCents >= totalCents
    ? { tenderedCents, changeCents: tenderedCents - totalCents, shortCents: null, invalid: false }
    : { tenderedCents, changeCents: null, shortCents: totalCents - tenderedCents, invalid: false };
}

// --- Charging it --------------------------------------------------------------------

export type ChargeProblem = 'empty' | 'stale' | 'no_method' | 'tendered_invalid' | 'short';

/**
 * What stops a charge before anything is sent, or null. A cash amount that
 * does not cover the total is a mistake to fix -- a wrong figure typed, or
 * money still to come -- not a sale to record. Lines the menu has changed
 * under (`stale`, those the manager has not looked at yet: staleLines) stop
 * it too, until they are updated, taken off or kept as they are.
 */
export function chargeProblem(
  ticket: Ticket,
  method: PaymentMethod | null,
  tenderedText: string,
  { stale = 0 }: { stale?: number } = {},
): ChargeProblem | null {
  if (ticket.lines.length === 0) return 'empty';
  if (stale > 0) return 'stale';
  if (method === null) return 'no_method';
  if (method === 'cash') {
    const cash = cashChange(ticketTotalCents(ticket), tenderedText);
    if (cash.invalid) return 'tendered_invalid';
    if (cash.shortCents !== null) return 'short';
  }
  return null;
}

/**
 * The bill as the server records it: today (the till's day, local), from the
 * till, paid this way, under the bill's ref. What was handed over is not
 * sent: it is the manager's arithmetic, not part of the sale.
 */
export function tillPayload(ticket: Ticket, soldOn: string, method: PaymentMethod): StoreSaleInput {
  return {
    sold_on: soldOn,
    note: null,
    source: 'till',
    payment_method: method,
    client_ref: ticket.clientRef,
    lines: ticket.lines.map((l) => ({
      dish_id: l.dishId,
      name: l.name,
      unit_price: l.priceCents / 100,
      quantity: l.quantity,
    })),
  };
}

// --- The card reader's approval -----------------------------------------------------

/**
 * Whether the card reader already approved this very bill: the same ref and
 * the same amount. A bill changed since (a line added after the approval) is
 * another amount, and is not covered by it.
 */
export function cardApproved(ticket: Ticket): boolean {
  const a = ticket.cardApproval;
  return a !== undefined && a.clientRef === ticket.clientRef && a.amountCents === ticketTotalCents(ticket);
}

/** The bill with the reader's approval of its amount under its ref. */
export function withCardApproval(ticket: Ticket, amountCents: number): Ticket {
  return { ...ticket, cardApproval: { clientRef: ticket.clientRef, amountCents } };
}

/**
 * The same bill under a new ref (the old one was answered with a sale kept
 * earlier, which is not this bill). An approval taken for this bill goes with
 * it: the money was taken for these lines, and it is these lines, not that
 * sale, that are still to be recorded.
 */
export function renewTicketRef(ticket: Ticket, clientRef: string): Ticket {
  const { cardApproval, ...rest } = ticket;
  const carried = cardApproval && cardApproval.clientRef === ticket.clientRef ? { ...cardApproval, clientRef } : undefined;
  return carried ? { ...rest, clientRef, cardApproval: carried } : { ...rest, clientRef };
}

// --- What a retry was answered with ---------------------------------------------------

/**
 * The server answers a ref it already has with the sale it KEPT (api/store.ts),
 * and when that sale is not the one just sent (keptAsSent), what the till does
 * depends on how it differs:
 *
 * - 'same': these lines, this way of paying -- recorded on another day (a
 *   bill charged at 23:59 whose answer was lost, retried after midnight). It
 *   is this charge: the bill is done.
 * - 'other_method': these lines, paid the other way -- cash on the first try,
 *   its answer lost, then card. It is recorded, and must not be recorded
 *   again: the bill is done, and the manager is told how it was recorded and
 *   how to put it right (void it and charge it again).
 * - 'voided': recorded, and voided since (another tab). Not a charge of this
 *   bill any more: the bill stays, under a new ref.
 * - 'different': another bill (lines added or taken off since the first
 *   try): the bill stays, under a new ref, and the manager decides.
 */
export type TillAnswer = 'same' | 'other_method' | 'voided' | 'different';

export function tillAnswer(sent: StoreSaleInput, kept: StoreSale): TillAnswer {
  if (kept.voided_at) return 'voided';
  if (!sameContents(sent, kept)) return 'different';
  if ((sent.payment_method ?? null) === kept.payment_method) return 'same';
  // Kept without a way of paying (typed by hand under this ref?): not the till's.
  return kept.payment_method === null ? 'different' : 'other_method';
}

// --- The menu changed under the bill ------------------------------------------------

/** What happened to a line's dish since it was put on the bill. */
export type LineChange =
  | { kind: 'gone' }
  /**
   * Not sold today. `priceCents`: the menu's price now, in cents, null when
   * it has none -- whoever is held to the till can keep the line only while
   * it is still the line's (canKeepStale).
   */
  | { kind: 'sold_out'; priceCents: number | null }
  /** The menu's price now, in cents; null when it has none any more. */
  | { kind: 'price'; priceCents: number | null };

export interface StaleLine {
  /** The line's key (lineKey). */
  key: string;
  name: string;
  /** What it is on the bill at, in cents. */
  priceCents: number;
  change: LineChange;
}

/** A dish as the check needs it: its price and whether it is sold today. */
export type MenuDishState = Pick<MenuDish, 'price' | 'available'>;

/**
 * The lines the menu has changed under since they were rung up: the dish
 * deleted, sold out, or at another price. A bill brought back from the
 * browser (a reload, a tablet woken the next morning) is checked, and so is
 * every bill before it is charged. `menu` is the menu as last fetched, by
 * dish id; null when there is none yet (nothing is said then).
 *
 * Sold out comes before a new price: a dish that cannot be sold is the news.
 */
export function staleLines(ticket: Ticket, menu: ReadonlyMap<string, MenuDishState> | null): StaleLine[] {
  if (!menu) return [];
  const out: StaleLine[] = [];
  for (const line of ticket.lines) {
    const dish = menu.get(line.dishId);
    let change: LineChange | null = null;
    if (!dish) change = { kind: 'gone' };
    else {
      const now = dish.price === null || !Number.isFinite(dish.price) || dish.price < 0 ? null : toCents(dish.price);
      if (!dish.available) change = { kind: 'sold_out', priceCents: now };
      else if (now !== line.priceCents) change = { kind: 'price', priceCents: now };
    }
    if (change) out.push({ key: lineKey(line), name: line.name, priceCents: line.priceCents, change });
  }
  return out;
}

/**
 * What the manager said "keep as it is" to, by what changed: a line kept at
 * its old price -- or kept while sold out -- is asked about again if the
 * menu's price changes once more.
 */
export function staleId(s: StaleLine): string {
  return `${s.key}|${s.change.kind}|${s.change.kind === 'gone' ? '' : s.change.priceCents}`;
}

/** The stale lines the manager has not yet decided about. */
export function pendingStale(stale: readonly StaleLine[], kept: ReadonlySet<string>): StaleLine[] {
  return stale.filter((s) => !kept.has(staleId(s)));
}

/**
 * Whether "keep them as they are" can be offered for these lines.
 *
 * The manager can always: a sale of theirs is what they say it is. Anybody
 * else -- an employee, the till's tablet: whoever may not type a sale in by
 * hand (`store.sales.manual`) -- is HELD TO THE TILL: what they charge is
 * what the till would, dishes of the menu at the menu's price now (backend
 * routers/store.py, `_till_lines_are_dishes`, `_till_prices`). A line whose
 * dish left the menu, whose price moved to another, or whose dish has no
 * price any more would be refused (the till never charges a dish without
 * one: whyNotAddable), so for them it is updated or taken off. Only a dish
 * sold out, still on the menu at the line's price, is a dish the till takes
 * as it is.
 */
export function canKeepStale(stale: readonly StaleLine[], heldToTill: boolean): boolean {
  if (!heldToTill) return true;
  return stale.every((s) => s.change.kind === 'sold_out' && s.change.priceCents === s.priceCents);
}

/**
 * What a refused charge says, when the refusal is the menu having moved
 * under the bill -- and so the menu is fetched again, the bill checked
 * against it, and the lines that changed marked (TillTicket, StaleNotice).
 * Undefined for any other refusal, which says its own sentence.
 *
 * A dish gone: the manager's line is recorded without it on the next press
 * (sale.ts, detachMissingDishes); held to the till, that line would be a
 * free line, which the till does not take (`till_line_needs_dish`), so they
 * are told to take it off.
 */
export function menuRefusalKey(code: string | undefined, heldToTill: boolean): string | undefined {
  switch (code) {
    case 'menu_dish_not_found':
      return heldToTill ? 'menu.charge.dishGoneRemove' : 'menu.charge.dishGone';
    case 'till_line_needs_dish':
      return 'menu.charge.dishGoneRemove';
    case 'menu_price_changed':
      return 'menu.charge.priceChanged';
    default:
      return undefined;
  }
}

/**
 * Whether a refusal because the menu moved has been answered: it marked lines,
 * and none is left undecided. Its words then stop being said -- "check the
 * marked lines" with none marked, or "take it off" once it is off, is a riddle.
 */
export function menuRefusalAnswered(
  staleBefore: number,
  staleNow: number,
  code: string | undefined,
  heldToTill: boolean,
): boolean {
  return staleBefore > 0 && staleNow === 0 && menuRefusalKey(code, heldToTill) !== undefined;
}

/**
 * Every line whose dish has a new price, at that price -- folded into the line
 * already there at it, if any (a Crispy rung up before the change and one
 * after), up to the most a line holds. Lines whose dish has no price now, is
 * sold out or is gone are left as they are.
 */
export function updatePrices(ticket: Ticket, stale: readonly StaleLine[]): Ticket {
  const to = new Map<string, number>();
  for (const s of stale) if (s.change.kind === 'price' && s.change.priceCents !== null) to.set(s.key, s.change.priceCents);
  if (to.size === 0) return ticket;
  const lines: TicketLine[] = [];
  for (const line of ticket.lines) {
    const priceCents = to.get(lineKey(line)) ?? line.priceCents;
    const moved = priceCents === line.priceCents ? line : { ...line, priceCents };
    const at = lines.findIndex((l) => lineKey(l) === lineKey(moved));
    if (at >= 0) lines[at] = { ...lines[at], quantity: Math.min(MAX_TICKET_QUANTITY, lines[at].quantity + moved.quantity) };
    else lines.push(moved);
  }
  return { ...ticket, lines };
}

/** The bill without these lines. */
export function removeLines(ticket: Ticket, keys: Iterable<string>): Ticket {
  const drop = new Set(keys);
  const lines = ticket.lines.filter((l) => !drop.has(lineKey(l)));
  return lines.length === ticket.lines.length ? ticket : { ...ticket, lines };
}

// --- Where the bar sits -------------------------------------------------------------

export interface BarFrame {
  left: number;
  width: number;
  /** Too narrow for "3 · 23,30 €" beside "Charge": one over the other. */
  compact: boolean;
}

/**
 * The narrow screen's bar at the foot of the window: under the page's column,
 * as wide as it is -- the sidebar keeps its own foot, where "Sign out" is.
 * When that column is too narrow to hold it (a phone, where the sidebar
 * leaves the page a sliver), across the room the page has -- `area`, the
 * window beside the sidebar -- `margin` from its edges, and never over the
 * sidebar; compact when even that is narrow.
 */
export function barFrame(
  column: { left: number; right: number },
  area: { left: number; right: number },
  viewport: number,
  { min = 320, margin = 8, compactBelow = 260 }: { min?: number; margin?: number; compactBelow?: number } = {},
): BarFrame {
  const left = Math.max(0, column.left);
  const right = Math.min(viewport, column.right);
  if (right - left >= min) return { left, width: right - left, compact: false };
  const areaLeft = Math.max(0, area.left) + margin;
  const areaRight = Math.min(viewport, area.right) - margin;
  const width = Math.max(0, areaRight - areaLeft);
  return { left: areaLeft, width, compact: width < compactBelow };
}

/**
 * How far down the wide screen's bill column has to move to stay in view
 * while the page scrolls: what `position: sticky` would do, worked out by
 * hand because the app's main column clips its overflow, and sticking does
 * not reach past a box that does. `rowTop` is where the row holding the grid
 * and the bill is in the window now; the bill never leaves that row.
 */
export function followOffset(rowTop: number, rowHeight: number, panelHeight: number, gap = 16): number {
  const room = Math.max(0, rowHeight - panelHeight);
  return Math.round(Math.min(room, Math.max(0, gap - rowTop)));
}
