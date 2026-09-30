// The nine fields the model never sees, and why each one is ours to compute.

import { describe, expect, it } from 'vitest';
import { materialize } from './materialize';
import { parseProposal } from './proposal';
import { contract, employee, template } from '../../test/factories';
import type { EmployeeOut } from '../../types';

const ANA: EmployeeOut = employee({ id: 'e1', full_name: 'Ana' });

function build(rows: unknown[], employees = [ANA], templates = [] as ReturnType<typeof template>[]) {
  return materialize(parseProposal(rows).shifts, employees, templates);
}

describe('the break, which is the only figure not purely derivable', () => {
  it('takes a real template at its word', () => {
    const tpl = template({ id: 'tpl1', unpaid_break_minutes: 45 });
    const [a] = build(
      [{ employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '17:00', templateId: 'tpl1' }],
      [ANA],
      [tpl],
    );
    expect(a.paidHours).toBe(8 - 0.75);
  });

  it('gives a template-less shift the same break the generator would', () => {
    // Eight hours with no template: half an hour, exactly as a `band-*` shift
    // built by the generator gets. Anything else prices the same Tuesday two
    // ways depending on who placed it.
    const [a] = build([
      { employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '17:00' },
    ]);
    expect(a.paidHours).toBe(7.5);
  });

  it('gives a short shift no break at all', () => {
    const [a] = build([
      { employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '13:00' },
    ]);
    expect(a.paidHours).toBe(4);
  });
});

describe('identity is resolved, not trusted', () => {
  it('derives the band from the clock when the template does not exist', () => {
    const [a] = build([
      {
        employeeId: 'e1',
        date: '2026-03-02',
        start: '09:00',
        end: '13:00',
        templateId: 'a-template-that-was-deleted',
      },
    ]);
    expect(a.templateId).toBe('band-morning');
    expect(a.isNight).toBe(false);
    expect(a.color).toBeTruthy();
  });

  it('marks a night shift as one', () => {
    const [a] = build([
      { employeeId: 'e1', date: '2026-03-02', start: '22:00', end: '02:00' },
    ]);
    expect(a.isNight).toBe(true);
    expect(a.templateId).toBe('band-night');
    expect(a.endMin).toBe(26 * 60);
  });

  it('uses the real template name when there is one', () => {
    const tpl = template({ id: 'tpl1', name: 'Apertura', seed_key: null });
    const [a] = build(
      [{ employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '13:00', templateId: 'tpl1' }],
      [ANA],
      [tpl],
    );
    expect(a.templateName).toBe('Apertura');
    expect(a.templateId).toBe('tpl1');
  });
});

describe('money and hours are ours', () => {
  it('prices at the contracted rate', () => {
    const paid = employee({
      id: 'e1',
      current_contract: contract({ employee_id: 'e1', hourly_rate: 10 }),
    });
    const [a] = build(
      [{ employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '13:00' }],
      [paid],
    );
    expect(a.cost).toBe(40); // 4h at 10, no break, no overtime
  });

  it('accrues overtime past forty hours in the same week', () => {
    const paid = employee({
      id: 'e1',
      current_contract: contract({ employee_id: 'e1', hourly_rate: 10 }),
    });
    // Five ten-hour days, Monday to Friday: 50 paid hours, 10 of them over.
    const rows = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'].map(
      (date) => ({ employeeId: 'e1', date, start: '08:00', end: '18:30' }),
    );
    const built = build(rows, [paid]);
    const total = built.reduce((s, a) => s + a.overtimeHours, 0);
    expect(built.reduce((s, a) => s + a.paidHours, 0)).toBe(50);
    expect(total).toBe(10);
  });

  it('costs a salaried exempt employee nothing marginal', () => {
    const salaried = employee({
      id: 'e1',
      current_contract: contract({
        employee_id: 'e1',
        employment_type: 'exempt_salaried',
        base_annual_salary: 52000,
      }),
    });
    const [a] = build(
      [{ employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '13:00' }],
      [salaried],
    );
    expect(a.cost).toBe(0);
    expect(a.overtimeHours).toBe(0);
  });
});

describe('ids', () => {
  it('does not collide with the generator, whose shifts sit beside these', () => {
    const built = build([
      { employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '13:00' },
      { employeeId: 'e1', date: '2026-03-03', start: '09:00', end: '13:00' },
    ]);
    expect(built.map((a) => a.id)).toEqual(['p1', 'p2']);
    expect(built.every((a) => !a.id.startsWith('a'))).toBe(true);
  });

  it('marks every proposed shift as AI-placed', () => {
    const built = build([
      { employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '13:00' },
    ]);
    expect(built[0].source).toBe('ai');
  });
});
