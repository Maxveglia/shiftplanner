import { describe, expect, it } from 'vitest';
import {
  consumption,
  consumptionBreakdown,
  formatQuantity,
  isBelowMinimum,
  onHand,
  onHandBreakdown,
  parsePositiveQuantity,
  parseQuantity,
  refreshProductReaders,
  type InventoryItem,
} from './inventory';
import { queryKeys } from './keys';

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    name: 'Coca-Cola 33 cl',
    unit: 'latas',
    category: 'Bebidas',
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

describe('onHand', () => {
  it('is the last count plus what came in after it', () => {
    expect(onHand(item({ last_quantity: 20, received_since_count: 24 }))).toBe(44);
  });

  it('is the last count when nothing came in', () => {
    expect(onHand(item({ last_quantity: 20 }))).toBe(20);
    expect(onHand(item({ last_quantity: 0 }))).toBe(0);
  });

  it('is 0 for a product that has not moved yet: never "not counted"', () => {
    // Max, 28-sep-2026: a product just added needs no count to have a figure.
    expect(onHand(item())).toBe(0);
  });

  it('is everything delivered for a product never counted', () => {
    // The server sums every delivery while there is no count: two trucks, 12 and 1.
    expect(onHand(item({ received_since_count: 13 }))).toBe(13);
    expect(onHand(item({ received_since_count: 12.5 }))).toBe(12.5);
  });

  it('adds decimals without float noise', () => {
    expect(onHand(item({ last_quantity: 20.1, received_since_count: 0.2 }))).toBe(20.3);
  });

  it('takes off what the sales after the count took', () => {
    // 120 counted, a delivery of 48, 30 sold since: 138.
    expect(onHand(item({ last_quantity: 120, received_since_count: 48, sold_since_count: 30 }))).toBe(138);
    expect(onHand(item({ last_quantity: 10, sold_since_count: 3.75 }))).toBe(6.25);
    expect(onHand(item({ last_quantity: 0.6, sold_since_count: 0.5 }))).toBe(0.1);
  });

  it('is deliveries minus sales for a product never counted', () => {
    expect(onHand(item({ received_since_count: 48, sold_since_count: 30 }))).toBe(18);
  });

  it('goes below zero when more was sold than came in, and says so', () => {
    expect(onHand(item({ last_quantity: 2, sold_since_count: 3.75 }))).toBe(-1.75);
    // Sold, never counted, nothing delivered: known, and negative.
    expect(onHand(item({ sold_since_count: 0.5 }))).toBe(-0.5);
  });
});

describe('onHandBreakdown', () => {
  it('is nothing to explain when the figure is the count alone, or nothing has moved', () => {
    expect(onHandBreakdown(item({ last_quantity: 20 }))).toBeNull();
    expect(onHandBreakdown(item())).toBeNull();
  });

  it('is the count, what came in and what was sold', () => {
    expect(onHandBreakdown(item({ last_quantity: 120, received_since_count: 48, sold_since_count: 30 }))).toEqual({
      counted: 120,
      received: 48,
      sold: 30,
    });
    expect(onHandBreakdown(item({ last_quantity: 10, sold_since_count: 3.75 }))).toEqual({
      counted: 10,
      received: 0,
      sold: 3.75,
    });
  });

  it('has no count for a product never counted', () => {
    expect(onHandBreakdown(item({ received_since_count: 48, sold_since_count: 30 }))).toEqual({
      counted: null,
      received: 48,
      sold: 30,
    });
    expect(onHandBreakdown(item({ received_since_count: 13 }))).toEqual({ counted: null, received: 13, sold: 0 });
  });
});

describe('consumption', () => {
  it('is what there was, plus what came in between, minus what was left', () => {
    // 20 at the first count, a case of 24 in between, 30 at the second: 14 went.
    const it1 = item({ previous_quantity: 20, received_between_counts: 24, last_quantity: 30 });
    expect(consumption(it1)).toBe(14);
  });

  it('is the plain difference when nothing came in between', () => {
    expect(consumption(item({ previous_quantity: 20, received_between_counts: 0, last_quantity: 5 }))).toBe(15);
  });

  it('is negative when the second count found more than could be there', () => {
    // 20, nothing delivered, then 32 on the shelf: 12 more than expected.
    expect(consumption(item({ previous_quantity: 20, received_between_counts: 0, last_quantity: 32 }))).toBe(-12);
  });

  it('is unknown with fewer than two counts', () => {
    expect(consumption(item())).toBeNull();
    expect(consumption(item({ last_quantity: 10 }))).toBeNull();
  });

  it('ignores what came in after the last count', () => {
    const it1 = item({
      previous_quantity: 20,
      received_between_counts: 0,
      last_quantity: 5,
      received_since_count: 48,
    });
    expect(consumption(it1)).toBe(15);
  });

  it('is unknown when the two counts are the same instant', () => {
    const same = item({
      previous_quantity: 5,
      previous_counted_at: '2026-09-04T10:15:00Z',
      last_quantity: 4,
      last_counted_at: '2026-09-04T12:15:00+02:00',
      received_between_counts: 0,
    });
    expect(consumption(same)).toBeNull();
    expect(consumption({ ...same, last_counted_at: '2026-09-04T10:16:00Z' })).toBe(1);
  });

  it('reads a missing between-sum as nothing delivered', () => {
    expect(consumption(item({ previous_quantity: 8, last_quantity: 3 }))).toBe(5);
  });

  it('is what really went, sales or not', () => {
    // 20, 24 in, 30 left: 14 went, whatever the sales say they took.
    const it1 = item({ previous_quantity: 20, received_between_counts: 24, last_quantity: 30, sold_between_counts: 10 });
    expect(consumption(it1)).toBe(14);
  });
});

describe('consumptionBreakdown', () => {
  it('splits what went into what the sales took and what they do not explain', () => {
    // 14 went; the sales took 10; 4 is waste, or portions over the recipe.
    const it1 = item({ previous_quantity: 20, received_between_counts: 24, last_quantity: 30, sold_between_counts: 10 });
    expect(consumptionBreakdown(it1)).toEqual({ total: 14, bySales: 10, unexplained: 4, surplus: 0 });
  });

  it('has nothing unexplained when the sales account for it all', () => {
    const it1 = item({ previous_quantity: 5, received_between_counts: 0, last_quantity: 1.25, sold_between_counts: 3.75 });
    expect(consumptionBreakdown(it1)).toEqual({ total: 3.75, bySales: 3.75, unexplained: 0, surplus: 0 });
  });

  it('is a surplus when the count found more than the sales should have left', () => {
    // 10, the sales took 8, and 5 were left: 3 more than expected.
    const it1 = item({ previous_quantity: 10, received_between_counts: 0, last_quantity: 5, sold_between_counts: 8 });
    expect(consumptionBreakdown(it1)).toEqual({ total: 5, bySales: 8, unexplained: 0, surplus: 3 });
  });

  it('without sales, is today’s figure, and a negative one is its surplus', () => {
    expect(consumptionBreakdown(item({ previous_quantity: 20, received_between_counts: 0, last_quantity: 5 }))).toEqual({
      total: 15,
      bySales: 0,
      unexplained: 15,
      surplus: 0,
    });
    expect(consumptionBreakdown(item({ previous_quantity: 20, received_between_counts: 0, last_quantity: 32 }))).toEqual({
      total: -12,
      bySales: 0,
      unexplained: 0,
      surplus: 12,
    });
  });

  it('subtracts without float noise', () => {
    const it1 = item({ previous_quantity: 1, received_between_counts: 0, last_quantity: 0.4, sold_between_counts: 0.5 });
    expect(consumptionBreakdown(it1)).toEqual({ total: 0.6, bySales: 0.5, unexplained: 0.1, surplus: 0 });
  });

  it('is unknown with fewer than two counts', () => {
    expect(consumptionBreakdown(item({ last_quantity: 10, sold_between_counts: null }))).toBeNull();
  });
});

describe('isBelowMinimum', () => {
  it('goes by what is on the shelf now, so a delivery lifts it', () => {
    expect(isBelowMinimum(item({ min_quantity: 30, last_quantity: 20 }))).toBe(true);
    expect(isBelowMinimum(item({ min_quantity: 30, last_quantity: 20, received_since_count: 24 }))).toBe(false);
  });

  it('is not low at exactly the minimum', () => {
    expect(isBelowMinimum(item({ min_quantity: 20, last_quantity: 20 }))).toBe(false);
  });

  it('is never low without a minimum', () => {
    expect(isBelowMinimum(item({ last_quantity: 0 }))).toBe(false);
    expect(isBelowMinimum(item())).toBe(false);
  });

  it('is low for a product with a minimum that has not moved yet: it has 0', () => {
    expect(isBelowMinimum(item({ min_quantity: 5 }))).toBe(true);
    expect(isBelowMinimum(item({ min_quantity: 0 }))).toBe(false);
  });

  it('goes by the deliveries for a product never counted', () => {
    expect(isBelowMinimum(item({ min_quantity: 5, received_since_count: 1 }))).toBe(true);
    expect(isBelowMinimum(item({ min_quantity: 10, received_since_count: 11 }))).toBe(false);
  });

  it('goes by the sales too, so a day of them can put it on the list', () => {
    expect(isBelowMinimum(item({ min_quantity: 5, last_quantity: 8 }))).toBe(false);
    expect(isBelowMinimum(item({ min_quantity: 5, last_quantity: 8, sold_since_count: 3.75 }))).toBe(true);
    expect(isBelowMinimum(item({ min_quantity: 0, last_quantity: 1, sold_since_count: 2 }))).toBe(true);
  });
});

describe('parseQuantity', () => {
  it('reads a comma or a point', () => {
    expect(parseQuantity('12,5')).toBe(12.5);
    expect(parseQuantity(' 12.5 ')).toBe(12.5);
    expect(parseQuantity('0')).toBe(0);
  });

  it('refuses blanks, words and negatives', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('doce')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
  });
});

describe('parsePositiveQuantity', () => {
  it('takes above 0, with a comma or a point, up to 3 decimals', () => {
    expect(parsePositiveQuantity('24')).toBe(24);
    expect(parsePositiveQuantity('12,5')).toBe(12.5);
    expect(parsePositiveQuantity(' 0.125 ')).toBe(0.125);
    expect(parsePositiveQuantity('999999999.999')).toBe(999999999.999);
  });

  it('refuses 0, a fourth decimal, a billion, and what is not a plain number', () => {
    for (const bad of ['', '0', '0,000', '1,2345', '1000000000', '1e9', '1e3', '-3', 'doce', '1.2.3', '12,']) {
      expect(parsePositiveQuantity(bad)).toBeNull();
    }
  });
});

describe('formatQuantity', () => {
  it('shows what the server keeps: up to 3 decimals, no grouping', () => {
    expect(formatQuantity(20.125)).toMatch(/^20[.,]125$/);
    expect(formatQuantity(0.1 + 0.2)).toMatch(/^0[.,]3$/);
    expect(formatQuantity(1234567)).toBe('1234567');
    expect(formatQuantity(24)).toBe('24');
  });

  it('writes below zero with the minus sign, not a hyphen', () => {
    expect(formatQuantity(-30)).toBe('−30');
    expect(formatQuantity(-0.4)).toMatch(/^−0[.,]4$/);
    expect(formatQuantity(-30)).not.toContain('-');
  });

  it('puts no sign on what rounds to 0', () => {
    expect(formatQuantity(-0.0001)).toBe('0');
    expect(formatQuantity(-0)).toBe('0');
  });
});

describe('refreshProductReaders', () => {
  it('refreshes the recipes too: a product created, renamed or archived makes or breaks the automatic link', async () => {
    const asked: unknown[] = [];
    let stockDone = false;
    const qc = {
      invalidateQueries: ({ queryKey }: { queryKey?: readonly unknown[] }) => {
        asked.push(queryKey);
        return queryKey === queryKeys.inventory
          ? new Promise<void>((resolve) => setTimeout(() => ((stockDone = true), resolve()), 0))
          : Promise.resolve();
      },
    };
    await refreshProductReaders(qc as never);
    expect(asked).toContainEqual(queryKeys.recipes);
    expect(asked).toContainEqual(queryKeys.inventory);
    // What the form waits for is the stock's lists.
    expect(stockDone).toBe(true);
  });
});
