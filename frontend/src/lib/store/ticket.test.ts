import { describe, expect, it } from 'vitest';
import type { StoreSale } from '../../api/store';
import { detachMissingDishes, keptAsSent, MAX_LINES, sameContents } from './sale';
import {
  addToTicket,
  barFrame,
  cardApproved,
  canKeepStale,
  cashChange,
  followOffset,
  chargeProblem,
  countOf,
  emptyTicket,
  lineKey,
  lineTotalCents,
  MAX_TICKET_QUANTITY,
  menuRefusalAnswered,
  menuRefusalKey,
  pendingStale,
  removeLine,
  removeLines,
  renewTicketRef,
  staleId,
  staleLines,
  stepLine,
  ticketCount,
  ticketTotalCents,
  tillAnswer,
  tillPayload,
  updatePrices,
  whyNotAddable,
  withCardApproval,
  type MenuDishState,
  type StaleLine,
  type Ticket,
} from './ticket';

const dish = (id: string, name: string, price: number | null, available = true) => ({ id, name, price, available });
const grande = dish('d-grande', 'Crispy Grande', 10);
const agua = dish('d-agua', 'Agua', 1);
const cana = dish('d-cana', 'Caña', 0.1);

/** Adds, failing the test if it is refused. */
function add(ticket: Ticket, d: ReturnType<typeof dish>): Ticket {
  const r = addToTicket(ticket, d);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.ticket;
}

describe('ringing up the bill', () => {
  it('adds a dish as a line of one, at the menu’s name and price in cents', () => {
    const r = addToTicket(emptyTicket('ref-1'), grande);
    expect(r).toEqual({
      ok: true,
      ticket: { clientRef: 'ref-1', lines: [{ dishId: 'd-grande', name: 'Crispy Grande', priceCents: 1000, quantity: 1 }] },
      line: { dishId: 'd-grande', name: 'Crispy Grande', priceCents: 1000, quantity: 1 },
    });
  });

  it('adds up the same dish on its line: three taps are three', () => {
    let t = emptyTicket('ref-1');
    t = add(add(add(t, grande), agua), grande);
    expect(t.lines.map((l) => [l.name, l.quantity])).toEqual([
      ['Crispy Grande', 2],
      ['Agua', 1],
    ]);
    expect(ticketCount(t)).toBe(3);
    expect(countOf(t, 'd-grande')).toBe(2);
    expect(countOf(t, 'd-nothing')).toBe(0);
  });

  it('puts a dish whose price changed mid-bill on a line of its own, and counts both on its tile', () => {
    let t = add(emptyTicket('ref-1'), grande);
    t = add(t, { ...grande, price: 11 });
    expect(t.lines.map((l) => [l.priceCents, l.quantity])).toEqual([
      [1000, 1],
      [1100, 1],
    ]);
    expect(countOf(t, 'd-grande')).toBe(2);
    expect(ticketTotalCents(t)).toBe(2100);
  });

  it('refuses a sold-out dish and one without a price, saying why', () => {
    expect(whyNotAddable(grande)).toBeNull();
    expect(whyNotAddable({ ...grande, available: false })).toBe('sold_out');
    expect(whyNotAddable({ ...grande, price: null })).toBe('no_price');
    // Both: what the tile says on it.
    expect(whyNotAddable({ ...grande, price: null, available: false })).toBe('sold_out');
    const t = emptyTicket('ref-1');
    expect(addToTicket(t, { ...grande, available: false })).toEqual({ ok: false, reason: 'sold_out' });
    expect(addToTicket(t, { ...grande, price: null })).toEqual({ ok: false, reason: 'no_price' });
  });

  it('takes a dish at 0 € (an invitation) as a price', () => {
    const t = add(emptyTicket('ref-1'), dish('d-free', 'Chupito', 0));
    expect(ticketTotalCents(t)).toBe(0);
    expect(ticketCount(t)).toBe(1);
  });

  it('is full at the server’s 200 lines, and at the most one line holds', () => {
    let t = emptyTicket('ref-1');
    for (let i = 0; i < MAX_LINES; i++) t = add(t, dish(`d-${i}`, `Plato ${i}`, 1));
    expect(addToTicket(t, dish('d-one-more', 'Uno más', 1))).toEqual({ ok: false, reason: 'full' });
    // Still room on a line already there.
    expect(addToTicket(t, dish('d-0', 'Plato 0', 1)).ok).toBe(true);

    const full = { clientRef: 'ref-1', lines: [{ dishId: 'd-agua', name: 'Agua', priceCents: 100, quantity: MAX_TICKET_QUANTITY }] };
    expect(addToTicket(full, agua)).toEqual({ ok: false, reason: 'full' });
  });
});

describe('changing a line', () => {
  const t = add(add(add(emptyTicket('ref-1'), grande), grande), agua);
  const kGrande = lineKey(t.lines[0]);
  const kAgua = lineKey(t.lines[1]);

  it('goes one up and one down', () => {
    expect(stepLine(t, kGrande, 1).lines[0].quantity).toBe(3);
    expect(stepLine(t, kGrande, -1).lines[0].quantity).toBe(1);
  });

  it('never goes below one: taking a line off is its own button', () => {
    expect(stepLine(t, kAgua, -1)).toBe(t);
  });

  it('removes a line, and leaves the rest as they were', () => {
    const after = removeLine(t, kGrande);
    expect(after.lines).toEqual([t.lines[1]]);
    expect(after.clientRef).toBe('ref-1');
    expect(removeLine(t, 'nothing@0')).toBe(t);
  });
});

describe('what the bill comes to', () => {
  it('adds up in whole cents: ten cañas at 0,10 € are 1,00 €, not 0,9999…', () => {
    let t = emptyTicket('ref-1');
    for (let i = 0; i < 10; i++) t = add(t, cana);
    expect(ticketTotalCents(t)).toBe(100);
    expect(lineTotalCents(t.lines[0])).toBe(100);
  });

  it('is 23,30 € for two Crispy Grande, a Coca-Cola and a water at their prices', () => {
    let t = emptyTicket('ref-1');
    t = add(add(add(add(t, grande), grande), dish('d-coca', 'Coca-Cola', 1.5)), dish('d-caprisun', 'Caprisun', 1.8));
    expect(ticketTotalCents(t)).toBe(2330);
    expect(ticketCount(t)).toBe(4);
  });
});

describe('the change in cash', () => {
  it('says nothing when nothing was typed', () => {
    expect(cashChange(2330, '')).toEqual({ tenderedCents: null, changeCents: null, shortCents: null, invalid: false });
    expect(cashChange(2330, '   ')).toEqual({ tenderedCents: null, changeCents: null, shortCents: null, invalid: false });
  });

  it('gives the change of what was handed over, as it is typed in Spain or on a number pad', () => {
    expect(cashChange(2330, '50')).toMatchObject({ tenderedCents: 5000, changeCents: 2670, shortCents: null });
    expect(cashChange(2330, '25,50')).toMatchObject({ changeCents: 220 });
    expect(cashChange(2330, '25.5 €')).toMatchObject({ changeCents: 220 });
    expect(cashChange(2330, '23,30')).toMatchObject({ changeCents: 0 });
  });

  it('says what is missing when it does not cover the total', () => {
    expect(cashChange(2330, '20')).toEqual({ tenderedCents: 2000, changeCents: null, shortCents: 330, invalid: false });
  });

  it('flags what is not an amount', () => {
    expect(cashChange(2330, 'veinte').invalid).toBe(true);
    expect(cashChange(2330, '1.250').invalid).toBe(true);
    expect(cashChange(2330, '-5').invalid).toBe(true);
  });
});

describe('charging', () => {
  const t = add(add(emptyTicket('ref-9'), grande), agua);

  it('needs something on the bill and a way of paying', () => {
    expect(chargeProblem(emptyTicket('ref-9'), 'cash', '')).toBe('empty');
    expect(chargeProblem(t, null, '')).toBe('no_method');
    expect(chargeProblem(t, 'cash', '')).toBeNull();
    expect(chargeProblem(t, 'card', '')).toBeNull();
  });

  it('waits for the manager to look at lines the menu changed under, before anything else', () => {
    expect(chargeProblem(t, 'cash', '', { stale: 1 })).toBe('stale');
    expect(chargeProblem(t, null, '', { stale: 2 })).toBe('stale');
    expect(chargeProblem(t, 'cash', '', { stale: 0 })).toBeNull();
    expect(chargeProblem(emptyTicket('ref-9'), 'cash', '', { stale: 1 })).toBe('empty');
  });

  it('refuses cash that does not cover the total, or is not an amount -- but not by card', () => {
    expect(chargeProblem(t, 'cash', '10')).toBe('short');
    expect(chargeProblem(t, 'cash', 'diez')).toBe('tendered_invalid');
    expect(chargeProblem(t, 'cash', '20')).toBeNull();
    // What was typed for cash is left behind when the card is chosen.
    expect(chargeProblem(t, 'card', '10')).toBeNull();
  });

  it('sends the bill as a till sale of the day, with its way of paying and its ref', () => {
    expect(tillPayload(t, '2026-09-27', 'card')).toEqual({
      sold_on: '2026-09-27',
      note: null,
      source: 'till',
      payment_method: 'card',
      client_ref: 'ref-9',
      lines: [
        { dish_id: 'd-grande', name: 'Crispy Grande', unit_price: 10, quantity: 1 },
        { dish_id: 'd-agua', name: 'Agua', unit_price: 1, quantity: 1 },
      ],
    });
  });

  it('sends a dish that left the menu as a free line, and still knows the sale kept as its own', () => {
    const sent = detachMissingDishes(tillPayload(t, '2026-09-27', 'cash'), new Set(['d-grande']));
    expect(sent.lines.map((l) => l.dish_id)).toEqual(['d-grande', null]);
    // What keptAsSent reads of the sale the server kept.
    const kept = {
      id: 's-1',
      sold_on: '2026-09-27',
      note: null,
      total: 11,
      payment_method: 'cash',
      source: 'till',
      lines: [
        { id: 'l1', dish_id: 'd-grande', name: 'Crispy Grande', unit_price: 10, quantity: 1, amount: 10 },
        { id: 'l2', dish_id: null, name: 'Agua', unit_price: 1, quantity: 1, amount: 1 },
      ],
    } as StoreSale;
    expect(keptAsSent(sent, kept)).toBe(true);
    // A water more since the first try, whose answer was lost: not this bill.
    const more = detachMissingDishes(tillPayload(add(t, agua), '2026-09-27', 'cash'), new Set(['d-grande']));
    expect(keptAsSent(more, kept)).toBe(false);
  });

  it('knows its own sale when the server named a dish as the menu does now', () => {
    // Held to the till, the line is written under the menu's name when it is
    // charged (backend routers/store.py): a dish renamed while the bill was
    // open, the answer lost, the same bill sent again.
    const sent = tillPayload(t, '2026-09-27', 'cash');
    const kept = {
      id: 's-1',
      sold_on: '2026-09-27',
      note: null,
      total: 11,
      payment_method: 'cash',
      source: 'till',
      voided_at: null,
      lines: [
        { id: 'l1', dish_id: 'd-grande', name: 'Crispy Grande (nuevo)', unit_price: 10, quantity: 1, amount: 10 },
        { id: 'l2', dish_id: 'd-agua', name: 'Agua mineral', unit_price: 1, quantity: 1, amount: 1 },
      ],
    } as StoreSale;
    expect(keptAsSent(sent, kept)).toBe(true);
    expect(tillAnswer(sent, kept)).toBe('same');
    // Another dish under another name on that line is another bill.
    const other = { ...kept, lines: [kept.lines[0], { ...kept.lines[1], dish_id: 'd-cola', name: 'Cola' }] } as StoreSale;
    expect(keptAsSent(sent, other)).toBe(false);
    // A sale typed in by hand keeps the names it was sent with: they are compared.
    const byHand = { ...kept, source: 'manual', payment_method: null } as StoreSale;
    expect(sameContents({ ...sent, payment_method: undefined }, byHand)).toBe(false);
  });
});

describe('the bar at the foot of a narrow screen', () => {
  // Beside the sidebar's 256 px: the page's area, and its column inside the 24 px padding.
  const area = (viewport: number) => ({ left: 256, right: viewport });

  it('sits under the page’s column when it is wide enough', () => {
    expect(barFrame({ left: 280, right: 744 }, area(768), 768)).toEqual({ left: 280, width: 464, compact: false });
  });

  it('on a phone, where the column is a sliver, takes the page’s area and never the sidebar’s foot', () => {
    // 375 px: the column is 71 px; the area beside the sidebar 119 px. The
    // sidebar's foot ("Sign out") is from 0 to 256: the bar starts after it.
    const frame = barFrame({ left: 280, right: 351 }, area(375), 375);
    expect(frame).toEqual({ left: 264, width: 103, compact: true });
    expect(frame.left).toBeGreaterThanOrEqual(256);
  });

  it('is compact only while the area is too narrow for the count beside “Charge”', () => {
    // 600 px: the column is 296 px, the area 344.
    expect(barFrame({ left: 280, right: 576 }, area(600), 600)).toEqual({ left: 264, width: 328, compact: false });
  });

  it('never reaches past the window', () => {
    expect(barFrame({ left: -10, right: 900 }, { left: 0, right: 900 }, 800)).toEqual({ left: 0, width: 800, compact: false });
    expect(barFrame({ left: 280, right: 300 }, { left: -20, right: 900 }, 375)).toEqual({ left: 8, width: 359, compact: false });
  });
});

describe('the card reader’s approval, kept with the bill', () => {
  const t = add(add(emptyTicket('ref-1'), grande), agua);

  it('covers a retry of the same bill: the same ref, the same amount', () => {
    expect(cardApproved(t)).toBe(false);
    const approved = withCardApproval(t, 1100);
    expect(approved.cardApproval).toEqual({ clientRef: 'ref-1', amountCents: 1100 });
    expect(cardApproved(approved)).toBe(true);
  });

  it('does not cover the bill once it changed: another amount is another payment', () => {
    const approved = withCardApproval(t, 1100);
    expect(cardApproved(add(approved, agua))).toBe(false);
    expect(cardApproved({ ...approved, clientRef: 'ref-2' })).toBe(false);
  });

  it('goes with the bill to its new ref when the old one was answered with another sale', () => {
    const renewed = renewTicketRef(withCardApproval(t, 1100), 'ref-2');
    expect(renewed.clientRef).toBe('ref-2');
    expect(renewed.cardApproval).toEqual({ clientRef: 'ref-2', amountCents: 1100 });
    expect(cardApproved(renewed)).toBe(true);
    // Without an approval, only the ref changes.
    expect(renewTicketRef(t, 'ref-3')).toEqual({ ...t, clientRef: 'ref-3' });
  });
});

describe('what a retry was answered with', () => {
  const t = add(add(emptyTicket('ref-1'), grande), agua);
  const keptOf = (sent: ReturnType<typeof tillPayload>, over: Partial<StoreSale> = {}): StoreSale => ({
    id: 's-1',
    sold_on: sent.sold_on,
    note: null,
    total: 11,
    created_at: '2026-09-27T12:00:00Z',
    payment_method: sent.payment_method ?? null,
    source: 'till',
    voided_at: null,
    void_reason: null,
    voided_by_name: null,
    lines: sent.lines.map((l, i) => ({ id: `l${i}`, dish_id: l.dish_id ?? null, name: l.name, unit_price: l.unit_price, quantity: l.quantity, amount: 0 })),
    ...over,
  });

  it('is this charge when the same lines were kept the same way -- on another day too', () => {
    const sent = tillPayload(t, '2026-09-28', 'cash');
    expect(tillAnswer(sent, keptOf(sent))).toBe('same');
    // Charged at 23:59, the answer lost, retried after midnight.
    expect(tillAnswer(sent, keptOf(sent, { sold_on: '2026-09-27' }))).toBe('same');
    expect(keptAsSent(sent, keptOf(sent, { sold_on: '2026-09-27' }))).toBe(false);
  });

  it('is recorded the other way when only the way of paying differs: cash kept, card sent again', () => {
    const cash = tillPayload(t, '2026-09-27', 'cash');
    const card = tillPayload(t, '2026-09-27', 'card');
    expect(tillAnswer(card, keptOf(cash))).toBe('other_method');
    expect(tillAnswer(cash, keptOf(card))).toBe('other_method');
    expect(keptAsSent(card, keptOf(cash))).toBe(false);
  });

  it('is never a charge when the sale kept was voided since, however alike', () => {
    const sent = tillPayload(t, '2026-09-27', 'cash');
    const voided = keptOf(sent, { voided_at: '2026-09-27T12:05:00Z', voided_by_name: 'Marta' });
    expect(keptAsSent(sent, voided)).toBe(false);
    expect(tillAnswer(sent, voided)).toBe('voided');
    expect(tillAnswer(tillPayload(t, '2026-09-27', 'card'), voided)).toBe('voided');
  });

  it('is another bill when the lines differ, whatever the way of paying', () => {
    const first = tillPayload(t, '2026-09-27', 'cash');
    const more = tillPayload(add(t, agua), '2026-09-27', 'card');
    expect(tillAnswer(more, keptOf(first))).toBe('different');
    // A sale kept with no way of paying is not the till's.
    expect(tillAnswer(first, keptOf(first, { payment_method: null }))).toBe('different');
  });
});

describe('the menu changed under the bill', () => {
  const xl = dish('d-xl', 'Crispy XL', 13);
  const wrap = dish('d-wrap', 'Crispy Wrap', 7);
  const t = add(add(add(add(emptyTicket('ref-1'), grande), grande), agua), xl);
  const menuOf = (entries: [string, MenuDishState][]) => new Map(entries);
  const now = menuOf([
    ['d-grande', { price: 11, available: true }],
    ['d-agua', { price: 1, available: false }],
    // Crispy XL: deleted.
  ]);

  it('says which lines: a new price, sold out, gone -- and nothing without a menu', () => {
    expect(staleLines(t, null)).toEqual([]);
    expect(staleLines(t, now)).toEqual([
      { key: 'd-grande@1000', name: 'Crispy Grande', priceCents: 1000, change: { kind: 'price', priceCents: 1100 } },
      { key: 'd-agua@100', name: 'Agua', priceCents: 100, change: { kind: 'sold_out', priceCents: 100 } },
      { key: 'd-xl@1300', name: 'Crispy XL', priceCents: 1300, change: { kind: 'gone' } },
    ]);
  });

  it('says nothing of a bill the menu still matches', () => {
    const same = menuOf([
      ['d-grande', { price: 10, available: true }],
      ['d-agua', { price: 1, available: true }],
      ['d-xl', { price: 13, available: true }],
    ]);
    expect(staleLines(t, same)).toEqual([]);
  });

  it('counts a dish that lost its price as a new price of none', () => {
    const w = add(emptyTicket('ref-2'), wrap);
    expect(staleLines(w, menuOf([['d-wrap', { price: null, available: true }]]))).toEqual([
      { key: 'd-wrap@700', name: 'Crispy Wrap', priceCents: 700, change: { kind: 'price', priceCents: null } },
    ]);
  });

  it('moves the lines to their new price, folding them into one already there', () => {
    // One Grande before the price went up, and one after.
    const both = add(add(add(emptyTicket('ref-3'), grande), agua), dish('d-grande', 'Crispy Grande', 11));
    expect(both.lines.map(lineKey)).toEqual(['d-grande@1000', 'd-agua@100', 'd-grande@1100']);
    const updated = updatePrices(both, staleLines(both, menuOf([['d-grande', { price: 11, available: true }], ['d-agua', { price: 1, available: true }]])));
    expect(updated.lines).toEqual([
      { dishId: 'd-grande', name: 'Crispy Grande', priceCents: 1100, quantity: 2 },
      { dishId: 'd-agua', name: 'Agua', priceCents: 100, quantity: 1 },
    ]);
    expect(ticketTotalCents(updated)).toBe(2300);
  });

  it('leaves alone, when updating prices, what has no price to go to', () => {
    const stale = staleLines(t, now);
    const updated = updatePrices(t, stale);
    expect(updated.lines.map(lineKey)).toEqual(['d-grande@1100', 'd-agua@100', 'd-xl@1300']);
    // What is left to decide about: the sold-out water and the deleted XL.
    expect(staleLines(updated, now).map((s) => s.change.kind)).toEqual(['sold_out', 'gone']);
  });

  it('takes those lines off, and only those', () => {
    const stale = staleLines(t, now);
    const kept = removeLines(t, stale.filter((s) => s.change.kind !== 'price').map((s) => s.key));
    expect(kept.lines.map(lineKey)).toEqual(['d-grande@1000']);
    expect(removeLines(t, [])).toBe(t);
  });

  it('asks again about a line kept at its old price only if the price changes once more', () => {
    const stale = staleLines(t, now);
    const decided = new Set(stale.map(staleId));
    expect(pendingStale(stale, decided)).toEqual([]);
    const again = staleLines(t, menuOf([...now, ['d-grande', { price: 12, available: true }]]));
    expect(pendingStale(again, decided).map((s) => s.name)).toEqual(['Crispy Grande']);
  });

  it('asks again about a line kept while sold out if its price changes or goes', () => {
    const decided = new Set(staleLines(t, now).map(staleId));
    for (const price of [1.2, null]) {
      const again = staleLines(t, menuOf([...now, ['d-agua', { price, available: false }]]));
      expect(pendingStale(again, decided).map((s) => s.name)).toEqual(['Agua']);
    }
  });
});

describe('keeping stale lines as they are', () => {
  const line = (change: StaleLine['change'], priceCents = 1000): StaleLine => ({ key: 'k', name: 'X', priceCents, change });

  it('is always the manager’s to choose', () => {
    expect(canKeepStale([line({ kind: 'gone' }), line({ kind: 'price', priceCents: 1100 })], false)).toBe(true);
  });

  it('is only what the till still takes, for anybody held to it', () => {
    // Sold out, still on the menu at the line's price: a dish the till takes.
    expect(canKeepStale([line({ kind: 'sold_out', priceCents: 1000 })], true)).toBe(true);
    expect(canKeepStale([line({ kind: 'sold_out', priceCents: 1000 }), line({ kind: 'sold_out', priceCents: 1000 })], true)).toBe(
      true,
    );
    // No price on the menu now -- sold out or not: the server refuses it
    // (menu_price_changed), so it is taken off, never kept.
    expect(canKeepStale([line({ kind: 'price', priceCents: null })], true)).toBe(false);
    expect(canKeepStale([line({ kind: 'price', priceCents: null }, 0)], true)).toBe(false);
    expect(canKeepStale([line({ kind: 'sold_out', priceCents: null })], true)).toBe(false);
    // Another price, sold out or not, or no dish: refused too (menu_price_changed, till_line_needs_dish).
    expect(canKeepStale([line({ kind: 'price', priceCents: 1100 })], true)).toBe(false);
    expect(canKeepStale([line({ kind: 'sold_out', priceCents: 1100 })], true)).toBe(false);
    expect(canKeepStale([line({ kind: 'sold_out', priceCents: 1000 }), line({ kind: 'gone' })], true)).toBe(false);
    expect(canKeepStale([line({ kind: 'sold_out', priceCents: 1000 }), line({ kind: 'price', priceCents: null })], true)).toBe(
      false,
    );
  });

  it('is still the manager’s for a dish that lost its price', () => {
    expect(canKeepStale([line({ kind: 'price', priceCents: null }), line({ kind: 'sold_out', priceCents: null })], false)).toBe(true);
  });
});

describe('a charge refused because the menu moved', () => {
  it('says what to do about it, by who is charging', () => {
    expect(menuRefusalKey('menu_dish_not_found', false)).toBe('menu.charge.dishGone');
    expect(menuRefusalKey('menu_dish_not_found', true)).toBe('menu.charge.dishGoneRemove');
    expect(menuRefusalKey('till_line_needs_dish', true)).toBe('menu.charge.dishGoneRemove');
    expect(menuRefusalKey('menu_price_changed', true)).toBe('menu.charge.priceChanged');
    expect(menuRefusalKey('menu_price_changed', false)).toBe('menu.charge.priceChanged');
  });

  it('leaves any other refusal to its own sentence', () => {
    expect(menuRefusalKey('till_sale_not_today', true)).toBeUndefined();
    expect(menuRefusalKey(undefined, false)).toBeUndefined();
  });

  it('stops being said once every line it marked is decided', () => {
    expect(menuRefusalAnswered(2, 0, 'menu_price_changed', true)).toBe(true);
    expect(menuRefusalAnswered(1, 0, 'till_line_needs_dish', true)).toBe(true);
    expect(menuRefusalAnswered(1, 0, 'menu_dish_not_found', false)).toBe(true);
  });

  it('is still said while a marked line is undecided, or before any was marked', () => {
    expect(menuRefusalAnswered(2, 1, 'menu_price_changed', true)).toBe(false);
    expect(menuRefusalAnswered(0, 0, 'menu_price_changed', true)).toBe(false);
  });

  it('leaves any other refusal alone', () => {
    expect(menuRefusalAnswered(1, 0, 'till_sale_not_today', true)).toBe(false);
    expect(menuRefusalAnswered(1, 0, undefined, false)).toBe(false);
  });
});

describe('the bill column following the page down', () => {
  it('stays where it is while its row is below the top of the window', () => {
    expect(followOffset(300, 1400, 600)).toBe(0);
    expect(followOffset(16, 1400, 600)).toBe(0);
  });

  it('moves down with the page, 16 px from the top of the window', () => {
    expect(followOffset(-200, 1400, 600)).toBe(216);
  });

  it('never leaves its row, nor moves when the grid is no taller than the bill', () => {
    expect(followOffset(-2000, 1400, 600)).toBe(800);
    expect(followOffset(-200, 500, 600)).toBe(0);
  });
});
