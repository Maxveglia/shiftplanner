import { describe, expect, it } from 'vitest';
import type { StoreSaleSummary } from '../../api/store';
import { groupSalesByDay, periodFigures, sumMoney, sumStanding } from './group';

function sale(id: string, sold_on: string, total: number, voided = false): StoreSaleSummary {
  return {
    id,
    sold_on,
    note: null,
    total,
    line_count: 1,
    created_at: '2026-09-27T10:00:00Z',
    payment_method: null,
    source: 'manual',
    voided_at: voided ? '2026-09-27T11:00:00Z' : null,
    void_reason: null,
  };
}

describe('groupSalesByDay', () => {
  it('puts each sale under its day, newest day first, with the day total', () => {
    const days = groupSalesByDay([
      sale('a', '2026-09-26', 10),
      sale('b', '2026-09-27', 42.5),
      sale('c', '2026-09-26', 5.25),
      sale('d', '2026-09-27', 7.5),
    ]);
    expect(days.map((d) => [d.date, d.sales.map((s) => s.id), d.total])).toEqual([
      ['2026-09-27', ['b', 'd'], 50],
      ['2026-09-26', ['a', 'c'], 15.25],
    ]);
  });

  it('keeps a voided sale under its day, and leaves it out of the day total', () => {
    const days = groupSalesByDay([
      sale('a', '2026-09-27', 23.3),
      sale('b', '2026-09-27', 100, true),
      sale('c', '2026-09-26', 8, true),
    ]);
    expect(days.map((d) => [d.date, d.sales.map((s) => s.id), d.total])).toEqual([
      ['2026-09-27', ['a', 'b'], 23.3],
      // A day whose only sale was voided is still in the book, at 0.
      ['2026-09-26', ['c'], 0],
    ]);
  });

  it('is empty for no sales', () => {
    expect(groupSalesByDay([])).toEqual([]);
  });
});

describe('sumMoney', () => {
  it('adds in cents', () => {
    expect(sumMoney(new Array(10).fill(0.1))).toBe(1);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([])).toBe(0);
  });
});

describe('sumStanding', () => {
  it('adds the sales that stand, in cents, and nothing voided', () => {
    expect(sumStanding([sale('a', '2026-09-27', 0.1), sale('b', '2026-09-27', 0.2), sale('c', '2026-09-27', 5, true)])).toBe(0.3);
    expect(sumStanding([sale('a', '2026-09-27', 5, true)])).toBe(0);
  });
});

describe('periodFigures', () => {
  const list = [sale('a', '2026-09-27', 10), sale('b', '2026-09-26', 5.25)];

  it('takes the server sum over the period when it is in', () => {
    // 1,234 sales in the period; the list carries only the most recent.
    expect(periodFigures({ total: 98765.4, sales_count: 1234 }, list, 500)).toEqual({ total: 98765.4, count: 1234 });
  });

  it('falls back on the list while the sum is on its way, if the list is whole', () => {
    expect(periodFigures(null, list, 500)).toEqual({ total: 15.25, count: 2 });
    expect(periodFigures(null, [], 500)).toEqual({ total: 0, count: 0 });
  });

  it('leaves voided sales out of the fallback, total and count alike', () => {
    const withVoided = [...list, sale('c', '2026-09-27', 99.9, true)];
    expect(periodFigures(null, withVoided, 500)).toEqual({ total: 15.25, count: 2 });
  });

  it('says nothing from a list cut at the limit, or from no list', () => {
    const full = Array.from({ length: 3 }, (_, i) => sale(`s${i}`, '2026-09-27', 1));
    expect(periodFigures(null, full, 3)).toBeNull();
    expect(periodFigures(null, null, 500)).toBeNull();
  });
});
