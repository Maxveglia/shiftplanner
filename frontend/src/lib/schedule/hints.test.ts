// A belief the product holds about this business, read back to the manager.
//
// The bug these pin: the sentence used to be composed on the server, in
// English, and shown as it arrived. A Spanish manager opened the list of
// standing rules and found one row of English between Spanish ones -- the row
// saying what we believe about them, which is the one they are most likely to
// want to argue with.

import { describe, expect, it } from 'vitest';
import { describeHint } from './hints';
import { getLanguage, setLanguage, type Language } from '../i18n/core';

function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

describe('a belief with numbers', () => {
  it('reads as a sentence in either language', () => {
    const hint = { key: 'min_staff', value: { staff: 3 }, claim: '3 people on shift' };
    expect(inLanguage('en', () => describeHint(hint))).toBe(
      'At least 3 people on shift whenever open',
    );
    expect(inLanguage('es', () => describeHint(hint))).toBe(
      'Al menos 3 personas mientras esté abierto',
    );
  });

  it('writes the hours the way each language writes a clock', () => {
    const hint = {
      key: 'opening_hours',
      value: { openMin: 9 * 60, closeMin: 22 * 60 },
      claim: 'open 09:00-22:00',
    };
    expect(inLanguage('en', () => describeHint(hint))).toBe('Open from 9:00 AM to 10:00 PM');
    expect(inLanguage('es', () => describeHint(hint))).toBe('Abierto de 09:00 a 22:00');
  });
});

describe('a busy window', () => {
  it('says how many MORE, which is not how many', () => {
    // The whole difference between this and a declared peak. "2 people on
    // Friday evening" understates a belief that means two ON TOP of the floor
    // by exactly the floor, which on a Friday is most of the number.
    const hint = {
      key: 'busy_window:5:1200-1380',
      value: { weekday: 5, extra: 2, startMin: 1200, endMin: 1380 },
      claim: '2 extra on Friday between 20:00 and 23:00',
    };
    expect(inLanguage('en', () => describeHint(hint))).toBe(
      '2 more people on Friday, from 8:00 PM to 11:00 PM',
    );
    expect(inLanguage('es', () => describeHint(hint))).toBe(
      '2 personas más los viernes, de 20:00 a 23:00',
    );
  });

  it('says one person, not "1 people"', () => {
    const hint = {
      key: 'busy_window:-1:720-900',
      value: { weekday: -1, extra: 1, startMin: 720, endMin: 900 },
      claim: '1 extra every day between 12:00 and 15:00',
    };
    expect(inLanguage('en', () => describeHint(hint))).toBe(
      'One more person from 12:00 PM to 3:00 PM',
    );
    expect(inLanguage('es', () => describeHint(hint))).toBe(
      'Una persona más de 12:00 a 15:00',
    );
  });
});

describe('a day we learned about', () => {
  it('reads both ways round, because a correction can teach either', () => {
    const closed = { key: 'closed_weekday:1', value: { weekday: 1, closed: true } };
    const open = { key: 'closed_weekday:1', value: { weekday: 1, closed: false } };
    expect(inLanguage('es', () => describeHint(closed))).toBe('Cerrado los lunes');
    expect(inLanguage('es', () => describeHint(open))).toBe('Abierto los lunes');
  });
});

describe('a claim shape this bundle has never seen', () => {
  it('shows the server sentence rather than saying nothing', () => {
    // A newer server. English in a Spanish list is a smaller wrong than a row
    // that says "a rule", and much smaller than a raw key.
    const hint = { key: 'moon_phase:3', value: { phase: 3 }, claim: 'fuller moons need two' };
    expect(inLanguage('es', () => describeHint(hint))).toBe('fuller moons need two');
  });

  it('falls back to something readable when there is no sentence at all', () => {
    expect(inLanguage('es', () => describeHint({ key: 'moon_phase:3' }))).toBe(
      'Una regla que fijaste tú',
    );
  });
});

describe('a server older than this client', () => {
  it('shows its English rather than a sentence built from no numbers', () => {
    // `value` arrived only with the change that made these sentences local.
    // Every claim has numbers in it, so an empty one is a server that does not
    // send them -- and writing the sentence anyway says "at least 0 people",
    // which is worse than the English the old server already composed.
    const hint = { key: 'min_staff', claim: 'at least 3 people on shift whenever it is open' };
    expect(inLanguage('es', () => describeHint(hint))).toBe(
      'at least 3 people on shift whenever it is open',
    );
  });
});

describe('a rule the manager stated', () => {
  // Its sentence is theirs. Nothing here could phrase it better, and the
  // branch has to come before the others: its `value` is not empty (it holds
  // the text), so without it the claim falls past every shape below.
  it('reads back exactly as they wrote it', () => {
    expect(
      describeHint({
        key: 'stated:9f1c',
        value: { text: 'Ana y Luis nunca juntos', accepted: true },
        claim: 'Ana y Luis nunca juntos',
      }),
    ).toBe('Ana y Luis nunca juntos');
  });

  it('falls back to the server’s sentence if the text is missing', () => {
    expect(
      describeHint({
        key: 'stated:9f1c',
        value: { accepted: false },
        claim: 'Laura siempre abre',
      }),
    ).toBe('Laura siempre abre');
  });
});

describe('a rule noticed in the manager’s retouches', () => {
  // Filed under `stated:` on the server, but the sentence is OURS, so it is
  // composed here in their language like every other claim we make -- the
  // Spanish one the server stored is only the fallback.
  it('reads as a sentence in either language', () => {
    const hint = {
      key: 'stated:edit:trim:1:morning',
      value: {
        source: 'hand_edits',
        pattern: 'trim',
        weekday: 1,
        band: 'morning',
        text: 'Cada lunes por la mañana basta con la cobertura mínima: sin turnos de más.',
        accepted: false,
      },
      claim: 'Cada lunes por la mañana basta con la cobertura mínima: sin turnos de más.',
    };
    expect(inLanguage('en', () => describeHint(hint))).toBe(
      'Every Monday morning, the minimum cover is enough: no extra shifts',
    );
    expect(inLanguage('es', () => describeHint(hint))).toBe(
      'Cada lunes por la mañana basta con la cobertura mínima: sin turnos de más',
    );
  });

  it('writes a moved start on each language’s clock', () => {
    const hint = {
      key: 'stated:edit:start:5:1080-1020',
      value: { pattern: 'start', weekday: 5, fromMin: 1080, toMin: 1020, text: 'x' },
      claim: 'x',
    };
    expect(inLanguage('en', () => describeHint(hint))).toBe(
      'Every Friday, the shift starting at 6:00 PM starts at 5:00 PM instead',
    );
    expect(inLanguage('es', () => describeHint(hint))).toBe(
      'Cada viernes, el turno que empieza a las 18:00 entra a las 17:00',
    );
  });

  it('names the person it is about, and only here', () => {
    const hint = {
      key: 'stated:edit:no_nights:0123456789abcdef',
      value: { pattern: 'no_nights', name: 'Carla Soler', text: 'x' },
      claim: 'x',
    };
    expect(inLanguage('es', () => describeHint(hint))).toBe('Carla Soler no hace turnos de noche');
  });

  it('falls back to the stored sentence for a pattern this bundle does not know', () => {
    const hint = {
      key: 'stated:edit:something_new:1',
      value: { pattern: 'something_new', text: 'Algo que aún no sabemos decir' },
      claim: 'Algo que aún no sabemos decir',
    };
    expect(describeHint(hint)).toBe('Algo que aún no sabemos decir');
  });
});
