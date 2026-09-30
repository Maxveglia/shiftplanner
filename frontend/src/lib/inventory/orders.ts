// Ordering from the suppliers: what the "Order from your supplier" notice
// (components/inventory/OrderAlert.tsx) lists, when it opens by itself, and
// the message it hands to WhatsApp. Everything that decides is here, pure and
// tested; the dialog only draws it.
//
// What it lists is the products below their minimum, one group per supplier,
// so ONE message goes to each: "Hola Makro, pedido para Casa Demo:\n- 10 kg
// Pollo\n- 2 cajas Coca-Cola\nGracias." Each line starts at the product's
// usual order (`order_quantity`) and can be changed before sending; a line
// left empty is not in the message. Nothing of it is saved on the server.
//
// "Critical" (Max, 27-sep-2026) is nothing left, or half the minimum or less.
// It is what interrupts a sale at the till -- and only the sale that took a
// product there; the rest wait for the manager to open the inventory.

import { isBelowMinimum, onHand, parsePositiveQuantity, type InventoryItem, type InventorySupplier } from '../../api/inventory';
import type { StockAlert } from '../../api/store';
import { translateIn, type Language } from '../i18n/core';

/** A product as the notice shows it, whether it came from the stock or from a sale's answer. */
export interface OrderLine {
  item_id: string;
  name: string;
  unit: string | null;
  photo_url: string | null;
  /** What should be on the shelf now; null when nothing is known of it. */
  on_hand: number | null;
  min_quantity: number | null;
  critical: boolean;
  /** Made critical by the sale the notice opened for: listed first. False for the stock's. */
  became_critical: boolean;
  supplier: InventorySupplier | null;
  /** Its usual order, in its unit, or null: its field starts empty. */
  order_quantity: number | null;
}

/**
 * Nothing left, or half the minimum or less: the server's `is_critical`
 * (routers/inventory.py), which says it of the products a sale leaves low. A
 * product with no minimum is never critical, nor one with no figure (only the
 * server can send none: `onHand` always has one).
 */
export function isCritical(now: number | null, min: number | null): boolean {
  if (min === null || now === null) return false;
  return now <= 0 || now <= min / 2;
}

export function orderLineFromItem(item: InventoryItem): OrderLine {
  const now = onHand(item);
  return {
    item_id: item.id,
    name: item.name,
    unit: item.unit,
    photo_url: item.photo_url ?? null,
    on_hand: now,
    min_quantity: item.min_quantity,
    critical: isCritical(now, item.min_quantity),
    became_critical: false,
    supplier: item.supplier ?? null,
    order_quantity: item.order_quantity ?? null,
  };
}

export function orderLineFromAlert(alert: StockAlert): OrderLine {
  return {
    item_id: alert.item_id,
    name: alert.name,
    unit: alert.unit,
    photo_url: alert.photo_url,
    on_hand: alert.on_hand,
    min_quantity: alert.min_quantity,
    critical: alert.critical,
    became_critical: alert.became_critical,
    supplier: alert.supplier,
    order_quantity: alert.order_quantity,
  };
}

/** Every product below its minimum. An archived one is not ordered any more. */
export function lowStockLines(items: readonly InventoryItem[]): OrderLine[] {
  return items.filter((i) => i.archived_at === null && isBelowMinimum(i)).map(orderLineFromItem);
}

/**
 * What the notice shows after a sale: the products the sale has just made
 * critical, and then -- so the one message to each of their suppliers
 * carries the lot -- the other products of those suppliers that are below
 * their minimum: those the sale took too (its answer is the freshest word on
 * them), then those of the stock. Null when the sale made nothing critical:
 * then there is no notice at all.
 *
 * A critical product with no supplier comes alone: "the others with no
 * supplier" are not one order.
 */
export function saleAlertLines(
  alerts: readonly StockAlert[],
  stock: readonly InventoryItem[] | undefined,
): OrderLine[] | null {
  const became = alerts.filter((a) => a.became_critical);
  if (became.length === 0) return null;
  const suppliers = new Set(became.flatMap((a) => (a.supplier ? [a.supplier.id] : [])));
  const lines = became.map(orderLineFromAlert);
  const seen = new Set(lines.map((l) => l.item_id));
  const sameSupplier = (s: InventorySupplier | null) => s !== null && suppliers.has(s.id);
  for (const alert of alerts) {
    if (seen.has(alert.item_id) || !sameSupplier(alert.supplier) || !(alert.on_hand < alert.min_quantity)) continue;
    lines.push(orderLineFromAlert(alert));
    seen.add(alert.item_id);
  }
  for (const line of lowStockLines(stock ?? [])) {
    if (seen.has(line.item_id) || !sameSupplier(line.supplier)) continue;
    lines.push(line);
    seen.add(line.item_id);
  }
  return lines;
}

/** The products of one supplier, or of none (`supplier` null). */
export interface OrderGroup {
  supplier: InventorySupplier | null;
  lines: OrderLine[];
}

/**
 * One group per supplier, A to Z, and the products with none last; in each,
 * those the sale has just made critical first (the news the notice opened
 * for), then the other critical ones, then A to Z.
 */
export function groupBySupplier(lines: readonly OrderLine[], locale?: string): OrderGroup[] {
  const byName = (a: string, b: string) => a.localeCompare(b, locale, { sensitivity: 'base' });
  const groups = new Map<string, OrderGroup>();
  for (const line of lines) {
    const key = line.supplier ? `s:${line.supplier.id}` : 'none';
    const group = groups.get(key) ?? { supplier: line.supplier, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.lines.sort(
      (a, b) =>
        Number(b.became_critical) - Number(a.became_critical) ||
        Number(b.critical) - Number(a.critical) ||
        byName(a.name, b.name),
    );
  }
  return [...groups.values()].sort((a, b) => {
    if (a.supplier === null) return 1;
    if (b.supplier === null) return -1;
    return byName(a.supplier.name, b.supplier.name);
  });
}

// --- The quantities --------------------------------------------------------------

/** What a line's field starts with: its usual order, written as the app writes numbers; empty without one. */
export function startingQuantity(line: OrderLine, format: (value: number) => string): string {
  return line.order_quantity !== null && line.order_quantity > 0 ? format(line.order_quantity) : '';
}

/** A line as it goes into the message. */
export interface OrderTextLine {
  name: string;
  unit: string | null;
  quantity: number;
}

/**
 * A group's lines as typed: those with a quantity go into the message; an
 * empty one is left out (and counted, so the dialog can say so); one that is
 * not a quantity stops the group from being sent until it is put right.
 */
export function readOrder(
  lines: readonly OrderLine[],
  texts: (itemId: string) => string,
): { send: OrderTextLine[]; blank: number; invalid: number } {
  const send: OrderTextLine[] = [];
  let blank = 0;
  let invalid = 0;
  for (const line of lines) {
    const text = texts(line.item_id);
    if (text.trim() === '') {
      blank += 1;
      continue;
    }
    const quantity = parsePositiveQuantity(text);
    if (quantity === null) invalid += 1;
    else send.push({ name: line.name, unit: line.unit, quantity });
  }
  return { send, blank, invalid };
}

// --- The message -------------------------------------------------------------------

const NUMBER_LOCALE: Record<Language, string> = { es: 'es-ES', en: 'en-US' };

/**
 * The order as it is sent, in the app's language: a greeting to the supplier
 * naming the business, one line per product ("- 10 kg Pollo", "- 2 Coca-Cola"
 * without a unit), and thanks. Without a supplier, no greeting by name.
 */
export function orderText({
  supplier,
  business,
  lines,
  language,
}: {
  supplier: string | null;
  business: string;
  lines: readonly OrderTextLine[];
  language: Language;
}): string {
  const number = new Intl.NumberFormat(NUMBER_LOCALE[language], { maximumFractionDigits: 3, useGrouping: false });
  const head = supplier
    ? translateIn(language, 'orders.message.greeting', { supplier, business })
    : translateIn(language, 'orders.message.head', { business });
  const body = lines.map((l) => `- ${number.format(l.quantity)}${l.unit ? ` ${l.unit}` : ''} ${l.name}`);
  return [head, ...body, translateIn(language, 'orders.message.thanks')].join('\n');
}

/**
 * The number WhatsApp's link wants: digits only, with the country's code.
 *
 * - With "+" or "00" in front it already has one: its digits, without them.
 *   Both at once ("+0034 612…", written by someone making sure) is the same
 *   number: the "00" goes too, or the link would dial 0034….
 * - Nine digits is a Spanish number without its code: 34 goes in front.
 * - Anything else, its digits as they are ("34 612…" already has it).
 *
 * Null when there is no number to link to: none, or fewer than 7 digits or
 * more than 15 (what a phone number can have).
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const text = (phone ?? '').trim();
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+') || digits.startsWith('00')) {
    // Already international: without the "00" that says so, if it has one.
    if (digits.startsWith('00')) digits = digits.slice(2);
  } else if (digits.length === 9) {
    digits = `34${digits}`;
  }
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

/** The link that opens WhatsApp on that number with the message written. */
export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * Puts the text on the clipboard: the Clipboard API first, then the old way
 * (a selected field and "copy"), for a page that is not allowed the first.
 * False when neither worked: the dialog then shows the text to copy by hand.
 */
export async function copyText(
  text: string,
  ways: {
    clipboard?: { writeText: (text: string) => Promise<void> } | null;
    fallback?: (text: string) => boolean;
  },
): Promise<boolean> {
  if (ways.clipboard) {
    try {
      await ways.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, not a secure page): the old way.
    }
  }
  try {
    return ways.fallback ? ways.fallback(text) : false;
  } catch {
    return false;
  }
}

// --- When it opens by itself -------------------------------------------------------
//
// On entering the inventory, when something is below its minimum. Closed, it
// does not come back that day for the same products; a product that falls
// below since brings it back. What was closed is kept in the browser, per
// business, and a browser that keeps nothing simply shows it every time.
//
// "Falls below since" includes falling below AGAIN: a product restocked at
// noon and sold down by the evening is news, though it was closed in the
// morning. So every time the products are looked at -- on entering, and when
// Stock's list arrives -- those no longer below their minimum leave what was
// closed (forgetRestocked).

/** The products whose notice was closed, and on which day. */
export interface Dismissal {
  /** YYYY-MM-DD, the browser's day. */
  day: string;
  ids: string[];
}

export function shouldOpenOnEntry(lowIds: readonly string[], dismissed: Dismissal | null, today: string): boolean {
  if (lowIds.length === 0) return false;
  if (dismissed === null || dismissed.day !== today) return true;
  const seen = new Set(dismissed.ids);
  return lowIds.some((id) => !seen.has(id));
}

/** What was closed today, with these products added; another day's is forgotten. */
export function withDismissed(previous: Dismissal | null, ids: readonly string[], today: string): Dismissal {
  const kept = previous !== null && previous.day === today ? previous.ids : [];
  return { day: today, ids: [...new Set([...kept, ...ids])] };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function dismissalKey(orgId: string): string {
  return `shiftplanner.orders.dismissed.${orgId}`;
}

/** What this business closed, as kept in `storage`; null for nothing, for anything unreadable, or no storage. */
export function readDismissal(storage: Store | null, orgId: string): Dismissal | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(dismissalKey(orgId));
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    const { day, ids } = value as Record<string, unknown>;
    if (typeof day !== 'string' || !Array.isArray(ids)) return null;
    return { day, ids: ids.filter((id): id is string => typeof id === 'string') };
  } catch {
    return null;
  }
}

export function saveDismissal(storage: Store | null, orgId: string, value: Dismissal): void {
  if (!storage) return;
  try {
    storage.setItem(dismissalKey(orgId), JSON.stringify(value));
  } catch {
    // Full or blocked: the notice will simply come back.
  }
}

/**
 * What was closed today that is still below its minimum (`lowIds`): the
 * others were restocked, and should they fall below again they are new.
 * Null for nothing closed, or closed another day. The very same value when
 * nothing leaves it, so the caller knows there is nothing to write.
 */
export function stillDismissed(dismissed: Dismissal | null, lowIds: readonly string[], today: string): Dismissal | null {
  if (dismissed === null || dismissed.day !== today) return null;
  const low = new Set(lowIds);
  const ids = dismissed.ids.filter((id) => low.has(id));
  return ids.length === dismissed.ids.length ? dismissed : { day: today, ids };
}

/**
 * Reads what this business closed, takes out what is no longer low, keeps
 * the rest, and answers with it -- what the decision to open goes by. Call
 * it with the whole list of products, freshly fetched: a product missing
 * from it counts as not low.
 */
export function forgetRestocked(
  storage: Store | null,
  orgId: string,
  lowIds: readonly string[],
  today: string,
): Dismissal | null {
  const before = readDismissal(storage, orgId);
  const after = stillDismissed(before, lowIds, today);
  if (after !== null && after !== before) saveDismissal(storage, orgId, after);
  return after;
}

// --- After a sale ------------------------------------------------------------------
//
// A sale's answer arrives while the dialog that recorded it -- the form of
// Tienda › Ventas, the till's charge or its sheet -- is still open: TanStack
// runs the hook's own onSuccess, which refetches the lists and waits for
// them, before the one handed to mutate(), which closes the dialog. With the
// lists slow that is seconds, and a notice opened after a fixed delay landed
// on top of the form: two dialogs, and the focus lost between them. So the
// notice waits for the page to have no modal dialog open, and then a moment
// more, for that dialog's exit and for focus to be back on the page.
//
// Not for ever: past a minute -- more than the lists can take (a request
// gives up at 30 s, and is tried twice) -- the dialog open is whatever the
// manager went on to do, and the notice does not interrupt it. The products
// are still flagged: Stock's "Order" button, and the notice on entering the
// inventory.

export const AFTER_SALE = {
  /** How often the page is looked at. */
  everyMs: 100,
  /** How long the page must have been without a modal: a dialog's exit lasts 180 ms. */
  quietMs: 260,
  /** Waiting on a modal still open past this, it gives up. */
  giveUpMs: 60_000,
} as const;

export type AfterSaleStep = 'wait' | 'open' | 'give-up';

/**
 * One look at the page while a sale's notice waits to open: `elapsedMs`
 * since the sale's answer, `lastModalMs` when a modal dialog was last seen
 * open on that same clock (null if none was), and whether one is open now.
 */
export function afterSaleStep(elapsedMs: number, lastModalMs: number | null, modalOpen: boolean): AfterSaleStep {
  if (modalOpen) return elapsedMs >= AFTER_SALE.giveUpMs ? 'give-up' : 'wait';
  return elapsedMs - (lastModalMs ?? 0) >= AFTER_SALE.quietMs ? 'open' : 'wait';
}
