// Every shift has a post.
//
// This product has no separate notion of a post (barra, cocina, sala): what a
// shift is FOR is the template it was cut from -- a named slot of the day --
// or, for one the generator synthesised, the time band it falls in. So "every
// shift has a post" reads here as "every shift carries a real template or band
// name".
//
// The server allows a shift with no template at all
// (`assignment.shift_template_id` is nullable, and ON DELETE SET NULL), and the
// browser reads one back as a placeholder: the generic word for "shift", in
// grey, under the id 'unknown' (`orphanTemplate` in ./persist).
//
// That is not a rare case. `toShiftPayload` sends null for every id that is
// not a real template -- every `band-*` shift, which is every shift the
// generator synthesised, placed by hand or added by a refine -- so all of them
// come back from a save as that placeholder (see the note in ./draftSync).
//
// Eval case: .claude/evals/reglas-de-turnos/cases/05-turno-con-puesto.md

import { describe, expect, it } from 'vitest';
import { fromAssignmentOut, toShiftPayload } from './persist';
import { shiftAppearance } from './bands';
import { translate } from '../i18n/core';
import { template } from '../../test/factories';
import { knownGap } from '../../test/knownGap';
import type { AssignmentOut } from '../../types';
import type { Assignment } from './types';

const BAR = template({ id: 'tpl-bar', name: 'Barra', start_time: '18:00', end_time: '02:00' });

function row(shiftTemplateId: string | null): AssignmentOut {
  return {
    id: 'a1',
    employee_id: 'e1',
    start_at: '2026-03-06T18:00:00',
    end_at: '2026-03-07T02:00:00',
    shift_template_id: shiftTemplateId,
    unpaid_break_minutes: 0,
    status: 'published',
    source: 'manual',
    is_overtime: false,
    is_premium: false,
    published_at: null,
  };
}

/** A shift as the generator synthesises one for a business with no templates. */
function bandShift(startMin: number, endMin: number): Assignment {
  const look = shiftAppearance(startMin, endMin);
  return {
    id: 'b1',
    employeeId: 'e1',
    date: '2026-03-06',
    startMin,
    endMin,
    templateId: `band-${look.bandKey}`,
    templateName: look.label,
    color: look.color,
    isNight: look.isNight,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
  };
}

describe('a shift read back from the server', () => {
  it('carries the name of the template it was cut from', () => {
    const a = fromAssignmentOut(row(BAR.id), [BAR]);
    expect([a.templateId, a.templateName]).toEqual(['tpl-bar', 'Barra']);
  });

  knownGap('carries a real post even when it has no template', () => {
    const a = fromAssignmentOut(row(null), [BAR]);

    expect(a.templateName.trim()).not.toBe('');
    expect(a.templateName).not.toBe(translate('roster.shift.untitled'));
  });

  knownGap('keeps the name of its time band through a save and a reload', () => {
    const placed = bandShift(18 * 60, 26 * 60);
    const saved: AssignmentOut = {
      ...toShiftPayload(placed),
      id: placed.id,
      status: 'draft',
      published_at: null,
    };

    expect(fromAssignmentOut(saved, []).templateName).toBe(placed.templateName);
  });
});
