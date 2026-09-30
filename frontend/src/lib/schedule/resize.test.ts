import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  draggedInterval,
  movedInterval,
  movedShift,
  onAxis,
  overlapsAny,
  resizeBounds,
  resizedShift,
} from './resize';
import type { Assignment } from './types';

const nineToFive = { startMin: 9 * 60, endMin: 17 * 60 };
const shopHours = { startMin: 8 * 60, endMin: 22 * 60 };

function shift(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    employeeId: 'e1',
    date: '2026-09-07',
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 'band-morning',
    templateName: 'Morning',
    color: '#000',
    isNight: false,
    paidHours: 7.5,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
    ...over,
  };
}

describe('resizeBounds', () => {
  it('is the open window when the person has nothing else that day', () => {
    expect(resizeBounds(nineToFive, shopHours, [])).toEqual({
      minStart: 8 * 60,
      maxEnd: 22 * 60,
    });
  });

  it('stops at the neighbouring shifts of the same person', () => {
    const bounds = resizeBounds(nineToFive, shopHours, [
      { startMin: 6 * 60, endMin: 8 * 60 + 30 },
      { startMin: 18 * 60, endMin: 22 * 60 },
    ]);
    expect(bounds).toEqual({ minStart: 8 * 60 + 30, maxEnd: 18 * 60 });
  });

  it('never fences the shift off its own ground', () => {
    // Placed before the hours changed: it already stands outside the window.
    const early = { startMin: 6 * 60, endMin: 12 * 60 };
    expect(resizeBounds(early, shopHours, []).minStart).toBe(6 * 60);
  });
});

describe('draggedInterval', () => {
  const bounds = { minStart: 8 * 60, maxEnd: 22 * 60 };

  it('snaps the dragged edge to the half hour and leaves the other alone', () => {
    expect(draggedInterval(nineToFive, 'end', 18 * 60 + 10, bounds)).toEqual({
      startMin: 9 * 60,
      endMin: 18 * 60,
    });
    expect(draggedInterval(nineToFive, 'start', 8 * 60 + 40, bounds)).toEqual({
      startMin: 8 * 60 + 30,
      endMin: 17 * 60,
    });
  });

  it('stops at the walls', () => {
    expect(draggedInterval(nineToFive, 'end', 25 * 60, bounds).endMin).toBe(22 * 60);
    expect(draggedInterval(nineToFive, 'start', 2 * 60, bounds).startMin).toBe(8 * 60);
  });

  it('keeps an hour of shift rather than crossing the other edge', () => {
    expect(draggedInterval(nineToFive, 'end', 7 * 60, bounds).endMin).toBe(10 * 60);
    expect(draggedInterval(nineToFive, 'start', 20 * 60, bounds).startMin).toBe(16 * 60);
  });

  it('leaves a shift with no room to give exactly as it is', () => {
    const stub = { startMin: 9 * 60, endMin: 9 * 60 + 30 };
    expect(draggedInterval(stub, 'start', 0, { minStart: 9 * 60, maxEnd: 9 * 60 + 30 })).toEqual(stub);
  });
});

describe('resizedShift', () => {
  it('becomes manual and is paid for its new length', () => {
    const grown = resizedShift(shift(), { startMin: 9 * 60, endMin: 18 * 60 });
    expect(grown.source).toBe('manual');
    expect(grown.startMin).toBe(9 * 60);
    expect(grown.endMin).toBe(18 * 60);
    // Nine hours, half an hour unpaid: the synthetic rule for a band shift.
    expect(grown.paidHours).toBe(8.5);
  });

  it('drops the synthetic break when trimmed under six hours', () => {
    const cut = resizedShift(shift(), { startMin: 9 * 60, endMin: 14 * 60 });
    expect(cut.paidHours).toBe(5);
  });

  it('keeps a template shift with its own break and its own name', () => {
    const fromTemplate = shift({
      templateId: 't-1',
      templateName: 'Apertura',
      paidHours: 7, // eight hours with an hour off the clock
    });
    const grown = resizedShift(fromTemplate, { startMin: 9 * 60, endMin: 19 * 60 });
    expect(grown.paidHours).toBe(9);
    expect(grown.templateId).toBe('t-1');
    expect(grown.templateName).toBe('Apertura');
  });

  it('recolours a band shift dragged into another time of day', () => {
    const evening = resizedShift(shift(), { startMin: 16 * 60, endMin: 23 * 60 });
    expect(evening.templateId).not.toBe('band-morning');
    expect(evening.templateId.startsWith('band-')).toBe(true);
  });
});

describe('onAxis', () => {
  it('counts whole days regardless of daylight saving', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-09-07', '2026-09-06')).toBe(-1);
  });

  it('moves yesterday and tomorrow onto the shift’s own axis', () => {
    const yesterday = shift({ date: '2026-09-06', startMin: 22 * 60, endMin: 26 * 60 });
    expect(onAxis(yesterday, '2026-09-07')).toEqual({
      startMin: -2 * 60,
      endMin: 2 * 60,
    });
    const tomorrow = shift({ date: '2026-09-08', startMin: 9 * 60, endMin: 17 * 60 });
    expect(onAxis(tomorrow, '2026-09-07')).toEqual({
      startMin: 33 * 60,
      endMin: 41 * 60,
    });
  });
});

describe('movedInterval', () => {
  it('carries the whole shift, snapping the distance and keeping the length', () => {
    expect(movedInterval(nineToFive, 100, shopHours)).toEqual({ startMin: 10 * 60 + 30, endMin: 18 * 60 + 30 });
    expect(movedInterval(nineToFive, -40, shopHours)).toEqual({ startMin: 8 * 60 + 30, endMin: 16 * 60 + 30 });
  });

  it('keeps an off-grid quarter rather than rounding it away', () => {
    const quarter = { startMin: 9 * 60 + 15, endMin: 17 * 60 + 15 };
    expect(movedInterval(quarter, 30, shopHours)).toEqual({ startMin: 9 * 60 + 45, endMin: 17 * 60 + 45 });
  });

  it('stops against the walls instead of shrinking', () => {
    expect(movedInterval(nineToFive, 10 * 60, shopHours)).toEqual({ startMin: 14 * 60, endMin: 22 * 60 });
    expect(movedInterval(nineToFive, -5 * 60, shopHours)).toEqual({ startMin: 8 * 60, endMin: 16 * 60 });
  });

  it('never makes a shift outside the walls jump when picked up', () => {
    const early = { startMin: 6 * 60, endMin: 12 * 60 };
    expect(movedInterval(early, 0, shopHours)).toEqual(early);
  });

  it('carries a night shift past midnight on its own axis', () => {
    const bar = { startMin: 18 * 60, endMin: 28 * 60 };
    expect(movedInterval({ startMin: 19 * 60, endMin: 25 * 60 }, 120, bar)).toEqual({ startMin: 21 * 60, endMin: 27 * 60 });
  });
});

describe('overlapsAny', () => {
  it('treats a handover as no overlap', () => {
    expect(overlapsAny(nineToFive, [{ startMin: 17 * 60, endMin: 22 * 60 }])).toBe(false);
    expect(overlapsAny(nineToFive, [{ startMin: 6 * 60, endMin: 9 * 60 }])).toBe(false);
  });

  it('catches a shared minute', () => {
    expect(overlapsAny(nineToFive, [{ startMin: 16 * 60 + 30, endMin: 22 * 60 }])).toBe(true);
    expect(overlapsAny(nineToFive, [{ startMin: 10 * 60, endMin: 11 * 60 }])).toBe(true);
  });
});

describe('movedShift', () => {
  it('changes the person and the hours, and becomes manual', () => {
    const moved = movedShift(shift(), 'e2', { startMin: 10 * 60, endMin: 18 * 60 });
    expect(moved.employeeId).toBe('e2');
    expect(moved.startMin).toBe(10 * 60);
    expect(moved.endMin).toBe(18 * 60);
    expect(moved.paidHours).toBe(7.5);
    expect(moved.source).toBe('manual');
    expect(moved.id).toBe('a1');
  });
});
