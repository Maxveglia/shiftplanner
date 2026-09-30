// The day a window starts on has to survive the trip to the server.

import { describe, expect, it } from 'vitest';
import { localIso } from './workday';

describe('localIso', () => {
  it('writes local midnight as local midnight, with its offset', () => {
    const d = new Date(2026, 9, 1); // 1 October, 00:00 wherever this runs
    const iso = localIso(d);
    // The day is the one the manager sees, whatever the timezone.
    expect(iso.slice(0, 19)).toBe('2026-10-01T00:00:00');
    // And it is still the same instant.
    expect(new Date(iso).getTime()).toBe(d.getTime());
  });
});
