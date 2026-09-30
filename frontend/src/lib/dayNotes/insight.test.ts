// What the AI read, as the manager sees it. The chips are the only proof the
// notes are being used, so they must say exactly what the reading said, in the
// manager's language and clock, and nothing when the reading said nothing.

import { describe, expect, it } from 'vitest';
import type { DayInsight, DayNote, InsightSummary, WeekdayInsight } from '../../api/dayNotes';
import { getLanguage, setLanguage, type Language } from '../i18n/core';
import {
  POLL_MS,
  formatSpan,
  formatTakings,
  insightChips,
  learnedRows,
  newlyRead,
  pendingDates,
  pollInterval,
  removeNote,
  upsertNote,
} from './insight';

function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

function insight(over: Partial<DayInsight> = {}): DayInsight {
  return {
    revenue: null,
    customers: null,
    closed: false,
    busy: [],
    quiet: [],
    short_staffed: [],
    over_staffed: [],
    events: [],
    pending: false,
    ...over,
  };
}

function note(date: string, over: Partial<DayNote> = {}): DayNote {
  return {
    note_date: date,
    body: `nota ${date}`,
    updated_at: `${date}T23:00:00Z`,
    sent_at: null,
    insight: null,
    ...over,
  };
}

function weekday(n: number, over: Partial<WeekdayInsight> = {}): WeekdayInsight {
  return {
    weekday: n,
    notes: 0,
    avg_revenue: null,
    revenue_notes: 0,
    avg_customers: null,
    busy: [],
    quiet: [],
    short_staffed: [],
    over_staffed: [],
    closed: 0,
    ...over,
  };
}

describe('formatSpan', () => {
  it('writes a span that crosses midnight as the two clocks', () => {
    expect(inLanguage('es', () => formatSpan({ start: '22:00', end: '01:00' }))).toBe('22:00–01:00');
  });

  it('uses the clock of the language, like the calendar beside it', () => {
    expect(inLanguage('en', () => formatSpan({ start: '22:00', end: '01:00' }))).toMatch(
      /^10:00\sPM–1:00\sAM$/,
    );
  });

  it('keeps half hours', () => {
    expect(inLanguage('es', () => formatSpan({ start: '13:30', end: '16:00' }))).toBe('13:30–16:00');
  });

  it('shows a malformed span as it came rather than as NaN', () => {
    expect(formatSpan({ start: 'noche', end: '1' })).toBe('noche–1');
  });
});

describe('insightChips', () => {
  it('is empty with no reading, and with a reading that found nothing', () => {
    expect(insightChips(null)).toEqual([]);
    expect(insightChips(undefined)).toEqual([]);
    expect(insightChips(insight())).toEqual([]);
    expect(insightChips(insight({ events: ['  '] }))).toEqual([]);
  });

  it('says every finding, in the order a day is scanned', () => {
    const chips = inLanguage('es', () =>
      insightChips(
        insight({
          revenue: 1240,
          customers: 180,
          closed: false,
          busy: [{ start: '22:00', end: '01:00' }],
          quiet: [{ start: '17:00', end: '19:00' }],
          short_staffed: [{ start: '23:00', end: '00:00' }],
          over_staffed: [{ start: '18:00', end: '20:00' }],
          events: ['Partido del Barça'],
        }),
      ),
    );
    expect(chips.map((c) => c.kind)).toEqual([
      'revenue',
      'customers',
      'busy',
      'quiet',
      'short',
      'over',
      'event',
    ]);
    expect(chips[0].text).toMatch(/^Caja 1240/);
    expect(chips.slice(1).map((c) => c.text)).toEqual([
      '180 clientes',
      'Lleno 22:00–01:00',
      'Flojo 17:00–19:00',
      'Faltó gente 23:00–00:00',
      'Sobró gente 18:00–20:00',
      'Partido del Barça',
    ]);
  });

  it('says a closed day and one customer in the singular', () => {
    const chips = inLanguage('en', () => insightChips(insight({ closed: true, customers: 1 })));
    expect(chips.map((c) => c.text)).toEqual(['1 customer', 'Closed']);
  });

  it('keeps a revenue of zero: a closed day that took nothing still took something to say', () => {
    expect(insightChips(insight({ revenue: 0 })).map((c) => c.kind)).toEqual(['revenue']);
  });
});

describe('learnedRows', () => {
  const summary = (by_weekday: WeekdayInsight[]): InsightSummary => ({
    notes_read: by_weekday.reduce((n, d) => n + d.notes, 0),
    since: '2026-07-01',
    until: '2026-09-24',
    by_weekday,
    recent_events: [],
    learning_enabled: true,
  });

  it('keeps only the weekdays that were read and yielded something, Monday first', () => {
    const rows = learnedRows(
      summary([
        weekday(4, { notes: 3, avg_revenue: 2100, busy: [{ start: '22:00', end: '02:00' }] }),
        weekday(0, { notes: 2, short_staffed: [{ start: '13:00', end: '15:00' }] }),
        weekday(1, { notes: 2 }),
        weekday(2),
        weekday(6, { notes: 1, closed: 1 }),
      ]),
    );
    expect(rows.map((r) => r.weekday)).toEqual([0, 4, 6]);
    expect(rows[1]).toMatchObject({ notes: 3, revenue: 2100, busy: [{ start: '22:00', end: '02:00' }] });
    expect(rows[0].short).toEqual([{ start: '13:00', end: '15:00' }]);
  });

  it('is empty with no summary', () => {
    expect(learnedRows(undefined)).toEqual([]);
  });
});

describe('upsertNote / removeNote', () => {
  it('writes a new note into its place, newest first', () => {
    const list = [note('2026-09-24'), note('2026-09-20')];
    expect(upsertNote(list, { note_date: '2026-09-22', body: 'x' }).map((n) => n.note_date)).toEqual([
      '2026-09-24',
      '2026-09-22',
      '2026-09-20',
    ]);
  });

  it('keeps what it was not told when replacing: the send and the reading', () => {
    const sent = note('2026-09-24', { sent_at: '2026-09-24T22:00:00Z', insight: insight({ revenue: 5 }) });
    const [after] = upsertNote([sent], { note_date: '2026-09-24', body: 'nuevo' });
    expect(after).toMatchObject({
      body: 'nuevo',
      sent_at: '2026-09-24T22:00:00Z',
      updated_at: sent.updated_at,
      insight: { revenue: 5 },
    });
  });

  it('takes what the server said when it says it', () => {
    const [after] = upsertNote([note('2026-09-24', { insight: insight() })], {
      note_date: '2026-09-24',
      body: 'b',
      insight: insight({ pending: true }),
      sent_at: null,
    });
    expect(after.insight?.pending).toBe(true);
    expect(after.sent_at).toBeNull();
  });

  it('starts a list that did not exist yet, and takes a note out of one', () => {
    expect(upsertNote(undefined, { note_date: '2026-09-24', body: 'a' })).toHaveLength(1);
    expect(removeNote([note('2026-09-24'), note('2026-09-23')], '2026-09-24').map((n) => n.note_date)).toEqual([
      '2026-09-23',
    ]);
  });
});

describe('polling for readings', () => {
  const list = [
    note('2026-09-24', { insight: insight({ pending: true }) }),
    note('2026-09-23', { insight: insight() }),
    note('2026-09-22'),
  ];

  it('knows which notes are still being read', () => {
    expect(pendingDates(list)).toEqual(['2026-09-24']);
    expect(pendingDates(undefined)).toEqual([]);
  });

  it('polls only while something is pending and the window is open', () => {
    expect(pollInterval(list, true)).toBe(POLL_MS);
    expect(pollInterval(list, false)).toBe(false);
    expect(pollInterval([note('2026-09-22')], true)).toBe(false);
  });

  it('spots the readings that have just arrived, and not the ones that vanished', () => {
    const after = [
      note('2026-09-24', { insight: insight({ revenue: 900 }) }),
      note('2026-09-23', { insight: insight({ pending: true }) }),
    ];
    expect(newlyRead(['2026-09-24', '2026-09-23', '2026-09-21'], after)).toEqual(['2026-09-24']);
  });
});

describe('formatTakings', () => {
  it('shows the amount without a currency sign or cents', () => {
    expect(formatTakings(1520)).not.toMatch(/[$€]|,00|\.00/);
    expect(formatTakings(1520.4)).toMatch(/^1[.,\s]?520$/);
  });
});
