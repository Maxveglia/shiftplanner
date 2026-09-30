import { describe, expect, it } from 'vitest';
import { diffAssignments } from './diff';
import type { Assignment } from './types';

function shift(over: Partial<Assignment> & { employeeId: string; date: string }): Assignment {
  return {
    id: Math.random().toString(36).slice(2),
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 't',
    templateName: 'Day',
    color: '#000',
    isNight: false,
    paidHours: 8,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
    ...over,
  };
}

const FRI = '2026-03-06';
const SAT = '2026-03-07';

describe('diffAssignments — what changed, per person', () => {
  it('reports nothing when the calendars are the same, whatever the ids', () => {
    const a = [shift({ employeeId: 'sarah', date: FRI })];
    const b = [shift({ employeeId: 'sarah', date: FRI })];
    expect(diffAssignments(a, b)).toEqual({ people: [], total: 0 });
  });

  it('a day off is a removal for her and an addition for whoever covers', () => {
    const before = [
      shift({ employeeId: 'sarah', date: FRI }),
      shift({ employeeId: 'luis', date: SAT }),
    ];
    const after = [
      shift({ employeeId: 'luis', date: SAT }),
      shift({ employeeId: 'luis', date: FRI, startMin: 16 * 60, endMin: 22 * 60 }),
    ];
    const diff = diffAssignments(before, after);
    expect(diff.total).toBe(2);
    expect(diff.people).toEqual([
      {
        employeeId: 'sarah',
        removed: [{ date: FRI, startMin: 9 * 60, endMin: 17 * 60 }],
        added: [],
        moved: [],
      },
      {
        employeeId: 'luis',
        removed: [],
        added: [{ date: FRI, startMin: 16 * 60, endMin: 22 * 60 }],
        moved: [],
      },
    ]);
  });

  it('a shift that changed hours on the same day is one move, not two changes', () => {
    const before = [shift({ employeeId: 'sarah', date: FRI, startMin: 9 * 60, endMin: 17 * 60 })];
    const after = [shift({ employeeId: 'sarah', date: FRI, startMin: 12 * 60, endMin: 20 * 60 })];
    const diff = diffAssignments(before, after);
    expect(diff.total).toBe(1);
    expect(diff.people[0].moved).toEqual([
      {
        date: FRI,
        from: { date: FRI, startMin: 9 * 60, endMin: 17 * 60 },
        to: { date: FRI, startMin: 12 * 60, endMin: 20 * 60 },
      },
    ]);
    expect(diff.people[0].added).toEqual([]);
    expect(diff.people[0].removed).toEqual([]);
  });

  it('two removals and one addition on a day are one move and one removal', () => {
    const before = [
      shift({ employeeId: 'sarah', date: FRI, startMin: 9 * 60, endMin: 13 * 60 }),
      shift({ employeeId: 'sarah', date: FRI, startMin: 17 * 60, endMin: 21 * 60 }),
    ];
    const after = [shift({ employeeId: 'sarah', date: FRI, startMin: 10 * 60, endMin: 14 * 60 })];
    const diff = diffAssignments(before, after);
    expect(diff.total).toBe(2);
    expect(diff.people[0].moved).toHaveLength(1);
    expect(diff.people[0].removed).toEqual([
      { date: FRI, startMin: 17 * 60, endMin: 21 * 60 },
    ]);
  });

  it('people come out in the order they were first touched', () => {
    const before = [
      shift({ employeeId: 'luis', date: FRI }),
      shift({ employeeId: 'sarah', date: SAT }),
    ];
    const diff = diffAssignments(before, []);
    expect(diff.people.map((p) => p.employeeId)).toEqual(['luis', 'sarah']);
  });
});
