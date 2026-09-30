// What the photo field and the square add to what lib/menu/photo.test.ts
// already covers (fitWithin, photoSrc, the initials, photoWrite: the same
// functions, re-exported there for the menu).

import { describe, expect, it } from 'vitest';
import { messages } from '../i18n/messages';
import {
  nameInitials,
  PHOTO_FIELD_KEYS,
  PHOTO_FIELD_MESSAGES,
  photoNote,
  photoSrc,
  shownPhoto,
  type PhotoDraft,
} from './photo';

const SAVED = '/api/v1/inventory/photos/5f0c2a4e-1111-4222-8333-944445555666';
const NEW: PhotoDraft<string> = { kind: 'new', blob: 'b', preview: 'data:image/jpeg;base64,AAAA' };
const KEEP: PhotoDraft<string> = { kind: 'keep' };
const NONE: PhotoDraft<string> = { kind: 'none' };

describe('shownPhoto', () => {
  it('shows the new photo before it is sent, from its preview', () => {
    expect(shownPhoto(NEW, null)).toBe('data:image/jpeg;base64,AAAA');
    expect(shownPhoto(NEW, SAVED)).toBe('data:image/jpeg;base64,AAAA');
  });

  it('shows the saved photo while it is kept, and none for a new product', () => {
    expect(shownPhoto(KEEP, SAVED)).toBe(SAVED);
    expect(shownPhoto(KEEP, null)).toBeNull();
  });

  it('shows nothing once the photo is taken off, before Save', () => {
    expect(shownPhoto(NONE, SAVED)).toBeNull();
    expect(shownPhoto(NONE, null)).toBeNull();
  });
});

describe('photoNote', () => {
  it('says first why a picked file could not be used, whatever was there', () => {
    expect(photoNote('unreadable', KEEP, SAVED)).toBe('unreadable');
    expect(photoNote('tooLarge', NEW, null)).toBe('tooLarge');
  });

  it('says what Save will do with a new photo or a removed one', () => {
    expect(photoNote(null, NEW, null)).toBe('pendingNew');
    expect(photoNote(null, NEW, SAVED)).toBe('pendingNew');
    expect(photoNote(null, NONE, SAVED)).toBe('pendingRemove');
  });

  it('at rest, helps with a photo on and says what none means without', () => {
    expect(photoNote(null, KEEP, SAVED)).toBe('help');
    expect(photoNote(null, KEEP, null)).toBe('none');
    // Removing a photo there never was is being without one.
    expect(photoNote(null, NONE, null)).toBe('none');
  });
});

describe('the stock products, through the same functions', () => {
  it('put the inventory photo path on the API origin, as the menu does', () => {
    expect(photoSrc(SAVED, 'http://localhost:8000')).toBe(`http://localhost:8000${SAVED}`);
    expect(photoSrc(SAVED, '')).toBe(SAVED);
    expect(photoSrc(undefined, '')).toBeNull();
  });

  it('give a product without a photo the initials a storeroom would recognise', () => {
    expect(nameInitials('Estrella Damm 33cl')).toBe('ED');
    expect(nameInitials('Bolsa de hielo')).toBe('BH');
    expect(nameInitials('Aceite de oliva virgen extra')).toBe('AO');
    expect(nameInitials('Pollo')).toBe('P');
    expect(nameInitials('7up lata')).toBe('7L');
  });
});

describe('the photo field’s words', () => {
  it.each(PHOTO_FIELD_MESSAGES)('are all there under %s, in both languages', (prefix) => {
    for (const language of ['en', 'es'] as const) {
      const missing = PHOTO_FIELD_KEYS.map((key) => `${prefix}.${key}`).filter((key) => !(key in messages[language]));
      expect(missing, language).toEqual([]);
    }
  });

  it('include every sentence photoNote can ask for', () => {
    const notes = new Set<string>([
      photoNote('unreadable', KEEP, null),
      photoNote('tooLarge', KEEP, null),
      photoNote(null, NEW, null),
      photoNote(null, NONE, SAVED),
      photoNote(null, KEEP, SAVED),
      photoNote(null, KEEP, null),
    ]);
    expect([...notes].every((note) => (PHOTO_FIELD_KEYS as readonly string[]).includes(note))).toBe(true);
    expect(notes.size).toBe(6);
  });
});
