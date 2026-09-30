// The safety net under the autosave: words that did not reach the server are
// kept on the device, per user, and only as long as the server disagrees.

import { describe, expect, it } from 'vitest';
import type { DayNote } from '../../api/dayNotes';
import { JOURNAL_PREFIX, createJournal, stillUnsaved, without } from './journal';

/** A Storage good enough for the journal, backed by a Map. */
function memoryStore() {
  const m = new Map<string, string>();
  return {
    map: m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function note(date: string, body: string): DayNote {
  return { note_date: date, body, updated_at: `${date}T22:00:00Z`, sent_at: null, insight: null };
}

describe('createJournal', () => {
  it('keeps what was written, per date, and forgets what was cleared', () => {
    const store = memoryStore();
    const j = createJournal('u1', store);
    j.write('2026-09-26', 'Sábado: sin red');
    j.write('2026-09-27', '');
    j.write('2026-09-26', 'Sábado: sin red al cerrar');
    expect(j.readAll()).toEqual({ '2026-09-26': 'Sábado: sin red al cerrar', '2026-09-27': '' });
    j.clear('2026-09-26');
    expect(j.readAll()).toEqual({ '2026-09-27': '' });
    expect([...store.map.keys()]).toEqual([`${JOURNAL_PREFIX}u1.2026-09-27`]);
  });

  it('never shows one user the words of another on the same device', () => {
    const store = memoryStore();
    createJournal('ana', store).write('2026-09-26', 'de Ana');
    expect(createJournal('xavi', store).readAll()).toEqual({});
  });

  it('ignores keys that are not its own', () => {
    const store = memoryStore();
    store.setItem('shiftplanner.language', 'es');
    store.setItem(`${JOURNAL_PREFIX}u1.not-a-date`, 'x');
    expect(createJournal('u1', store).readAll()).toEqual({});
  });

  it('never throws, whatever the storage does', () => {
    const broken = {
      length: 1,
      key: () => {
        throw new Error('SecurityError');
      },
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const j = createJournal('u1', broken);
    expect(() => j.write('2026-09-26', 'x')).not.toThrow();
    expect(() => j.clear('2026-09-26')).not.toThrow();
    expect(j.readAll()).toEqual({});
    expect(createJournal('u1', null).readAll()).toEqual({});
  });
});

describe('stillUnsaved', () => {
  const server = [note('2026-09-25', 'Viernes: caja 900'), note('2026-09-24', 'Jueves')];

  it('drops what the server already holds, spaces aside', () => {
    expect(
      stillUnsaved({ '2026-09-25': 'Viernes: caja 900  ', '2026-09-26': 'Sábado: sin red' }, server),
    ).toEqual({ '2026-09-26': 'Sábado: sin red' });
  });

  it('keeps a failed deletion only while the note still exists', () => {
    expect(stillUnsaved({ '2026-09-24': '', '2026-09-20': '' }, server)).toEqual({ '2026-09-24': '' });
  });

  it('keeps everything until the list has loaded', () => {
    const journal = { '2026-09-25': 'Viernes: caja 900' };
    expect(stillUnsaved(journal, undefined)).toBe(journal);
  });
});

describe('without', () => {
  it('removes one date and leaves an untouched map as it was', () => {
    const map = { a: '1', b: '2' };
    expect(without(map, 'a')).toEqual({ b: '2' });
    expect(without(map, 'z')).toBe(map);
  });
});
