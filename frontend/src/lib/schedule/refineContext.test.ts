// What the model is told about the calendar it is being asked to change.
//
// The context is the whole input to an adjustment: the model never sees the
// screen, only these lines. So a line that reads wrong is not a cosmetic
// problem -- it is the model being lied to, and the manager getting an error
// for a sentence that was fine.

import { describe, expect, it } from 'vitest';
import { buildRefineContext } from './refine';
import { contract, days, employee, spec } from '../../test/factories';
import type { Assignment } from './types';

const WEEK = days('2026-03-02', 5);
const TODAY = new Date(2026, 2, 2);

const ANA = employee({
  id: 'e1',
  full_name: 'Ana',
  current_contract: contract({ id: 'c1', employee_id: 'e1' }),
});

function shift(startMin: number, endMin: number): Assignment {
  return {
    id: 'a1',
    employeeId: 'e1',
    date: '2026-03-02',
    startMin,
    endMin,
    templateId: 'band-night',
    templateName: 'Noche',
    color: '#6366F1',
    isNight: true,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
  };
}

function contextFor(a: Assignment, s = spec({ openMin: 18 * 60, closeMin: 28 * 60 })) {
  return buildRefineContext([ANA], [a], s, WEEK, [], [], 'US-FED', TODAY);
}

describe('a shift that runs past midnight, described to the model', () => {
  it('says which day the end belongs to', () => {
    // Without the marker this line read "6:00 PM-4:00 AM": a shift ending ten
    // hours before it starts. Asked to move it, the model either returned
    // times the caller refused or gave up and called the request unsupported,
    // and the manager saw an error about a sentence that was perfectly clear.
    const text = contextFor(shift(18 * 60, 28 * 60));
    expect(text).toContain('6:00 PM-4:00 AM (+1)');
  });

  it('marks the opening hours the same way', () => {
    const text = contextFor(shift(18 * 60, 28 * 60));
    expect(text).toContain('open 6:00 PM-4:00 AM (+1)');
  });

  it('leaves an ordinary daytime calendar exactly as it was', () => {
    // The marker may never appear before midnight: every existing calendar's
    // context has to be byte-for-byte what it was.
    const text = contextFor(
      shift(9 * 60, 17 * 60),
      spec({ openMin: 9 * 60, closeMin: 17 * 60 }),
    );
    expect(text).toContain('9:00 AM-5:00 PM');
    expect(text).not.toContain('(+1)');
  });
});

describe('the heading the backend cuts this context at', () => {
  // `triage.py` on the server sends only the part of this context ABOVE the
  // shift listing to the small model that resolves dates and names: the
  // horizon and the team are what those resolve against, and several hundred
  // lines of rota are not. It finds that boundary by looking for this exact
  // heading.
  //
  // Renaming it here would not break anything visibly. The small model would
  // simply start receiving a truncated-by-line-count context, resolve dates
  // against a horizon it could no longer see, and get quietly worse -- so the
  // literal is asserted on this side, where it is written.
  it('writes "SHIFTS PLANNED" before the shifts, and the team before that', () => {
    const text = contextFor(shift(9 * 60, 17 * 60));
    const boundary = text.indexOf('SHIFTS PLANNED');

    expect(boundary).toBeGreaterThan(0);
    // Everything the pre-pass needs is above it...
    expect(text.slice(0, boundary)).toContain('Ana');
    expect(text.slice(0, boundary)).toContain('TEAM');
    // ...and the listing it does not need is below.
    expect(text.slice(boundary)).toContain('2026-03-02');
  });
});
