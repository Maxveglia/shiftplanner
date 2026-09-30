import { describe, expect, it } from 'vitest';
import { getLanguage, setLanguage, type Language } from '../i18n/core';
import { chargedAt, cleanVoidReason, recordedBySentence, voidedSentence } from './void';

/** Read in one language without leaking it into other tests. */
function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

// Built from local parts, so every test says the same in any zone.
const oneOhFive = new Date(2026, 8, 27, 13, 5).toISOString();

describe('cleanVoidReason', () => {
  it('trims, and takes a blank reason as none', () => {
    expect(cleanVoidReason('  Cobrada dos veces  ')).toBe('Cobrada dos veces');
    expect(cleanVoidReason('   ')).toBeNull();
    expect(cleanVoidReason('')).toBeNull();
    expect(cleanVoidReason(null)).toBeNull();
  });

  it('drops NULs, which the database refuses', () => {
    expect(cleanVoidReason('Mesa\u0000 4')).toBe('Mesa 4');
    expect(cleanVoidReason('\u0000')).toBeNull();
  });
});

describe('voidedSentence', () => {
  it('says when and by whom', () => {
    expect(inLanguage('es', () => voidedSentence({ voided_at: oneOhFive, voided_by_name: 'Marta' }))).toBe(
      'Anulada el 27 sept 2026 a las 13:05 por Marta.',
    );
    expect(inLanguage('en', () => voidedSentence({ voided_at: oneOhFive, voided_by_name: 'Marta' }))).toBe(
      'Voided on Sep 27, 2026 at 1:05 PM by Marta.',
    );
  });

  it('leaves out who when the server names nobody', () => {
    expect(inLanguage('es', () => voidedSentence({ voided_at: oneOhFive, voided_by_name: null }))).toBe(
      'Anulada el 27 sept 2026 a las 13:05.',
    );
    expect(inLanguage('es', () => voidedSentence({ voided_at: oneOhFive, voided_by_name: '  ' }))).toBe(
      'Anulada el 27 sept 2026 a las 13:05.',
    );
  });

  it('says nothing of a sale that stands', () => {
    expect(voidedSentence({ voided_at: null, voided_by_name: 'Marta' })).toBeNull();
  });
});

describe('chargedAt', () => {
  it('is the clock a till sale was charged at', () => {
    expect(inLanguage('es', () => chargedAt({ source: 'till', created_at: oneOhFive }))).toBe('13:05');
  });

  it('is nothing for a sale typed by hand, or a stamp that does not read', () => {
    expect(chargedAt({ source: 'manual', created_at: oneOhFive })).toBeNull();
    expect(chargedAt({ source: 'till', created_at: '' })).toBeNull();
  });
});

describe('recordedBySentence', () => {
  it('says who charged a till sale, and who typed in one by hand', () => {
    expect(inLanguage('es', () => recordedBySentence({ source: 'till', created_by_name: 'Tablet barra' }))).toBe(
      'Cobrada por Tablet barra',
    );
    expect(inLanguage('es', () => recordedBySentence({ source: 'manual', created_by_name: 'Max' }))).toBe(
      'Apuntada por Max',
    );
    expect(inLanguage('en', () => recordedBySentence({ source: 'till', created_by_name: 'Marta' }))).toBe(
      'Charged by Marta',
    );
  });

  it('says the account is gone when the server names nobody', () => {
    expect(inLanguage('es', () => recordedBySentence({ source: 'till', created_by_name: null }))).toBe(
      'Cobrada por una cuenta que ya no existe',
    );
    expect(inLanguage('es', () => recordedBySentence({ source: 'manual', created_by_name: '  ' }))).toBe(
      'Apuntada por una cuenta que ya no existe',
    );
  });

  it('says nothing when the server did not say', () => {
    expect(recordedBySentence({ source: 'till' })).toBeNull();
  });
});
