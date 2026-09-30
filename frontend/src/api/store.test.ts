import { describe, expect, it } from 'vitest';
import { isVoided, normalizeSale, normalizeSaleSummary, normalizeStats, normalizeStockAlerts, toNumber } from './store';

describe('toNumber', () => {
  it('reads JSON numbers and numeric strings alike', () => {
    expect(toNumber(12.5)).toBe(12.5);
    expect(toNumber('12.50')).toBe(12.5);
    expect(toNumber('850')).toBe(850);
  });

  it('is 0 for what is not a number, never NaN on a screen', () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('')).toBe(0);
    expect(toNumber('abc')).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe('normalizeSaleSummary', () => {
  it('takes the contract as it is', () => {
    const sale = normalizeSaleSummary({
      id: 's1',
      sold_on: '2026-09-27',
      note: 'Mesa 4',
      total: 42.5,
      line_count: 3,
      created_at: '2026-09-27T12:00:00Z',
      payment_method: 'card',
      source: 'till',
      voided_at: null,
      void_reason: null,
    });
    expect(sale).toEqual({
      id: 's1',
      sold_on: '2026-09-27',
      note: 'Mesa 4',
      total: 42.5,
      line_count: 3,
      created_at: '2026-09-27T12:00:00Z',
      payment_method: 'card',
      source: 'till',
      voided_at: null,
      void_reason: null,
    });
    expect(isVoided(sale)).toBe(false);
  });

  it('reads an older sale, from before payments and voiding, as typed by hand and standing', () => {
    const sale = normalizeSaleSummary({ id: 's1', sold_on: '2026-09-27', total: 10, line_count: 1 });
    expect(sale.payment_method).toBeNull();
    expect(sale.source).toBe('manual');
    expect(sale.voided_at).toBeNull();
    expect(isVoided(sale)).toBe(false);
  });

  it('does not show a method it does not know as one it does', () => {
    expect(normalizeSaleSummary({ payment_method: 'bizum' }).payment_method).toBeNull();
    expect(normalizeSaleSummary({ payment_method: 'CASH' }).payment_method).toBeNull();
    expect(normalizeSaleSummary({ source: 'import' }).source).toBe('manual');
  });

  it('marks a voided sale, with its reason, and a blank reason as none', () => {
    const voided = normalizeSaleSummary({ id: 's1', voided_at: '2026-09-27T13:05:00Z', void_reason: 'Cobrada dos veces' });
    expect(isVoided(voided)).toBe(true);
    expect(voided.void_reason).toBe('Cobrada dos veces');
    expect(normalizeSaleSummary({ id: 's1', voided_at: '2026-09-27T13:05:00Z', void_reason: '  ' }).void_reason).toBeNull();
    expect(isVoided(normalizeSaleSummary({ id: 's1', voided_at: '' }))).toBe(false);
  });

  it('turns Decimal strings into numbers and a blank note into none', () => {
    const sale = normalizeSaleSummary({ id: 's1', sold_on: '2026-09-27', note: '  ', total: '42.50', line_count: '3' });
    expect(sale.total).toBe(42.5);
    expect(sale.line_count).toBe(3);
    expect(sale.note).toBeNull();
  });
});

describe('normalizeSale', () => {
  it('keeps free lines as free lines and reads every figure as a number', () => {
    const sale = normalizeSale({
      id: 's1',
      sold_on: '2026-09-27',
      note: null,
      total: '862.00',
      created_at: '2026-09-27T12:00:00Z',
      lines: [
        { id: 'l1', dish_id: 'd1', name: 'Croquetas', unit_price: '6.00', quantity: '2.000', amount: '12.00' },
        { id: 'l2', dish_id: null, name: 'Caja del día', unit_price: 850, quantity: 1, amount: 850 },
      ],
    });
    expect(sale.total).toBe(862);
    expect(sale.lines[0]).toEqual({
      id: 'l1',
      dish_id: 'd1',
      name: 'Croquetas',
      unit_price: 6,
      quantity: 2,
      amount: 12,
    });
    expect(sale.lines[1].dish_id).toBeNull();
  });

  it('survives an answer without lines', () => {
    expect(normalizeSale({ id: 's1' }).lines).toEqual([]);
  });

  it('reads how it was paid, where it came from, and who voided it and why', () => {
    const sale = normalizeSale({
      id: 's1',
      sold_on: '2026-09-27',
      total: '23.30',
      created_at: '2026-09-27T12:00:00Z',
      payment_method: 'cash',
      source: 'till',
      voided_at: '2026-09-27T13:05:00Z',
      voided_by_name: 'Marta',
      void_reason: 'Cobrada dos veces',
      lines: [],
    });
    expect(sale).toMatchObject({
      payment_method: 'cash',
      source: 'till',
      voided_at: '2026-09-27T13:05:00Z',
      voided_by_name: 'Marta',
      void_reason: 'Cobrada dos veces',
    });
  });

  it('reads who saved it, a deleted login as nobody, and a server that did not say as not said', () => {
    expect(normalizeSale({ id: 's1', created_by_name: 'Tablet barra' }).created_by_name).toBe('Tablet barra');
    expect(normalizeSale({ id: 's1', created_by_name: null }).created_by_name).toBeNull();
    expect(normalizeSale({ id: 's1', created_by_name: '  ' }).created_by_name).toBeNull();
    expect('created_by_name' in normalizeSale({ id: 's1' })).toBe(false);
  });

  it('says nobody voided a sale that stands, whatever else came along', () => {
    const sale = normalizeSale({ id: 's1', voided_at: null, voided_by_name: 'Marta' });
    expect(sale.voided_by_name).toBeNull();
  });

  it('is a voided sale without a name when the server sends none (the account was deleted)', () => {
    const sale = normalizeSale({ id: 's1', voided_at: '2026-09-27T13:05:00Z', voided_by_name: null });
    expect(isVoided(sale)).toBe(true);
    expect(sale.voided_by_name).toBeNull();
  });
});

describe('normalizeStats', () => {
  it('fills every day of the window, in order, with 0 where nothing was sold', () => {
    const stats = normalizeStats({
      from: '2026-09-25',
      to: '2026-09-28',
      total: 150,
      sales_count: 3,
      days_with_sales: 2,
      average_per_day: 75,
      // Only the days with sales, and out of order: the chart must not care.
      days: [
        { date: '2026-09-27', total: 100 },
        { date: '2026-09-25', total: '50.00' },
      ],
      by_weekday: [],
      top_dishes: [],
    });
    expect(stats.days).toEqual([
      { date: '2026-09-25', total: 50 },
      { date: '2026-09-26', total: 0 },
      { date: '2026-09-27', total: 100 },
      { date: '2026-09-28', total: 0 },
    ]);
  });

  it('always has the seven weekdays, Monday first', () => {
    const stats = normalizeStats({
      from: '2026-09-21',
      to: '2026-09-27',
      by_weekday: [
        { weekday: 5, total: '300.50' },
        { weekday: 0, total: 20 },
        { weekday: 9, total: 999 },
      ],
    });
    expect(stats.by_weekday).toEqual([
      { weekday: 0, total: 20 },
      { weekday: 1, total: 0 },
      { weekday: 2, total: 0 },
      { weekday: 3, total: 0 },
      { weekday: 4, total: 0 },
      { weekday: 5, total: 300.5 },
      { weekday: 6, total: 0 },
    ]);
  });

  it('reads the top dishes, free lines included', () => {
    const stats = normalizeStats({
      from: '2026-09-21',
      to: '2026-09-27',
      top_dishes: [
        { name: 'Caja del día', dish_id: null, quantity: '1.000', total: '850.00' },
        { name: 'Croquetas', dish_id: 'd1', quantity: 14, total: 84 },
      ],
    });
    expect(stats.top_dishes).toEqual([
      { name: 'Caja del día', dish_id: null, quantity: 1, total: 850 },
      { name: 'Croquetas', dish_id: 'd1', quantity: 14, total: 84 },
    ]);
  });

  it('adds without float noise', () => {
    const stats = normalizeStats({
      from: '2026-09-27',
      to: '2026-09-27',
      total: 0.30000000000000004,
      days: [
        { date: '2026-09-27', total: 0.1 },
        { date: '2026-09-27', total: 0.2 },
      ],
    });
    expect(stats.total).toBe(0.3);
    expect(stats.days).toEqual([{ date: '2026-09-27', total: 0.3 }]);
  });
});

describe('normalizeStockAlerts', () => {
  it('reads each product the sale left low, quantities as numbers', () => {
    expect(
      normalizeStockAlerts([
        {
          item_id: 'pollo',
          name: 'Pollo',
          unit: 'kg',
          on_hand: '2.250',
          min_quantity: 10,
          critical: true,
          became_critical: true,
          supplier: { id: 'makro', name: 'Makro', phone: '612 34 56 78' },
          order_quantity: '10.000',
          photo_url: '/api/v1/inventory/photos/p1',
        },
        {
          item_id: 'pan',
          name: 'Pan',
          unit: null,
          on_hand: 8,
          min_quantity: 10,
          critical: false,
          became_critical: false,
          supplier: null,
          order_quantity: null,
        },
      ]),
    ).toEqual([
      {
        item_id: 'pollo',
        name: 'Pollo',
        unit: 'kg',
        on_hand: 2.25,
        min_quantity: 10,
        critical: true,
        became_critical: true,
        supplier: { id: 'makro', name: 'Makro', phone: '612 34 56 78' },
        order_quantity: 10,
        photo_url: '/api/v1/inventory/photos/p1',
      },
      {
        item_id: 'pan',
        name: 'Pan',
        unit: null,
        on_hand: 8,
        min_quantity: 10,
        critical: false,
        became_critical: false,
        supplier: null,
        order_quantity: null,
        photo_url: null,
      },
    ]);
  });

  it('is none from a server older than the field, and drops what names no product', () => {
    expect(normalizeStockAlerts(undefined)).toEqual([]);
    expect(normalizeStockAlerts({})).toEqual([]);
    expect(normalizeStockAlerts([{ name: 'x' }, null])).toEqual([]);
  });

  it('a supplier without an id is none; one without a phone has null', () => {
    const [a] = normalizeStockAlerts([{ item_id: 'x', supplier: { name: 'Makro' } }]);
    expect(a.supplier).toBeNull();
    const [b] = normalizeStockAlerts([{ item_id: 'x', supplier: { id: 's', name: 'Makro', phone: '' } }]);
    expect(b.supplier).toEqual({ id: 's', name: 'Makro', phone: null });
    expect(b.critical).toBe(false);
  });
});
