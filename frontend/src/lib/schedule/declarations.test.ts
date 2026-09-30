// A rule the manager stated, read back to them in their own language.
//
// The point of these is the same one ./assumptions.test makes: the server sends
// a key and some numbers, never a sentence, so nothing here can end up showing
// English prose on a Spanish screen.

import { describe, expect, it } from 'vitest';
import { describeDeclaration, describeDeclarations } from './declarations';
import { getLanguage, setLanguage, type Language } from '../i18n/core';
import type { Declaration } from '../../api/schedule';

function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

function decl(over: Partial<Declaration>): Declaration {
  return { key: 'min_staff', field: 'minStaff', value: {}, source: 'declared', ...over };
}

describe('a rule stated by correcting a calendar', () => {
  it('reads as the window and the number', () => {
    const d = inLanguage('en', () =>
      describeDeclaration(
        decl({
          key: 'peak:780-960',
          field: 'coverage',
          value: { staff: 4, startMin: 780, endMin: 960, weekday: -1 },
        }),
      ),
    );

    expect(d.what).toContain('4 people');
    // An English reader gets an English clock. The same rule in Spanish is
    // "de 13:00 a 16:00" -- see the next test.
    expect(d.what).toContain('1:00 PM');
    expect(d.what).toContain('4:00 PM');
  });

  it('names the weekday when the rule has one', () => {
    const d = inLanguage('es', () =>
      describeDeclaration(
        decl({
          key: 'busy_window:5:1200-1320',
          field: 'coverage',
          value: { staff: 3, startMin: 1200, endMin: 1320, weekday: 5 },
        }),
      ),
    );

    expect(d.what).toContain('3 personas');
    expect(d.what).toContain('viernes');
  });

  it('writes a floor as a floor', () => {
    const d = inLanguage('en', () =>
      describeDeclaration(decl({ key: 'min_staff', value: { staff: 1 } })),
    );

    expect(d.what).toContain('1 person');
  });

  it('writes a closure as one', () => {
    const d = inLanguage('es', () =>
      describeDeclaration(
        decl({ key: 'closed_weekday:1', field: 'closedWeekdays', value: { weekday: 1, closed: true } }),
      ),
    );

    expect(d.what).toBe('Cerrado los lunes');
  });
});

describe('hours answered when we asked', () => {
  it('read as the day and its window', () => {
    const d = inLanguage('es', () =>
      describeDeclaration(
        decl({
          key: 'day_hours:6',
          field: 'dayHours',
          value: { weekday: 6, openMin: 480, closeMin: 1440 },
        }),
      ),
    );

    // Midnight prints as 00:00, which is what formatClock says everywhere
    // else in the product -- a second convention here would be worse.
    expect(d.what).toBe('sábado, de 08:00 a 00:00');
  });
});

describe('a claim shape this build has never seen', () => {
  it('says something a person can read, not a key', () => {
    const d = inLanguage('en', () =>
      describeDeclaration(decl({ key: 'invented_later:9', value: {} })),
    );

    expect(d.what).not.toContain('calendar.declared');
    expect(d.what).not.toContain('invented_later');
  });
});

describe('the list', () => {
  it('keeps one row per declaration, keyed so none collide', () => {
    const rows = describeDeclarations([
      decl({ key: 'peak:780-960', value: { staff: 4, startMin: 780, endMin: 960, weekday: -1 } }),
      decl({ key: 'peak:1200-1320', value: { staff: 2, startMin: 1200, endMin: 1320, weekday: -1 } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});
