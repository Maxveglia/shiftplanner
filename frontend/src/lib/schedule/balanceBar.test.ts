// The bar is the stretch: nothing on the left, the whole month on the right.
//
// It replaced a deviation bar, and the reason is the case at the top of this
// file: a month with a fortnight unstaffed and a month worked exactly to
// contract used to draw the same picture. Both were "on track".

import { describe, expect, it } from 'vitest';
import { barShape } from './balanceBar';

/** A 40-hour contract, four weeks in: 160 hours, half of them elapsed. */
const MONTH = { expected: 80, total: 160 };

describe('the end of the bar is the whole stretch', () => {
  it('fills half the bar for half the hours', () => {
    const bar = barShape({ worked: 80, planned: 80, ...MONTH });
    expect(bar.worked).toBe(0.5);
  });

  it('is proportional to the contract, not to a constant', () => {
    // 80 hours is half of a 40-hour contract's month and the whole of a
    // 20-hour one's. The same hours, two different pictures, because they
    // mean two different things.
    const full = barShape({ worked: 80, planned: 80, expected: 80, total: 160 });
    const part = barShape({ worked: 80, planned: 80, expected: 40, total: 80 });

    expect(full.worked).toBe(0.5);
    expect(part.worked).toBe(1);
  });
});

describe('what is on the rota but not yet worked', () => {
  it('reaches further than what is worked', () => {
    // Half the month behind them, the whole month on the rota.
    const bar = barShape({ worked: 80, planned: 160, ...MONTH });
    expect(bar.worked).toBe(0.5);
    expect(bar.planned).toBe(1);
  });

  it('shows a month that has not been filled in', () => {
    // THE CASE THE OLD BAR COULD NOT DRAW. Keeping up perfectly, and a
    // fortnight of the month still unstaffed.
    const bar = barShape({ worked: 80, planned: 80, ...MONTH });

    expect(bar.lean).toBe('level');
    expect(bar.planned).toBe(0.5);
    expect(bar.unplanned).toBe(80);
  });

  it('is never shorter than what is worked', () => {
    // Hours already behind them are on the rota by definition, whatever a
    // stale figure says.
    const bar = barShape({ worked: 80, planned: 10, ...MONTH });
    expect(bar.planned).toBeGreaterThanOrEqual(bar.worked);
  });
});

describe("today's mark", () => {
  it('sits at the hours the contract asks for by now', () => {
    const bar = barShape({ worked: 60, planned: 160, ...MONTH });
    expect(bar.today).toBe(0.5); // 80 of 160
  });

  it('is what turns a length into ahead or behind', () => {
    expect(barShape({ worked: 60, planned: 160, ...MONTH }).lean).toBe('behind');
    expect(barShape({ worked: 95, planned: 160, ...MONTH }).lean).toBe('ahead');
    expect(barShape({ worked: 80, planned: 160, ...MONTH }).lean).toBe('level');
  });

  it('is absent before the stretch has started', () => {
    // A mark at zero says nothing, and one at the far end would be a verdict
    // the stretch has not earned.
    expect(barShape({ worked: 0, planned: 160, expected: 0, total: 160 }).today)
      .toBeNull();
  });
});

describe('a rota that carries more than the contract asks', () => {
  it('fills the bar rather than drawing past the end', () => {
    const bar = barShape({ worked: 200, planned: 200, ...MONTH });
    expect(bar.worked).toBe(1);
    expect(bar.planned).toBe(1);
  });

  it('says so, since the bar can no longer show by how much', () => {
    expect(barShape({ worked: 80, planned: 200, ...MONTH }).over).toBe(true);
    expect(barShape({ worked: 80, planned: 160, ...MONTH }).over).toBe(false);
  });

  it('has nothing left unplanned', () => {
    expect(barShape({ worked: 80, planned: 200, ...MONTH }).unplanned).toBe(0);
  });
});

describe('a contract with no hours in it', () => {
  it('draws nothing rather than dividing by zero', () => {
    const bar = barShape({ worked: 0, planned: 0, expected: 0, total: 0 });
    expect(bar.worked).toBe(0);
    expect(bar.planned).toBe(0);
    expect(bar.today).toBeNull();
  });
});
