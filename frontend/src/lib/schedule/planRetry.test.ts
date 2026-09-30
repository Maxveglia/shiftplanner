import { describe, expect, it } from 'vitest';
import { judgeMonths, mergeRetried, monthsToRetry } from './planRetry';
import type { ProposalReport } from './fromProposal';
import type { Violation } from './validate';
import type { Assignment, CoverageGap, ScheduleResult } from './types';

function shift(date: string, paidHours = 8): Assignment {
  return {
    id: `${date}-${Math.random().toString(36).slice(2)}`,
    employeeId: 'ana',
    date,
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 't',
    templateName: 'Day',
    color: '#000',
    isNight: false,
    paidHours,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
  };
}

function calendar(
  assignments: Assignment[],
  gaps: CoverageGap[] = [],
): ScheduleResult {
  return {
    assignments,
    gaps,
    totalCost: 0,
    totalHours: assignments.reduce((h, a) => h + a.paidHours, 0),
    overtimeHours: 0,
    hoursByEmployee: {},
    belowMinimum: [],
  };
}

function report(remaining: Violation[] = []): ProposalReport {
  return {
    proposed: 0,
    malformed: [],
    dropped: [],
    kept: 0,
    filled: 0,
    valid: remaining.length === 0,
    remaining,
  };
}

function gap(date: string, hour: number, missing = 1): CoverageGap {
  return { date, hour, have: 0, need: missing };
}

/** A month of real work to measure the holes against. */
function fullMonth(month: string, days = 20): Assignment[] {
  return Array.from({ length: days }, (_, i) =>
    shift(`${month}-${String(i + 1).padStart(2, '0')}`),
  );
}

describe('judgeMonths — which month came back badly', () => {
  it('leaves a clean month alone', () => {
    const [jan] = judgeMonths(
      ['2026-01'],
      calendar(fullMonth('2026-01')),
      report(),
    );
    expect(jan).toMatchObject({ hardViolations: 0, uncovered: 0, worthRetrying: false });
  });

  // 160 scheduled hours, 6 missing: under one in twenty. A manager closes that
  // by moving a shift; a second call to the expensive model does not earn its
  // price.
  it('leaves a small hole alone on a big month', () => {
    const gaps = Array.from({ length: 6 }, (_, i) => gap('2026-01-05', 9 + i));
    const [jan] = judgeMonths(
      ['2026-01'],
      calendar(fullMonth('2026-01'), gaps),
      report(),
    );
    expect(jan.uncovered).toBe(6);
    expect(jan.scheduled).toBe(160);
    expect(jan.worthRetrying).toBe(false);
  });

  it('asks again when the holes pass one hour in twenty', () => {
    const gaps = Array.from({ length: 12 }, (_, i) => gap('2026-01-05', 6 + i));
    const [jan] = judgeMonths(
      ['2026-01'],
      calendar(fullMonth('2026-01'), gaps),
      report(),
    );
    expect(jan.uncovered).toBe(12);
    expect(jan.worthRetrying).toBe(true);
  });

  // The ratio alone would send a three-person shop back to the model over one
  // uncovered hour, which is the cheap case paying for the expensive one.
  it('ignores the ratio when the hole is under half a shift', () => {
    const [jan] = judgeMonths(
      ['2026-01'],
      calendar([shift('2026-01-02', 4)], [gap('2026-01-02', 9), gap('2026-01-02', 10)]),
      report(),
    );
    expect(jan.uncovered).toBe(2);
    expect(jan.worthRetrying).toBe(false);
  });

  // Never expected to happen -- the survivors are legal and the greedy pass
  // cannot place an illegal shift -- which is exactly why it is worth paying
  // for when it does.
  it('always asks again when a hard rule survived the repair', () => {
    const violation: Violation = {
      kind: 'rest',
      hard: true,
      employeeId: 'ana',
      date: '2026-01-07',
      assignmentIds: [],
      detail: {},
    };
    const [jan] = judgeMonths(
      ['2026-01'],
      calendar(fullMonth('2026-01')),
      report([violation]),
    );
    expect(jan).toMatchObject({ hardViolations: 1, worthRetrying: true });
  });

  it('grades each month on its own hours and its own holes', () => {
    const gaps = Array.from({ length: 12 }, (_, i) => gap('2026-02-05', 6 + i));
    const verdicts = judgeMonths(
      ['2026-01', '2026-02'],
      calendar([...fullMonth('2026-01'), ...fullMonth('2026-02')], gaps),
      report(),
    );
    expect(verdicts.map((v) => v.worthRetrying)).toEqual([false, true]);
  });
});

describe('monthsToRetry', () => {
  it('names the bad months and nothing else', () => {
    const gaps = Array.from({ length: 12 }, (_, i) => gap('2026-02-05', 6 + i));
    const verdicts = judgeMonths(
      ['2026-01', '2026-02'],
      calendar([...fullMonth('2026-01'), ...fullMonth('2026-02')], gaps),
      report(),
    );
    expect(monthsToRetry(verdicts)).toEqual(['2026-02']);
  });

  // A month the model never answered has no proposal to have been bad, and
  // asking it again with MORE thinking to do is the likeliest call in the
  // product to time out twice and be billed for both.
  it('never re-asks a month the planner already failed on', () => {
    const gaps = Array.from({ length: 12 }, (_, i) => gap('2026-02-05', 6 + i));
    const verdicts = judgeMonths(
      ['2026-02'],
      calendar(fullMonth('2026-02'), gaps),
      report(),
    );
    expect(monthsToRetry(verdicts, ['2026-02'])).toEqual([]);
  });
});

describe('mergeRetried', () => {
  it('swaps out the retried months and keeps the rest of the first answer', () => {
    const first = [
      { employeeId: 'ana', date: '2026-01-02' },
      { employeeId: 'ana', date: '2026-02-02' },
    ];
    const again = [{ employeeId: 'luis', date: '2026-02-03' }];
    expect(mergeRetried(first, again, new Set(['2026-02']))).toEqual([
      { employeeId: 'ana', date: '2026-01-02' },
      { employeeId: 'luis', date: '2026-02-03' },
    ]);
  });

  // Both sides are whatever the API returned, and deciding a row is malformed
  // belongs to `parseProposal`, which reports what it drops.
  it('passes unreadable rows through rather than judging them', () => {
    const merged = mergeRetried(
      [null, 'nonsense', { date: '2026-02-02' }],
      [{ date: '2026-02-03' }],
      new Set(['2026-02']),
    );
    expect(merged).toEqual([null, 'nonsense', { date: '2026-02-03' }]);
  });

  it('survives an answer that is not an array at all', () => {
    expect(mergeRetried({ oops: true }, null, new Set(['2026-02']))).toEqual([]);
  });
});
