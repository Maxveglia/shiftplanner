import { describe, expect, it } from 'vitest';
import type { InventoryItem, InventorySupplier } from '../../api/inventory';
import type { StockAlert } from '../../api/store';
import {
  AFTER_SALE,
  afterSaleStep,
  copyText,
  forgetRestocked,
  groupBySupplier,
  isCritical,
  lowStockLines,
  orderLineFromItem,
  orderText,
  readDismissal,
  readOrder,
  saleAlertLines,
  saveDismissal,
  shouldOpenOnEntry,
  startingQuantity,
  stillDismissed,
  whatsappLink,
  whatsappNumber,
  withDismissed,
  type OrderLine,
} from './orders';

const MAKRO: InventorySupplier = { id: 'makro', name: 'Makro', phone: '612 34 56 78' };
const COCA: InventorySupplier = { id: 'coca', name: 'Coca-Cola Europacific', phone: '+34 911 22 33 44' };

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    name: 'Pollo',
    unit: 'kg',
    category: null,
    min_quantity: null,
    archived_at: null,
    last_quantity: null,
    last_counted_at: null,
    previous_quantity: null,
    previous_counted_at: null,
    barcodes: [],
    received_since_count: 0,
    received_between_counts: null,
    last_received_at: null,
    sold_since_count: 0,
    sold_between_counts: null,
    ...over,
  };
}

function alert(over: Partial<StockAlert> = {}): StockAlert {
  return {
    item_id: 'pollo',
    name: 'Pollo',
    unit: 'kg',
    on_hand: 2,
    min_quantity: 10,
    critical: true,
    became_critical: true,
    supplier: MAKRO,
    order_quantity: 10,
    photo_url: null,
    ...over,
  };
}

function line(over: Partial<OrderLine> = {}): OrderLine {
  return {
    item_id: 'pollo',
    name: 'Pollo',
    unit: 'kg',
    photo_url: null,
    on_hand: 2,
    min_quantity: 10,
    critical: true,
    became_critical: false,
    supplier: MAKRO,
    order_quantity: 10,
    ...over,
  };
}

describe('isCritical', () => {
  it('is nothing left, or half the minimum or less', () => {
    expect(isCritical(0, 10)).toBe(true);
    expect(isCritical(-3, 10)).toBe(true);
    expect(isCritical(5, 10)).toBe(true);
    expect(isCritical(5.001, 10)).toBe(false);
    expect(isCritical(9, 10)).toBe(false);
  });

  it('never without a minimum, or without a figure', () => {
    expect(isCritical(0, null)).toBe(false);
    expect(isCritical(null, 10)).toBe(false);
  });
});

describe('lowStockLines', () => {
  it('lists what is below its minimum, not archived, with its supplier and usual order', () => {
    const items = [
      item({ id: 'pollo', last_quantity: 2, min_quantity: 10, supplier: MAKRO, order_quantity: 10 }),
      item({ id: 'pan', name: 'Pan', last_quantity: 50, min_quantity: 10 }),
      item({ id: 'viejo', name: 'Viejo', last_quantity: 0, min_quantity: 10, archived_at: '2026-09-01T00:00:00Z' }),
      item({ id: 'sal', name: 'Sal', last_quantity: 0 }),
      // Added and never moved: it has 0, below its minimum -- to be ordered.
      item({ id: 'nuevo', name: 'Nuevo', min_quantity: 5 }),
    ];
    const lines = lowStockLines(items);
    expect(lines.map((l) => l.item_id)).toEqual(['pollo', 'nuevo']);
    expect(lines[1]).toMatchObject({ on_hand: 0, min_quantity: 5, critical: true });
    expect(lines[0]).toMatchObject({ on_hand: 2, min_quantity: 10, critical: true, supplier: MAKRO, order_quantity: 10 });
  });

  it('reads a server older than the fields as no supplier and no usual order', () => {
    const l = orderLineFromItem(item({ last_quantity: 8, min_quantity: 10 }));
    expect(l.supplier).toBeNull();
    expect(l.order_quantity).toBeNull();
    expect(l.critical).toBe(false);
    expect(l.photo_url).toBeNull();
  });
});

describe('saleAlertLines', () => {
  it('is nothing when the sale made nothing critical', () => {
    expect(saleAlertLines([alert({ became_critical: false })], [])).toBeNull();
    expect(saleAlertLines([], [])).toBeNull();
  });

  it('brings the other low products of the same supplier, and none of another', () => {
    const alerts = [
      alert(),
      // Taken by the sale too, low but not critical: same supplier, in.
      alert({ item_id: 'pan', name: 'Pan', on_hand: 8, critical: false, became_critical: false }),
      // Critical already before the sale, another supplier: not news.
      alert({ item_id: 'coca', name: 'Coca-Cola', supplier: COCA, became_critical: false }),
    ];
    const stock = [
      // In the sale's answer already: the answer wins over the stock's older figure.
      item({ id: 'pollo', last_quantity: 3, min_quantity: 10, supplier: MAKRO }),
      item({ id: 'aceite', name: 'Aceite', unit: 'l', last_quantity: 1, min_quantity: 5, supplier: MAKRO }),
      item({ id: 'fanta', name: 'Fanta', last_quantity: 0, min_quantity: 24, supplier: COCA }),
      item({ id: 'sal', name: 'Sal', last_quantity: 0, min_quantity: 2 }),
      item({ id: 'arroz', name: 'Arroz', last_quantity: 20, min_quantity: 5, supplier: MAKRO }),
    ];
    const lines = saleAlertLines(alerts, stock)!;
    expect(lines.map((l) => l.item_id)).toEqual(['pollo', 'pan', 'aceite']);
    expect(lines[0].on_hand).toBe(2);
    // Which the sale made critical travels with the line, for the order they are shown in.
    expect(lines.map((l) => l.became_critical)).toEqual([true, false, false]);
  });

  it('shows what the sale made critical first, before the older critical ones of its supplier', () => {
    const lines = saleAlertLines(
      [alert({ item_id: 'pollo', name: 'Pollo', on_hand: 4, min_quantity: 10 })],
      [
        item({ id: 'aceite', name: 'Aceite', unit: 'l', last_quantity: 0, min_quantity: 5, supplier: MAKRO }),
        item({ id: 'arroz', name: 'Arroz', last_quantity: 3, min_quantity: 5, supplier: MAKRO }),
      ],
    )!;
    const [makro] = groupBySupplier(lines, 'es');
    // Aceite (nothing left, critical since before) and Arroz come after it, though A to Z they would not.
    expect(makro.lines.map((l) => l.item_id)).toEqual(['pollo', 'aceite', 'arroz']);
  });

  it('shows the sale’s own products while the stock is still loading', () => {
    expect(saleAlertLines([alert()], undefined)!.map((l) => l.item_id)).toEqual(['pollo']);
  });

  it('brings a critical product with no supplier alone', () => {
    const lines = saleAlertLines(
      [alert({ supplier: null })],
      [item({ id: 'sal', name: 'Sal', last_quantity: 0, min_quantity: 2 })],
    )!;
    expect(lines.map((l) => l.item_id)).toEqual(['pollo']);
  });
});

describe('groupBySupplier', () => {
  it('puts suppliers A to Z and the products with none last; critical first inside', () => {
    const groups = groupBySupplier(
      [
        line({ item_id: 'sal', name: 'Sal', supplier: null }),
        line({ item_id: 'pan', name: 'Pan', critical: false }),
        line({ item_id: 'coca', name: 'Coca-Cola', supplier: COCA }),
        line({ item_id: 'aceite', name: 'Aceite', critical: false }),
        line({ item_id: 'pollo', name: 'Pollo' }),
      ],
      'es',
    );
    expect(groups.map((g) => g.supplier?.name ?? null)).toEqual(['Coca-Cola Europacific', 'Makro', null]);
    expect(groups[1].lines.map((l) => l.item_id)).toEqual(['pollo', 'aceite', 'pan']);
  });

  it('puts what the sale has just made critical before everything else in its group', () => {
    const groups = groupBySupplier(
      [
        line({ item_id: 'aceite', name: 'Aceite' }),
        line({ item_id: 'pan', name: 'Pan', critical: false }),
        line({ item_id: 'zumo', name: 'Zumo', became_critical: true }),
        line({ item_id: 'pollo', name: 'Pollo', became_critical: true }),
      ],
      'es',
    );
    expect(groups[0].lines.map((l) => l.item_id)).toEqual(['pollo', 'zumo', 'aceite', 'pan']);
  });
});

describe('startingQuantity and readOrder', () => {
  const format = (n: number) => String(n).replace('.', ',');

  it('starts from the usual order, empty without one', () => {
    expect(startingQuantity(line({ order_quantity: 1.5 }), format)).toBe('1,5');
    expect(startingQuantity(line({ order_quantity: null }), format)).toBe('');
  });

  it('sends what has a quantity, leaves the empty ones out and counts what is wrong', () => {
    const lines = [
      line({ item_id: 'pollo', name: 'Pollo' }),
      line({ item_id: 'pan', name: 'Pan', unit: null }),
      line({ item_id: 'aceite', name: 'Aceite', unit: 'l' }),
      line({ item_id: 'sal', name: 'Sal' }),
    ];
    const typed: Record<string, string> = { pollo: '10', pan: ' ', aceite: '1,5', sal: 'mucho' };
    expect(readOrder(lines, (id) => typed[id] ?? '')).toEqual({
      send: [
        { name: 'Pollo', unit: 'kg', quantity: 10 },
        { name: 'Aceite', unit: 'l', quantity: 1.5 },
      ],
      blank: 1,
      invalid: 1,
    });
  });

  it('takes 0 as a mistake, not as "leave it out"', () => {
    expect(readOrder([line()], () => '0').invalid).toBe(1);
  });
});

describe('orderText', () => {
  const lines = [
    { name: 'Pollo', unit: 'kg', quantity: 10 },
    { name: 'Coca-Cola', unit: 'cajas', quantity: 2 },
    { name: 'Aceite', unit: 'l', quantity: 1.5 },
    { name: 'Limones', unit: null, quantity: 12 },
  ];

  it('writes it in Spanish, as Max asked for it', () => {
    expect(orderText({ supplier: 'Makro', business: 'Casa Demo', lines, language: 'es' })).toBe(
      'Hola Makro, pedido para Casa Demo:\n- 10 kg Pollo\n- 2 cajas Coca-Cola\n- 1,5 l Aceite\n- 12 Limones\nGracias.',
    );
  });

  it('and in English when the app is', () => {
    expect(orderText({ supplier: 'Makro', business: 'Casa Demo', lines, language: 'en' })).toBe(
      'Hello Makro, order for Casa Demo:\n- 10 kg Pollo\n- 2 cajas Coca-Cola\n- 1.5 l Aceite\n- 12 Limones\nThank you.',
    );
  });

  it('greets nobody by name without a supplier', () => {
    expect(orderText({ supplier: null, business: 'Casa Demo', lines: lines.slice(0, 1), language: 'es' })).toBe(
      'Pedido para Casa Demo:\n- 10 kg Pollo\nGracias.',
    );
  });

  it('writes a thousand without a separator', () => {
    expect(
      orderText({ supplier: null, business: 'B', lines: [{ name: 'Vasos', unit: null, quantity: 1000 }], language: 'es' }),
    ).toContain('- 1000 Vasos');
  });
});

describe('whatsappNumber', () => {
  it('puts 34 in front of a Spanish number of nine digits', () => {
    expect(whatsappNumber('612 34 56 78')).toBe('34612345678');
    expect(whatsappNumber('612-345-678')).toBe('34612345678');
    expect(whatsappNumber('(91) 123 45 67')).toBe('34911234567');
  });

  it('keeps an international number as it is, without its symbols', () => {
    expect(whatsappNumber('+34 612 34 56 78')).toBe('34612345678');
    expect(whatsappNumber('0034 612 34 56 78')).toBe('34612345678');
    expect(whatsappNumber('+44 7700 900123')).toBe('447700900123');
    expect(whatsappNumber('0044 7700 900123')).toBe('447700900123');
  });

  it('takes the "00" off after a "+" too: "+0034" is 34, not a number starting 0034', () => {
    expect(whatsappNumber('+0034 612 34 56 78')).toBe('34612345678');
    expect(whatsappNumber('+00 44 7700 900123')).toBe('447700900123');
    expect(whatsappNumber(' +0034612345678 ')).toBe('34612345678');
  });

  it('leaves other lengths as typed', () => {
    expect(whatsappNumber('34 612 34 56 78')).toBe('34612345678');
  });

  it('has none for no phone, or for what cannot be one', () => {
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappNumber('+1234567890123456')).toBeNull();
  });
});

describe('whatsappLink', () => {
  it('carries the message, every line break and accent encoded', () => {
    expect(whatsappLink('34612345678', 'Hola Makro:\n- 1,5 kg Pollo\nGracias.')).toBe(
      'https://wa.me/34612345678?text=Hola%20Makro%3A%0A-%201%2C5%20kg%20Pollo%0AGracias.',
    );
  });
});

describe('copyText', () => {
  it('uses the clipboard when it is allowed', async () => {
    const written: string[] = [];
    const ok = await copyText('x', { clipboard: { writeText: async (t) => void written.push(t) }, fallback: () => false });
    expect(ok).toBe(true);
    expect(written).toEqual(['x']);
  });

  it('falls back to the old way when the clipboard refuses', async () => {
    const copied: string[] = [];
    const ok = await copyText('x', {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
      fallback: (t) => (copied.push(t), true),
    });
    expect(ok).toBe(true);
    expect(copied).toEqual(['x']);
  });

  it('says so when neither works, the fallback throwing included', async () => {
    expect(await copyText('x', { clipboard: null, fallback: () => false })).toBe(false);
    expect(
      await copyText('x', {
        fallback: () => {
          throw new Error('no document');
        },
      }),
    ).toBe(false);
  });
});

describe('opening on entering the inventory', () => {
  const today = '2026-09-27';

  it('opens when something is low and nothing was closed today', () => {
    expect(shouldOpenOnEntry(['a'], null, today)).toBe(true);
    expect(shouldOpenOnEntry(['a'], { day: '2026-09-26', ids: ['a'] }, today)).toBe(true);
  });

  it('does not open with nothing low', () => {
    expect(shouldOpenOnEntry([], null, today)).toBe(false);
  });

  it('stays closed the same day for the same products, or fewer', () => {
    const closed = { day: today, ids: ['a', 'b'] };
    expect(shouldOpenOnEntry(['a', 'b'], closed, today)).toBe(false);
    expect(shouldOpenOnEntry(['b'], closed, today)).toBe(false);
  });

  it('opens again when a new one falls below', () => {
    expect(shouldOpenOnEntry(['a', 'c'], { day: today, ids: ['a', 'b'] }, today)).toBe(true);
  });

  it('adds to what was closed today, and forgets another day’s', () => {
    expect(withDismissed({ day: today, ids: ['a'] }, ['b', 'a'], today)).toEqual({ day: today, ids: ['a', 'b'] });
    expect(withDismissed({ day: '2026-09-26', ids: ['a'] }, ['b'], today)).toEqual({ day: today, ids: ['b'] });
    expect(withDismissed(null, ['b'], today)).toEqual({ day: today, ids: ['b'] });
  });

  it('keeps it per business, and reads anything broken as nothing', () => {
    const kept = new Map<string, string>();
    const storage = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    };
    saveDismissal(storage, 'org1', { day: today, ids: ['a'] });
    expect(readDismissal(storage, 'org1')).toEqual({ day: today, ids: ['a'] });
    expect(readDismissal(storage, 'org2')).toBeNull();
    kept.set('shiftplanner.orders.dismissed.org2', '{nope');
    expect(readDismissal(storage, 'org2')).toBeNull();
    kept.set('shiftplanner.orders.dismissed.org2', JSON.stringify({ day: today, ids: ['a', 3] }));
    expect(readDismissal(storage, 'org2')).toEqual({ day: today, ids: ['a'] });
  });

  it('forgets what was restocked, so falling below again the same day opens it', () => {
    const kept = new Map<string, string>();
    const storage = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    };
    // Morning: Agua and Pan low, the notice closed.
    saveDismissal(storage, 'org1', withDismissed(null, ['agua', 'pan'], today));
    expect(shouldOpenOnEntry(['agua', 'pan'], forgetRestocked(storage, 'org1', ['agua', 'pan'], today), today)).toBe(false);
    // Noon: Agua restocked. Stock's list arrives: Agua leaves what was closed.
    expect(forgetRestocked(storage, 'org1', ['pan'], today)).toEqual({ day: today, ids: ['pan'] });
    expect(readDismissal(storage, 'org1')).toEqual({ day: today, ids: ['pan'] });
    // Evening: Agua sold down again. That is news.
    expect(shouldOpenOnEntry(['agua', 'pan'], forgetRestocked(storage, 'org1', ['agua', 'pan'], today), today)).toBe(true);
  });

  it('keeps what is still low, writes nothing when nothing changes, and ignores another day', () => {
    const closed = { day: today, ids: ['a', 'b'] };
    expect(stillDismissed(closed, ['a', 'b', 'c'], today)).toBe(closed);
    expect(stillDismissed(closed, ['b'], today)).toEqual({ day: today, ids: ['b'] });
    expect(stillDismissed(closed, [], today)).toEqual({ day: today, ids: [] });
    expect(stillDismissed({ day: '2026-09-26', ids: ['a'] }, ['a'], today)).toBeNull();
    expect(stillDismissed(null, ['a'], today)).toBeNull();

    const writes: string[] = [];
    const storage = {
      getItem: () => JSON.stringify(closed),
      setItem: (_k: string, v: string) => void writes.push(v),
    };
    forgetRestocked(storage, 'org1', ['a', 'b'], today);
    expect(writes).toEqual([]);
    forgetRestocked(storage, 'org1', ['a'], today);
    expect(writes).toEqual([JSON.stringify({ day: today, ids: ['a'] })]);
  });

  it('works without storage, and with one that throws', () => {
    expect(readDismissal(null, 'org1')).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readDismissal(broken, 'org1')).toBeNull();
    expect(() => saveDismissal(broken, 'org1', { day: today, ids: [] })).not.toThrow();
    expect(forgetRestocked(null, 'org1', ['a'], today)).toBeNull();
    expect(forgetRestocked(broken, 'org1', ['a'], today)).toBeNull();
  });
});

describe('opening after a sale', () => {
  const { quietMs, giveUpMs } = AFTER_SALE;

  it('opens a moment after the answer when no dialog is open (the page was left)', () => {
    expect(afterSaleStep(100, null, false)).toBe('wait');
    expect(afterSaleStep(quietMs, null, false)).toBe('open');
  });

  it('waits while the form or the charge is still open, however long the lists take', () => {
    expect(afterSaleStep(100, 100, true)).toBe('wait');
    expect(afterSaleStep(8_000, 8_000, true)).toBe('wait');
  });

  it('opens only once the page has been without one for a moment: its exit, and the focus back', () => {
    // The form was last seen open at 8 s.
    expect(afterSaleStep(8_100, 8_000, false)).toBe('wait');
    expect(afterSaleStep(8_000 + quietMs - 1, 8_000, false)).toBe('wait');
    expect(afterSaleStep(8_000 + quietMs, 8_000, false)).toBe('open');
  });

  it('never over another dialog: past the limit it gives up', () => {
    expect(afterSaleStep(giveUpMs - 1, giveUpMs - 1, true)).toBe('wait');
    expect(afterSaleStep(giveUpMs, giveUpMs, true)).toBe('give-up');
    // Closed just before the limit: it still opens, after its moment.
    expect(afterSaleStep(giveUpMs + quietMs, giveUpMs - 1, false)).toBe('open');
  });
});
