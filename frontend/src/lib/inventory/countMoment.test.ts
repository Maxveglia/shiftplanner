import { describe, expect, it } from 'vitest';
import {
  businessClock,
  countStamp,
  defaultCountMoment,
  instantOfLocalInput,
  localInputOf,
  momentDay,
  msToNextMinute,
} from './countMoment';

// Every instant here is written in UTC (or with its offset), never as a bare
// local time: CI runs in UTC and Max's Mac in whatever zone he is in, and the
// answers are Madrid's in both. Summer is CEST (UTC+2), winter CET (UTC+1).
const at = (iso: string) => new Date(iso);

describe('businessClock', () => {
  it('reads the instant on the wall clock of Madrid', () => {
    expect(businessClock(at('2026-09-27T21:55:00Z'))).toEqual({ day: '2026-09-27', hour: 23 });
    expect(businessClock(at('2026-09-27T22:25:00Z'))).toEqual({ day: '2026-09-28', hour: 0 });
    expect(businessClock(at('2026-12-15T23:25:00Z'))).toEqual({ day: '2026-12-16', hour: 0 });
  });

  it('is nothing for an invalid date', () => {
    expect(businessClock(new Date('nope'))).toBeNull();
  });
});

describe('defaultCountMoment', () => {
  it('is after closing at 23:55 in Madrid, and still at 00:25', () => {
    expect(defaultCountMoment(at('2026-09-27T21:55:00Z'))).toBe('after_close'); // 23:55 CEST
    expect(defaultCountMoment(at('2026-09-27T22:25:00Z'))).toBe('after_close'); // 00:25 CEST
    expect(defaultCountMoment(at('2026-12-15T22:55:00Z'))).toBe('after_close'); // 23:55 CET
    expect(defaultCountMoment(at('2026-12-15T23:25:00Z'))).toBe('after_close'); // 00:25 CET
  });

  it('turns to before opening at 06:00 in Madrid, summer and winter', () => {
    expect(defaultCountMoment(at('2026-09-28T03:59:00Z'))).toBe('after_close'); // 05:59 CEST
    expect(defaultCountMoment(at('2026-09-28T04:00:00Z'))).toBe('before_open'); // 06:00 CEST
    expect(defaultCountMoment(at('2026-12-16T04:59:00Z'))).toBe('after_close'); // 05:59 CET
    expect(defaultCountMoment(at('2026-12-16T05:00:00Z'))).toBe('before_open'); // 06:00 CET
  });

  it('turns back to after closing at noon in Madrid, summer and winter', () => {
    expect(defaultCountMoment(at('2026-09-27T09:59:00Z'))).toBe('before_open'); // 11:59 CEST
    expect(defaultCountMoment(at('2026-09-27T10:00:00Z'))).toBe('after_close'); // 12:00 CEST
    expect(defaultCountMoment(at('2026-12-15T10:59:00Z'))).toBe('before_open'); // 11:59 CET
    expect(defaultCountMoment(at('2026-12-15T11:00:00Z'))).toBe('after_close'); // 12:00 CET
  });

  it('goes by Madrid for a browser in New York', () => {
    // 23:30 in New York is 05:30 of the next day in the shop: a late close.
    expect(defaultCountMoment(at('2026-09-27T23:30:00-04:00'))).toBe('after_close');
    // 07:00 in New York is 13:00 in the shop: the browser's morning is not
    // the shop's, and it is not "before opening".
    expect(defaultCountMoment(at('2026-09-27T07:00:00-04:00'))).toBe('after_close');
    // 02:00 in New York is 08:00 in the shop: before opening there.
    expect(defaultCountMoment(at('2026-09-28T02:00:00-04:00'))).toBe('before_open');
  });

  it('is the same on the night the clocks go back', () => {
    // 25-oct-2026: 02:30 comes twice in Madrid, CEST then CET.
    expect(defaultCountMoment(at('2026-10-25T00:30:00Z'))).toBe('after_close');
    expect(defaultCountMoment(at('2026-10-25T01:30:00Z'))).toBe('after_close');
  });
});

describe('momentDay', () => {
  it('names the count’s own day before opening, by Madrid’s calendar', () => {
    expect(momentDay(at('2026-09-28T00:30:00Z'), 'before_open')).toBe('2026-09-28'); // 02:30 CEST
    expect(momentDay(at('2026-09-28T07:00:00Z'), 'before_open')).toBe('2026-09-28'); // 09:00 CEST
    // 00:25 in Madrid is still the 27th in UTC: the day is Madrid's.
    expect(momentDay(at('2026-09-27T22:25:00Z'), 'before_open')).toBe('2026-09-28');
  });

  it('names the day being closed after closing: the day before, in the small hours', () => {
    expect(momentDay(at('2026-09-27T21:55:00Z'), 'after_close')).toBe('2026-09-27'); // 23:55 CEST
    expect(momentDay(at('2026-09-27T22:25:00Z'), 'after_close')).toBe('2026-09-27'); // 00:25 CEST
    expect(momentDay(at('2026-09-28T03:59:00Z'), 'after_close')).toBe('2026-09-27'); // 05:59 CEST
    expect(momentDay(at('2026-09-28T04:00:00Z'), 'after_close')).toBe('2026-09-28'); // 06:00 CEST
    expect(momentDay(at('2026-12-15T23:25:00Z'), 'after_close')).toBe('2026-12-15'); // 00:25 CET
    expect(momentDay(at('2026-12-16T05:00:00Z'), 'after_close')).toBe('2026-12-16'); // 06:00 CET
    // Across a month.
    expect(momentDay(at('2026-09-30T23:00:00Z'), 'after_close')).toBe('2026-09-30'); // 01:00 CEST, 1-oct
  });

  it('goes by Madrid for a browser in New York', () => {
    // 23:30 of the 27th in New York is 05:30 of the 28th in the shop: after
    // closing it closes the 27th; before opening, the 28th's sales are to come.
    const lateInNewYork = at('2026-09-27T23:30:00-04:00');
    expect(momentDay(lateInNewYork, 'after_close')).toBe('2026-09-27');
    expect(momentDay(lateInNewYork, 'before_open')).toBe('2026-09-28');
  });

  it('is null for an invalid date', () => {
    expect(momentDay(new Date('nope'), 'after_close')).toBeNull();
  });
});

describe('countStamp', () => {
  // The field as the browser would show a given instant, whatever zone this
  // runs in.
  const fieldAt = (iso: string) => localInputOf(at(iso));

  it('untouched, is now -- not the time the field was last refreshed', () => {
    const now = at('2026-09-27T10:00:20Z'); // 12:00:20 CEST
    const stamp = countStamp({ field: fieldAt('2026-09-27T09:59:00Z'), touched: false, picked: null, now });
    expect(stamp?.at.toISOString()).toBe('2026-09-27T10:00:20.000Z');
    // The moment the manager did not pick comes from that same now.
    expect(stamp?.moment).toBe('after_close');
  });

  it('untouched, keeps the moment the manager picked', () => {
    const now = at('2026-09-27T10:00:20Z');
    expect(countStamp({ field: '', touched: false, picked: 'before_open', now })?.moment).toBe('before_open');
  });

  it('touched, is the field, and the moment follows it', () => {
    const now = at('2026-09-27T18:00:00Z');
    const stamp = countStamp({ field: fieldAt('2026-09-27T07:30:00Z'), touched: true, picked: null, now });
    expect(stamp?.at.toISOString()).toBe('2026-09-27T07:30:00.000Z');
    expect(stamp?.moment).toBe('before_open'); // 09:30 in Madrid
    const picked = countStamp({ field: fieldAt('2026-09-27T07:30:00Z'), touched: true, picked: 'after_close', now });
    expect(picked?.moment).toBe('after_close');
  });

  it('touched and emptied, is nothing', () => {
    expect(countStamp({ field: '', touched: true, picked: null, now: new Date() })).toBeNull();
  });
});

describe('the field', () => {
  it('reads back the instant it shows, to the minute, in any zone', () => {
    const instant = at('2026-09-27T22:25:41Z');
    expect(localInputOf(instant)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(instantOfLocalInput(localInputOf(instant))?.toISOString()).toBe('2026-09-27T22:25:00.000Z');
  });

  it('is nothing for a field that is not a date and time', () => {
    expect(instantOfLocalInput('')).toBeNull();
    expect(instantOfLocalInput('09:30')).toBeNull();
    expect(instantOfLocalInput('2026-09-27')).toBeNull();
  });
});

describe('msToNextMinute', () => {
  it('waits for the minute to change, and a little more', () => {
    expect(msToNextMinute(at('2026-09-27T10:00:20Z'))).toBe(40_050);
    expect(msToNextMinute(at('2026-09-27T10:00:59.990Z'))).toBe(60);
    expect(msToNextMinute(at('2026-09-27T10:01:00Z'))).toBe(60_050);
  });
});
