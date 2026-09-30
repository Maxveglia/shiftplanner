// The sales list, as a day book: one heading per day, newest day first, with
// what the day came to beside it, and the period's total over all of it.
//
// A voided sale stays in the list, where it happened, marked -- it is part of
// the record -- and adds nothing to any figure: not the day's, not the
// period's. The server's statistics leave it out the same way.

import { isVoided, type StoreSaleSummary } from '../../api/store';

export interface SalesDay {
  /** YYYY-MM-DD. */
  date: string;
  /** Every sale of the day, the voided ones included. */
  sales: StoreSaleSummary[];
  /** In euros, added in cents, over the sales that stand. */
  total: number;
}

/**
 * Grouped by `sold_on`, newest day first; within a day, as the server sent
 * them (the newest entered first). The server already sends them in that
 * order, and this does not depend on it: a list sorted twice is the same.
 */
export function groupSalesByDay(sales: readonly StoreSaleSummary[]): SalesDay[] {
  const byDay = new Map<string, StoreSaleSummary[]>();
  for (const sale of sales) {
    const list = byDay.get(sale.sold_on);
    if (list) list.push(sale);
    else byDay.set(sale.sold_on, [sale]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, sales: list, total: sumStanding(list) }));
}

/** Euros added in whole cents, so ten sales of 0,10 € come to 1 € and not 0,9999999. */
export function sumMoney(values: readonly number[]): number {
  return values.reduce((cents, v) => cents + Math.round(v * 100), 0) / 100;
}

/** What the sales that were not voided come to. */
export function sumStanding(sales: readonly StoreSaleSummary[]): number {
  return sumMoney(sales.filter((s) => !isVoided(s)).map((s) => s.total));
}

/**
 * What the Sales header says the period came to: the server's sum over the
 * whole period (GET /store/stats) when it is in; until then the list's own,
 * if the list is whole; else nothing, and the header shows a dash. Never the
 * sum of a list cut at `limit`, which is short by everything older than it.
 * Either argument is null while it is not for these days yet (loading, or a
 * placeholder from the days shown before). Voided sales count in neither the
 * total nor the number of sales -- the server's statistics leave them out,
 * and the list's stand-in must say the same figure.
 */
export function periodFigures(
  stats: { total: number; sales_count: number } | null,
  list: readonly StoreSaleSummary[] | null,
  limit: number,
): { total: number; count: number } | null {
  if (stats) return { total: stats.total, count: stats.sales_count };
  if (list && list.length < limit) {
    return { total: sumStanding(list), count: list.filter((s) => !isVoided(s)).length };
  }
  return null;
}
