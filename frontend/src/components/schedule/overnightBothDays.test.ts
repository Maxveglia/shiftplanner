// A night shift shows on both days it touches.
//
// The rule as the business states it: a shift from 22:00 to 06:00 is on
// Monday's calendar AND on Tuesday's, because at five on Tuesday morning
// somebody is at work, and the manager looking at Tuesday must see who.
//
// The day view decided the opposite on purpose -- one shift is drawn once,
// under the day it starts, widening that day's track past midnight -- and
// dayTrack.test.ts pins that decision ("draws a shift that runs past midnight
// whole, under the day it started", which expects Tuesday to be empty). The
// two cannot both hold. Max chose the brief, so this is the test that will
// replace that one; until the day view changes, it is a known gap and the old
// test stays exactly as it is.
//
// Eval case: .claude/evals/reglas-de-turnos/cases/02-nocturno-22-06.md

import { describe, expect } from 'vitest';
import { dayTrack, segmentsForDay } from './dayTrack';
import { day as oneDay, spec } from '../../test/factories';
import { knownGap } from '../../test/knownGap';
import type { Assignment } from '../../lib/schedule/types';

const MONDAY = oneDay('2026-03-02');
const TUESDAY = oneDay('2026-03-03');

/** Open round the clock, so every hour of both days has a column. */
const ALWAYS_OPEN = spec({ openMin: 0, closeMin: 24 * 60, minStaff: 1 });

/** Monday 22:00 to Tuesday 06:00. */
const NIGHT: Assignment = {
  id: 'night',
  employeeId: 'e1',
  date: MONDAY.date,
  startMin: 22 * 60,
  endMin: 30 * 60,
  templateId: 'band-night',
  templateName: 'Noche',
  color: '#1E293B',
  isNight: true,
  paidHours: 8,
  overtimeHours: 0,
  extraHours: 0,
  cost: 0,
  source: 'manual',
};

describe('a shift from 22:00 to 06:00', () => {
  knownGap('also appears on the next day, from 00:00 to 06:00', () => {
    // Called the way DayGrid calls it: each day's track from every shift on
    // screen, and the previous day's track to say what it already drew.
    const shifts = [NIGHT];
    const segments = segmentsForDay(
      shifts,
      TUESDAY.date,
      { date: MONDAY.date, track: dayTrack(ALWAYS_OPEN, MONDAY, shifts) },
      dayTrack(ALWAYS_OPEN, TUESDAY, shifts),
    );

    expect(segments).toContainEqual(
      expect.objectContaining({ assignment: NIGHT, startMin: 0, endMin: 6 * 60 }),
    );
  });
});
