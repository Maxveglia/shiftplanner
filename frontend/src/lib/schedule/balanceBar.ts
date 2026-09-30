// Turning a stretch of somebody's contract into a bar.
//
// The bar runs from nothing to the whole stretch: for a 40-hour contract, a
// month is 173 hours and that is the far end. What fills it is the rota.
//
// IT USED TO MEASURE THE DEVIATION, with the contract in the middle and a
// quarter of the expected hours at each end. That answered "is she keeping
// up?" and could not answer the question a manager actually asks in the
// middle of a month -- has this been filled in yet? A month with a fortnight
// unstaffed and a month worked exactly to contract drew the same bar.
//
// So the bar is the stretch, and it carries three things:
//
//   WORKED    the hours behind them, solid.
//   PLANNED   the hours ahead of them that are already on the rota, faint.
//             Where this stops short of the end is what is not staffed yet.
//   TODAY     a mark at the hours the contract asks for BY NOW, which is what
//             turns a length into "ahead" or "behind".
//
// Out here rather than in the component because the arithmetic decides what
// the picture means, and this repository keeps no DOM in its tests on purpose.

export interface BarShape {
  /** Share of the bar already worked, 0..1. */
  worked: number;
  /**
   * Share of the bar on the rota, worked or not, 0..1. Never less than
   * `worked`: hours already behind them are on the rota by definition.
   */
  planned: number;
  /** Where the contract says they should be by today, 0..1, or null. */
  today: number | null;
  /** How they stand against today's mark. */
  lean: 'behind' | 'ahead' | 'level';
  /** Hours still unstaffed: the gap between the rota and the contract. */
  unplanned: number;
  /** True when the rota carries more than the stretch asks for. */
  over: boolean;
}

/**
 * The bar for one stretch.
 *
 * Every share is clamped to the bar. A rota carrying MORE than the contract
 * asks -- a busy month covered by somebody on 20 hours -- fills it and sets
 * `over`, rather than drawing past the end: the figures beside it say by how
 * much, and a bar that overflowed would make two employees' bars mean
 * different lengths.
 */
export function barShape(b: {
  worked: number;
  planned: number;
  expected: number;
  total: number;
}): BarShape {
  const share = (hours: number) =>
    b.total > 0 ? Math.max(0, Math.min(1, hours / b.total)) : 0;

  // A quarter of an hour either way is level. Without a dead band the wording
  // flips on rounding alone, which reads as a problem in the rota rather than
  // in the arithmetic.
  const gap = b.worked - b.expected;
  const lean: BarShape['lean'] =
    Math.abs(gap) < 0.25 ? 'level' : gap > 0 ? 'ahead' : 'behind';

  return {
    worked: share(b.worked),
    planned: share(Math.max(b.planned, b.worked)),
    // No mark before the stretch has started: a line at zero says nothing,
    // and one at the far end would be a verdict the stretch has not earned.
    today: b.total > 0 && b.expected > 0 ? share(b.expected) : null,
    lean,
    unplanned: Math.max(0, Math.round((b.total - b.planned) * 100) / 100),
    over: b.planned > b.total,
  };
}
