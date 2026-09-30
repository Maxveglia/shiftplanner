// Editing by hand, in the same half hours the drag handles already move in.
//
// The resize has snapped to 30 minutes since it was written. Creating a shift
// did not: the grid drew a column per hour and passed the hour back, so a bar
// that opens at 18:00 could be given a shift at 18:00 or at 19:00 and nothing
// in between — while the same shift, once created, could be dragged to
// 18:30. One control could express what the other could not.

import { describe, expect, it } from 'vitest';
import { manualShift } from './generate';
import { RESIZE_STEP_MIN } from './resize';
import { spec as makeSpec } from '../../test/factories';

const BAR = makeSpec({ openMin: 17 * 60, closeMin: 27 * 60 });

describe('a shift placed by hand', () => {
  it('starts on the half hour that was pressed', () => {
    const half = manualShift('e1', '2026-10-05', 18 * 60 + 30, [], BAR, 1);
    expect(half.startMin).toBe(18 * 60 + 30);
    expect(half.endMin).toBe(19 * 60 + 30);
  });

  it('still starts on the hour when the hour was pressed', () => {
    const hour = manualShift('e1', '2026-10-05', 18 * 60, [], BAR, 1);
    expect(hour.startMin).toBe(18 * 60);
    expect(hour.endMin).toBe(19 * 60);
  });

  it('never starts before the business opens', () => {
    // Pressing the half hour before opening is a press on a closed column;
    // the grid does not offer it, and this is the belt to that braces.
    const early = manualShift('e1', '2026-10-05', 16 * 60 + 30, [], BAR, 1);
    expect(early.startMin).toBe(17 * 60);
  });

  it('moves in the same step the resize handles do', () => {
    // If one of these ever changes, the two controls disagree about what a
    // manager can express, which is the bug this file exists for.
    expect(RESIZE_STEP_MIN).toBe(30);
    const a = manualShift('e1', '2026-10-05', 18 * 60, [], BAR, 1);
    const b = manualShift('e1', '2026-10-05', 18 * 60 + RESIZE_STEP_MIN, [], BAR, 2);
    expect(b.startMin - a.startMin).toBe(RESIZE_STEP_MIN);
  });

  it('is priced and labelled like any other shift', () => {
    const half = manualShift('e1', '2026-10-05', 22 * 60 + 30, [], BAR, 1);
    expect(half.paidHours).toBe(1);
    expect(half.source).toBe('manual');
    expect(half.templateName).toBeTruthy();
  });
});
