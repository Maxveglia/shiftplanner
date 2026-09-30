import { describe, expect, it } from 'vitest';
import {
  latestAnnouncement,
  newSince,
  readLastSeen,
  rememberSeen,
} from './announced';
import type { Assignment } from './types';

function shift(id: string, publishedAt?: string): Assignment {
  return {
    id,
    employeeId: 'e1',
    date: '2026-10-07',
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 't1',
    templateName: 'Sala',
    color: '#dde8ff',
    isNight: false,
    paidHours: 8,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
    publishedAt,
  };
}

describe('newSince', () => {
  it('marks nothing on a first visit, when there is no watermark', () => {
    const shifts = [shift('a', '2026-10-01T10:00:00Z'), shift('b', '2026-10-05T10:00:00Z')];
    expect(newSince(shifts, null).size).toBe(0);
  });

  it('marks only what was announced after the reader last looked', () => {
    const shifts = [
      shift('old', '2026-10-01T10:00:00Z'),
      shift('new', '2026-10-05T10:00:00Z'),
    ];
    expect([...newSince(shifts, '2026-10-03T00:00:00Z')]).toEqual(['new']);
  });

  it('does not mark a shift announced at exactly the watermark', () => {
    const shifts = [shift('seen', '2026-10-03T00:00:00Z')];
    expect(newSince(shifts, '2026-10-03T00:00:00Z').size).toBe(0);
  });

  it('ignores shifts that were never published', () => {
    // A draft the manager is still moving around reaches this screen only by
    // mistake, and it is certainly not news to anybody.
    expect(newSince([shift('draft', undefined)], '2026-10-01T00:00:00Z').size).toBe(0);
  });
});

describe('latestAnnouncement', () => {
  it('is the most recent announcement present', () => {
    const shifts = [
      shift('a', '2026-10-01T10:00:00Z'),
      shift('c', '2026-10-09T08:30:00Z'),
      shift('b', '2026-10-05T10:00:00Z'),
    ];
    expect(latestAnnouncement(shifts)).toBe('2026-10-09T08:30:00Z');
  });

  it('is null when nothing is published', () => {
    expect(latestAnnouncement([shift('a', undefined)])).toBeNull();
    expect(latestAnnouncement([])).toBeNull();
  });
});

/** A stand-in for the browser's storage; the runner here has no DOM. */
function fakeStore() {
  const rows = new Map<string, string>();
  return {
    getItem: (k: string) => rows.get(k) ?? null,
    setItem: (k: string, v: string) => void rows.set(k, v),
  };
}

describe('the watermark', () => {
  it('round-trips per employee, without leaking between two people on one phone', () => {
    const store = fakeStore();
    rememberSeen('ana', '2026-10-05T10:00:00Z', store);
    expect(readLastSeen('ana', store)).toBe('2026-10-05T10:00:00Z');
    expect(readLastSeen('luis', store)).toBeNull();
  });

  it('never moves backward', () => {
    // Browse November, then step back to October. October's latest
    // announcement is older, and storing it would re-badge November.
    const store = fakeStore();
    rememberSeen('ana', '2026-11-20T10:00:00Z', store);
    rememberSeen('ana', '2026-10-01T10:00:00Z', store);
    expect(readLastSeen('ana', store)).toBe('2026-11-20T10:00:00Z');
  });

  it('ignores a null announcement rather than storing one', () => {
    const store = fakeStore();
    rememberSeen('ana', null, store);
    expect(readLastSeen('ana', store)).toBeNull();
  });

  it('is a first visit when there is no storage at all', () => {
    expect(readLastSeen('ana', null)).toBeNull();
    // And writing is a no-op rather than a crash.
    expect(() => rememberSeen('ana', '2026-10-05T10:00:00Z', null)).not.toThrow();
  });
});
