// The first gate: is this JSON, before we ask whether it is a legal rota.
//
// Every case here is one a language model actually produces -- a date that does
// not exist, an hour written as a sentence, a shift that ends when it starts.
// None of them should reach `validateSchedule`, and none of them should cost us
// the other eighty-nine shifts in the month.

import { describe, expect, it } from 'vitest';
import { parseProposal } from './proposal';

describe('reads what is well-formed', () => {
  it('turns a clock time into minutes', () => {
    const { shifts } = parseProposal([
      { employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '17:00' },
    ]);
    expect(shifts).toEqual([
      {
        employeeId: 'e1',
        date: '2026-03-02',
        startMin: 540,
        endMin: 1020,
        templateId: null,
      },
    ]);
  });

  it('rolls a night past midnight instead of clipping it', () => {
    // "Ends at two" is 02:00 to a manager and 26:00 to the scheduler. Getting
    // this wrong makes an eight-hour night read as a shift ending before it
    // began -- and `windowFromAnswer` is the one place that decides it.
    const { shifts } = parseProposal([
      { employeeId: 'e1', date: '2026-03-02', start: '22:00', end: '02:00' },
    ]);
    expect(shifts[0].startMin).toBe(22 * 60);
    expect(shifts[0].endMin).toBe(26 * 60);
  });

  it('accepts a close written as 24:00', () => {
    const { shifts } = parseProposal([
      { employeeId: 'e1', date: '2026-03-02', start: '16:00', end: '24:00' },
    ]);
    expect(shifts[0].endMin).toBe(24 * 60);
  });

  it('keeps a template id when one is given', () => {
    const { shifts } = parseProposal([
      {
        employeeId: 'e1',
        date: '2026-03-02',
        start: '09:00',
        end: '17:00',
        templateId: 'tpl1',
      },
    ]);
    expect(shifts[0].templateId).toBe('tpl1');
  });
});

describe('throws out what is not', () => {
  const bad = (item: unknown, reason: string) => {
    const { shifts, rejected } = parseProposal([item]);
    expect(shifts).toEqual([]);
    expect(rejected[0].reason).toBe(reason);
  };

  it('rejects a date that does not exist', () => {
    bad(
      { employeeId: 'e1', date: '2026-02-30', start: '09:00', end: '17:00' },
      'malformed_date',
    );
  });

  it('rejects an hour that is not a clock time', () => {
    bad(
      { employeeId: 'e1', date: '2026-03-02', start: '9am', end: '17:00' },
      'malformed_time',
    );
  });

  it('rejects 24:30, which is not a time', () => {
    bad(
      { employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '24:30' },
      'malformed_time',
    );
  });

  it('rejects a shift that ends when it starts', () => {
    bad(
      { employeeId: 'e1', date: '2026-03-02', start: '10:00', end: '10:00' },
      'zero_length',
    );
  });

  it('rejects a shift with nobody on it', () => {
    bad({ date: '2026-03-02', start: '09:00', end: '17:00' }, 'missing_employee');
  });

  it('rejects a row that is not an object at all', () => {
    bad('lunes: Ana de 9 a 5', 'not_an_object');
  });

  it('survives a response that is not a list', () => {
    expect(parseProposal({ shifts: [] })).toEqual({ shifts: [], rejected: [] });
    expect(parseProposal(null)).toEqual({ shifts: [], rejected: [] });
  });
});

describe('one bad row does not cost the month', () => {
  it('keeps the good shifts and names the bad one', () => {
    const { shifts, rejected } = parseProposal([
      { employeeId: 'e1', date: '2026-03-02', start: '09:00', end: '17:00' },
      { employeeId: 'e2', date: '2026-03-32', start: '09:00', end: '17:00' },
      { employeeId: 'e3', date: '2026-03-02', start: '13:00', end: '21:00' },
    ]);
    expect(shifts.map((s) => s.employeeId)).toEqual(['e1', 'e3']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('malformed_date');
    // The offending row travels with the rejection so a retry can quote it.
    expect(rejected[0].raw).toMatchObject({ employeeId: 'e2' });
  });
});
