// One person is one person, however many bars they have.
//
// Reported from production: "es posible poner una hora sobre otra y cuenta
// como si hubieran dos personas". The second half of that sentence is this
// file. Three separate places counted SHIFTS and called the answer people --
// the day grid's coverage strip, the validator's gaps, and the generator's own
// summary -- so a bar that needed two on at nine read as covered with one
// person standing there.

import { describe, expect, it } from 'vitest';
import { peopleAt, peopleAtHour, type CoverageSpan } from './coverage';

const at = (employeeId: string, from: number, to: number): CoverageSpan => ({
  employeeId,
  startMin: from * 60,
  endMin: to * 60,
});

describe('counting who is on shift', () => {
  it('counts one person once, whatever they are working', () => {
    expect(peopleAtHour([at('ana', 17, 22)], 19)).toBe(1);
  });

  it('counts two people as two', () => {
    expect(peopleAtHour([at('ana', 17, 22), at('bruno', 18, 23)], 19)).toBe(2);
  });

  it('counts one person with two shifts on top of each other as ONE', () => {
    // THE BUG, in one line. Pressing an hour Ana already worked used to lay a
    // second shift over the first; from then on the strip said two.
    const doubled = [at('ana', 17, 22), at('ana', 18, 20)];
    expect(peopleAtHour(doubled, 19)).toBe(1);
  });

  it('does not let a doubled person hide a real shortage', () => {
    // The consequence that costs money: a bar needing two at 19:00, with Ana
    // doubled and nobody else, is short one person and has to say so.
    const need = 2;
    const have = peopleAtHour([at('ana', 17, 22), at('ana', 18, 20)], 19);
    expect(have).toBe(1);
    expect(have < need).toBe(true);
  });

  it('counts a split day as one person', () => {
    // Two separate stretches, same person, same date: legitimate, and at any
    // given minute only one of them is running.
    const split = [at('ana', 12, 16), at('ana', 20, 24)];
    expect(peopleAtHour(split, 14)).toBe(1);
    expect(peopleAtHour(split, 22)).toBe(1);
    expect(peopleAtHour(split, 18)).toBe(0);
  });
});

describe('the edges of a shift', () => {
  it('counts somebody from the minute they start', () => {
    expect(peopleAt([at('ana', 17, 22)], 17 * 60)).toBe(1);
  });

  it('does not count them at the minute they finish', () => {
    // Half-open, so a handover at 22:00 is one person leaving and one
    // arriving -- not two people for that minute.
    expect(peopleAt([at('ana', 17, 22)], 22 * 60)).toBe(0);
    expect(peopleAt([at('ana', 17, 22), at('bruno', 22, 26)], 22 * 60)).toBe(1);
  });

  it('follows a shift past midnight', () => {
    // The track runs past 1440 for a night worked into the small hours, and
    // the count has to follow it there -- a bar open until four is covered at
    // three.
    expect(peopleAt([at('ana', 17, 28)], 27 * 60)).toBe(1);
  });

  it('counts nobody on an empty hour', () => {
    expect(peopleAtHour([], 19)).toBe(0);
  });
});
