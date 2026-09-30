import { describe, expect, it } from 'vitest';
import type { DayNote } from '../../api/dayNotes';
import { withInFlight } from './unsaved';

function note(date: string, body: string): DayNote {
  return { note_date: date, body, updated_at: '2026-09-24T10:00:00Z', sent_at: null, insight: null };
}

describe('withInFlight', () => {
  const server = [note('2026-09-24', 'caja 1.200'), note('2026-09-23', 'tranquilo')];

  it('keeps the words a poll fetched before the save landed from winning', () => {
    const list = withInFlight(server, [{ kind: 'save', date: '2026-09-24', body: 'caja 2.400 ' }]);
    expect(list.find((n) => n.note_date === '2026-09-24')?.body).toBe('caja 2.400');
    expect(list).toHaveLength(2);
  });

  it('replays the changes in order: the last one wins', () => {
    const list = withInFlight(server, [
      { kind: 'save', date: '2026-09-24', body: 'caja' },
      { kind: 'delete', date: '2026-09-24' },
      { kind: 'save', date: '2026-09-22', body: 'lluvia' },
    ]);
    expect(list.map((n) => n.note_date)).toEqual(['2026-09-23', '2026-09-22']);
  });

  it('keeps what the server says about a note nobody is changing', () => {
    const list = withInFlight(server, [{ kind: 'save', date: '2026-09-24', body: 'x' }]);
    expect(list.find((n) => n.note_date === '2026-09-23')).toEqual(server[1]);
  });

  it('is the server list untouched when nothing is in flight', () => {
    expect(withInFlight(server, [])).toBe(server);
  });
});
