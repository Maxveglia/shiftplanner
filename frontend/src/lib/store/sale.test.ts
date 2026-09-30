import { describe, expect, it } from 'vitest';
import {
  addDish,
  addFreeLine,
  checkLine,
  detachMissingDishes,
  emptySale,
  hasContent,
  keptAsSent,
  lineCents,
  sameContents,
  parseMoney,
  parseSaleQuantity,
  toPayload,
  totalCents,
  type SaleDraft,
  type SaleLineDraft,
} from './sale';
import type { StoreSale, StoreSaleInput } from '../../api/store';

function keys() {
  let n = 0;
  return () => `k${++n}`;
}

function line(over: Partial<SaleLineDraft> = {}): SaleLineDraft {
  return { key: 'k', dishId: null, name: 'Caja del día', price: '850', quantity: '1', ...over };
}

describe('parseMoney', () => {
  it.each([
    ['12,50', 12.5],
    ['12.50', 12.5],
    ['12', 12],
    ['0', 0],
    [',5', 0.5],
    ['850 €', 850],
    ['12500', 12500],
    ['999999,99', 999999.99],
  ])('%j -> %j', (text, value) => {
    expect(parseMoney(text)).toBe(value);
  });

  it.each([[''], [' '], ['abc'], ['-3'], ['12,505'], ['1.250'], ['1000000']])('refuses %j', (text) => {
    expect(parseMoney(text)).toBeNull();
  });
});

describe('parseSaleQuantity', () => {
  it.each([
    ['1', 1],
    ['2,5', 2.5],
    ['0.125', 0.125],
    [',5', 0.5],
    ['999999', 999999],
  ])('%j -> %j', (text, value) => {
    expect(parseSaleQuantity(text)).toBe(value);
  });

  it.each([[''], ['0'], ['-1'], ['1,2345'], ['1000000'], ['dos']])('refuses %j', (text) => {
    expect(parseSaleQuantity(text)).toBeNull();
  });
});

describe('lineCents', () => {
  it('multiplies in cents and rounds once', () => {
    expect(lineCents(6, 2)).toBe(1200);
    expect(lineCents(0.1, 3)).toBe(30);
    expect(lineCents(12.35, 1)).toBe(1235);
    // 1,5 kg at 18,99 €/kg is 28,485 €: rounded to 28,49 €.
    expect(lineCents(18.99, 1.5)).toBe(2849);
  });
});

describe('totalCents', () => {
  it('adds the lines that read and skips the ones half-typed', () => {
    const lines = [
      line({ price: '0,10', quantity: '3' }),
      line({ price: '2,5', quantity: '2' }),
      line({ price: '', quantity: '1' }),
      line({ price: '4', quantity: 'x' }),
    ];
    expect(totalCents(lines)).toBe(530);
  });
});

describe('checkLine', () => {
  it('needs a name', () => {
    expect(checkLine(line({ name: '   ' })).nameOk).toBe(false);
    expect(checkLine(line({ name: 'x'.repeat(201) })).nameOk).toBe(false);
    expect(checkLine(line()).nameOk).toBe(true);
  });
});

describe('addDish', () => {
  const croquetas = { id: 'd1', name: 'Croquetas', price: 6.5 };

  it('adds a dish with its name and its price, as the field writes it', () => {
    const { lines, key } = addDish([], croquetas, keys(), ',');
    expect(lines).toEqual([{ key: 'k1', dishId: 'd1', name: 'Croquetas', price: '6,50', quantity: '1' }]);
    expect(key).toBe('k1');
    expect(addDish([], croquetas, keys(), '.').lines[0].price).toBe('6.50');
  });

  it('counts a second tap on the same dish as one more', () => {
    const next = keys();
    const once = addDish([], croquetas, next, ',').lines;
    const twice = addDish(once, croquetas, next, ',');
    expect(twice.lines).toHaveLength(1);
    expect(twice.lines[0].quantity).toBe('2');
    expect(twice.key).toBe('k1');
  });

  it('keeps the decimal mark of the language when it adds to a weighed line', () => {
    const lines = [line({ key: 'a', dishId: 'd1', price: '6,50', quantity: '1,5' })];
    expect(addDish(lines, croquetas, keys(), ',').lines[0].quantity).toBe('2,5');
  });

  it('starts a new line when the price there was changed by hand', () => {
    const lines = [line({ key: 'a', dishId: 'd1', name: 'Croquetas', price: '5', quantity: '1' })];
    const { lines: out } = addDish(lines, croquetas, keys(), ',');
    expect(out).toHaveLength(2);
    expect(out[1].price).toBe('6,50');
  });

  it('leaves the price blank for a dish at market price', () => {
    const { lines } = addDish([], { id: 'd2', name: 'Pescado del día', price: null }, keys(), ',');
    expect(lines[0].price).toBe('');
  });
});

describe('addFreeLine', () => {
  it('adds a blank line of one', () => {
    const { lines } = addFreeLine([], keys());
    expect(lines).toEqual([{ key: 'k1', dishId: null, name: '', price: '', quantity: '1' }]);
  });
});

describe('hasContent', () => {
  it('is a line or a note', () => {
    expect(hasContent(emptySale('2026-09-27', 'r'))).toBe(false);
    expect(hasContent({ ...emptySale('2026-09-27', 'r'), note: 'Mesa 4' })).toBe(true);
    expect(hasContent({ ...emptySale('2026-09-27', 'r'), lines: [line()] })).toBe(true);
  });
});

describe('toPayload', () => {
  const today = new Date(2026, 8, 27, 12);

  it('sends trimmed names, numbers and the ref', () => {
    const draft = {
      soldOn: '2026-09-27',
      note: '  Mesa 4 ',
      clientRef: 'ref-1',
      lines: [
        line({ dishId: 'd1', name: ' Croquetas ', price: '6,50', quantity: '2' }),
        line({ name: 'Caja del día', price: '850', quantity: '1' }),
      ],
    };
    expect(toPayload(draft, today)).toEqual({
      ok: true,
      payload: {
        sold_on: '2026-09-27',
        note: 'Mesa 4',
        client_ref: 'ref-1',
        lines: [
          { dish_id: 'd1', name: 'Croquetas', unit_price: 6.5, quantity: 2 },
          { dish_id: null, name: 'Caja del día', unit_price: 850, quantity: 1 },
        ],
      },
    });
  });

  it('sends no note rather than a blank one', () => {
    const result = toPayload({ soldOn: '2026-09-27', note: '   ', clientRef: 'r', lines: [line()] }, today);
    expect(result.ok && result.payload.note).toBeNull();
  });

  it('refuses a sale without lines, with a line that does not read, or out of range', () => {
    const base = { soldOn: '2026-09-27', note: '', clientRef: 'r' };
    expect(toPayload({ ...base, lines: [] }, today)).toEqual({ ok: false, problem: 'no_lines' });
    expect(toPayload({ ...base, lines: [line({ price: '' })] }, today)).toEqual({ ok: false, problem: 'bad_lines' });
    expect(toPayload({ ...base, lines: [line({ name: '' })] }, today)).toEqual({ ok: false, problem: 'bad_lines' });
    expect(toPayload({ ...base, soldOn: '2026-09-29', lines: [line()] }, today)).toEqual({
      ok: false,
      problem: 'bad_date',
    });
    const many = Array.from({ length: 201 }, (_, i) => line({ key: `k${i}` }));
    expect(toPayload({ ...base, lines: many }, today)).toEqual({ ok: false, problem: 'too_many_lines' });
  });
});

describe('detachMissingDishes', () => {
  const payload = {
    sold_on: '2026-09-27',
    note: null,
    client_ref: 'r',
    lines: [
      { dish_id: 'd1', name: 'Croquetas', unit_price: 6.5, quantity: 2 },
      { dish_id: 'gone', name: 'Pulpo', unit_price: 18, quantity: 1 },
      { dish_id: null, name: 'Caja del día', unit_price: 850, quantity: 1 },
    ],
  };

  it('keeps a dish that has left the menu as a free line, name and price intact', () => {
    const out = detachMissingDishes(payload, new Set(['d1']));
    expect(out.lines.map((l) => l.dish_id)).toEqual(['d1', null, null]);
    expect(out.lines[1]).toEqual({ dish_id: null, name: 'Pulpo', unit_price: 18, quantity: 1 });
  });

  it('touches nothing without a menu to go by', () => {
    expect(detachMissingDishes(payload, null)).toBe(payload);
  });
});

describe('keptAsSent', () => {
  const today = new Date(2026, 8, 27, 12);
  const draft: SaleDraft = {
    soldOn: '2026-09-27',
    note: 'Mesa 4',
    clientRef: 'ref-1',
    lines: [
      line({ key: 'a', dishId: 'd1', name: 'Croquetas', price: '6,50', quantity: '2' }),
      line({ key: 'b', name: 'Caña', price: '2,20', quantity: '1,5' }),
    ],
  };
  const payloadOf = (d: SaleDraft): StoreSaleInput => {
    const result = toPayload(d, today);
    if (!result.ok) throw new Error(result.problem);
    return result.payload;
  };
  // The sale as the server answers it for that payload.
  const keptOf = (sent: StoreSaleInput): StoreSale => ({
    id: 's1',
    sold_on: sent.sold_on,
    note: sent.note ?? null,
    total: 16.3,
    created_at: '2026-09-27T10:00:00Z',
    payment_method: sent.payment_method ?? null,
    source: sent.source ?? 'manual',
    voided_at: null,
    void_reason: null,
    voided_by_name: null,
    lines: sent.lines.map((l, i) => ({
      id: `l${i}`,
      dish_id: l.dish_id ?? null,
      name: l.name,
      unit_price: l.unit_price,
      quantity: l.quantity,
      amount: 0,
    })),
  });

  it('is the sale sent when the server kept exactly that', () => {
    const sent = payloadOf(draft);
    expect(keptAsSent(sent, keptOf(sent))).toBe(true);
  });

  it('is not when the first save was kept and a line was added since', () => {
    // Saved, the answer lost; a line added; the same ref sent again.
    const kept = keptOf(payloadOf(draft));
    const now = payloadOf({ ...draft, lines: [...draft.lines, line({ key: 'c', name: 'Pan', price: '1', quantity: '1' })] });
    expect(keptAsSent(now, kept)).toBe(false);
  });

  it('is not when a line was removed, or the lines swapped places', () => {
    const kept = keptOf(payloadOf(draft));
    expect(keptAsSent(payloadOf({ ...draft, lines: [draft.lines[0]] }), kept)).toBe(false);
    expect(keptAsSent(payloadOf({ ...draft, lines: [draft.lines[1], draft.lines[0]] }), kept)).toBe(false);
  });

  it.each([
    ['name', { name: 'Croquetas de jamón' }],
    ['price', { price: '6,40' }],
    ['quantity', { quantity: '3' }],
  ])('is not when a line changed its %s', (_what, patch) => {
    const kept = keptOf(payloadOf(draft));
    const changed = { ...draft, lines: [{ ...draft.lines[0], ...patch }, draft.lines[1]] };
    expect(keptAsSent(payloadOf(changed), kept)).toBe(false);
  });

  it('is not when the day or the note changed', () => {
    const kept = keptOf(payloadOf(draft));
    expect(keptAsSent(payloadOf({ ...draft, soldOn: '2026-09-26' }), kept)).toBe(false);
    expect(keptAsSent(payloadOf({ ...draft, note: 'Mesa 5' }), kept)).toBe(false);
    expect(keptAsSent(payloadOf({ ...draft, note: '' }), kept)).toBe(false);
  });

  it('is not when the way of paying changed: cash kept, card sent again', () => {
    // The till's retry: the first try's answer was lost, and the manager
    // switched to card before trying again under the same ref.
    const cash = { ...payloadOf(draft), source: 'till' as const, payment_method: 'cash' as const };
    const kept = keptOf(cash);
    expect(keptAsSent(cash, kept)).toBe(true);
    expect(keptAsSent({ ...cash, payment_method: 'card' }, kept)).toBe(false);
    // A sale typed by hand sends none, and the server keeps none.
    const manual = payloadOf(draft);
    expect(manual.payment_method).toBeUndefined();
    expect(keptAsSent(manual, keptOf(manual))).toBe(true);
    expect(keptAsSent(manual, kept)).toBe(false);
  });

  it('reads the numbers and texts as the server writes them', () => {
    const sent = payloadOf(draft);
    const kept = keptOf(sent);
    // Float noise on the way back, a name and a note trimmed by the server,
    // no note sent and none kept.
    kept.lines[0] = { ...kept.lines[0], unit_price: 6.500000001, name: 'Croquetas ' };
    kept.lines[1] = { ...kept.lines[1], quantity: 1.4999999 };
    expect(keptAsSent(sent, kept)).toBe(true);
    expect(keptAsSent({ ...sent, note: null }, { ...kept, note: null })).toBe(true);
    expect(keptAsSent({ ...sent, note: 'Mesa\u0000 4' }, kept)).toBe(true);
  });

  it('is not when the sale kept was voided since: it counts for nothing', () => {
    const sent = payloadOf(draft);
    const voided = { ...keptOf(sent), voided_at: '2026-09-27T11:00:00Z', voided_by_name: 'Marta' };
    expect(keptAsSent(sent, voided)).toBe(false);
    // Its contents are still the ones sent.
    expect(sameContents(sent, voided)).toBe(true);
  });

  it('does not look at the dish: one that left the menu is sent as a free line', () => {
    const sent = payloadOf(draft);
    const kept = keptOf(detachMissingDishes(sent, new Set()));
    expect(kept.lines[0].dish_id).toBeNull();
    expect(keptAsSent(sent, kept)).toBe(true);
  });
});
