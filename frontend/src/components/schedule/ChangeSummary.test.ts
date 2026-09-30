import { afterEach, describe, expect, it } from 'vitest';
import { describeDiff } from './ChangeSummary';
import { diffAssignments } from '../../lib/schedule/diff';
import { setLanguage, translate } from '../../lib/i18n/core';
import { employee } from '../../test/factories';
import type { Assignment } from '../../lib/schedule/types';

function shift(over: Partial<Assignment> & { employeeId: string; date: string }): Assignment {
  return {
    id: 'x',
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

const PEOPLE = [
  employee({ id: 'e1', full_name: 'Sarah' }),
  employee({ id: 'e2', full_name: 'Luis' }),
];
const FRI = '2026-03-06';

describe('describeDiff — the line under the adjustment bar', () => {
  afterEach(() => setLanguage('en'));

  it('says who is off and who covers, in Spanish', () => {
    setLanguage('es');
    const diff = diffAssignments(
      [shift({ employeeId: 'e1', date: FRI })],
      [shift({ employeeId: 'e2', date: FRI, startMin: 16 * 60, endMin: 22 * 60 })],
    );
    expect(describeDiff(diff, PEOPLE, translate)).toEqual([
      'Sarah: viernes 6 fuera (09:00–17:00).',
      'Luis cubre el viernes 6, 16:00–22:00.',
    ]);
  });

  it('says a move as one line', () => {
    setLanguage('en');
    const diff = diffAssignments(
      [shift({ employeeId: 'e1', date: FRI })],
      [shift({ employeeId: 'e1', date: FRI, startMin: 12 * 60, endMin: 20 * 60 })],
    );
    expect(describeDiff(diff, PEOPLE, translate)).toEqual([
      'Sarah: 6 Friday now 12:00 PM–8:00 PM, was 9:00 AM–5:00 PM.',
    ]);
  });
});
